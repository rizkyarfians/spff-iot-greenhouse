import {fertigationProgressMetric,soilEcPulseProfileSchema,type FertigationProgress,type FertigationRecipe} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
import {getFertigationRecipe,listFertigationRecipes} from './fertigationRepository.js';
import {applicationDue,calculateHst,jakartaDay} from './fertigationSchedule.js';
import {readSoilEcAutomaticProfile,readSoilEcExecution,evaluateSoilEcSamples,soilEcEquipment} from './soilEcPulseService.js';

/** Advisory, read-only: uses the pulse controller's sample evaluation without creating sessions/commands. */
export async function readFertigationProgress(deviceId:string,recipeId?:string):Promise<FertigationProgress> {
 const now=Date.now(),day=jakartaDay(new Date(now));
 const [execution,saved,configResult,telemetry,sessionResult,budget]=await Promise.all([
  readSoilEcExecution(deviceId),readSoilEcAutomaticProfile(deviceId),
  pool.query(`SELECT c.*,crop.crop_id FROM spff.device_automatic_control_configs c
   LEFT JOIN spff.site_crop_selections crop ON crop.site_id=c.site_id AND crop.zone_id='soil-1'
   WHERE c.site_id=$1 AND c.device_id=$2`,[siteId,deviceId]),
  pool.query(`SELECT * FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2
   ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1`,[siteId,deviceId]),
  pool.query(`SELECT * FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2
   AND status IN ('waiting','in_flight','fault') ORDER BY started_at DESC LIMIT 1`,[siteId,deviceId]),
  pool.query(`SELECT COALESCE(sum(total_on_ms),0) AS total FROM spff.soil_ec_pulse_sessions
   WHERE site_id=$1 AND device_id=$2 AND application_day=$3`,[siteId,deviceId,day]),
 ]);
 const config=configResult.rows[0],t=telemetry.rows[0],session=sessionResult.rows[0];
 let rule:FertigationRecipe|null=null,ambiguous=false;
 const chosen=recipeId??saved?.recipe_id;
 if(chosen)rule=await getFertigationRecipe(chosen);
 else {
  const candidates=(await listFertigationRecipes()).filter((r):r is FertigationRecipe=>!!r&&r.zoneId==='soil-1'&&r.cropId===config?.crop_id&&r.approvalStatus==='approved'&&applicationDue(r,day)&&r.targetStockL>0);
  ambiguous=candidates.length>1;rule=candidates.length===1?candidates[0]!:null;
 }
 const fresh=!!t && now-t.recorded_at.getTime()>=0&&now-t.recorded_at.getTime()<=120000;
 const reading=(key:string,max:number)=>fresh&&t.sensor_health?.[key]?.valid===true&&typeof t[key]==='number'&&Number.isFinite(t[key])&&t[key]>=0&&t[key]<=max?t[key] as number:null;
 const profile=saved?soilEcPulseProfileSchema.safeParse(saved.profile):null;
 const profileValue=profile?.success?profile.data:null;
 const applies=!!rule && rule.zoneId==='soil-1'&&rule.approvalStatus==='approved'&&!!rule.approvalReference
  &&rule.targetStockL>0&&rule.ecLowUsCm!==null&&rule.ecTargetUsCm!==null&&rule.ecHighUsCm!==null
  &&rule.cropId===config?.crop_id&&applicationDue(rule,day);
 const report:FertigationProgress={deviceId,evaluatedAt:new Date(now).toISOString(),day,telemetryAt:t?.recorded_at?.toISOString()??null,telemetryFresh:fresh,soilEcBasis:'latest',
  recipeId:rule?.recipeId??null,cropName:rule?.cropName??null,hst:rule?calculateHst(rule.plantingDate,day):null,ruleAppliesToday:applies,
  executionEnabled:execution.enabled,profileArmed:saved?.armed===true,liquidControlEnabled:config?.fertilizer_enabled===true,
  status:'unavailable',reason:'rule_missing',nextPulseOnMs:null,
  soilEc:fertigationProgressMetric('soil_1_ec_us_cm','EC tanah','µS/cm',reading('soil_1_ec_us_cm',100000),rule?.ecTargetUsCm??null,rule?.ecLowUsCm??null,rule?.ecHighUsCm??null),
  liquidEc:fertigationProgressMetric('liquid_ec_us_cm','EC larutan tandon','µS/cm',reading('liquid_ec_us_cm',100000),config?.fertilizer_ec_target_us_cm??null,config?.fertilizer_ec_low_us_cm??null,config?.fertilizer_ec_high_us_cm??null),
  waterTank:fertigationProgressMetric('tank_water_level_pct','Isi tandon air','%',reading('tank_water_level_pct',100),100,rule?.minWaterTankPercent??null),
  fertilizerTank:fertigationProgressMetric('tank_fert_level_pct','Isi tandon pupuk','%',reading('tank_fert_level_pct',100),100,rule?.minStockTankPercent??null),
  dailyOnMs:Number(budget.rows[0]?.total??0),dailyLimitMs:profileValue?.maxDailyOnMs??null,soilEcToleranceUsCm:profileValue?.toleranceUsCm??null,
 };
 if(ambiguous){report.reason='rule_ambiguous';return report;}
 if(!rule)return report;
 if(!applies){report.status='blocked';report.reason='rule_not_applicable';return report;}
 if(!saved||!profileValue){report.status='blocked';report.reason='calibration_missing';return report;}
 if(saved.recipe_id!==rule.recipeId||String(saved.recipe_revision)!==String(rule.revision)){
  report.status='blocked';report.reason='calibration_rule_changed';return report;
 }
 // Surface true controller faults before describing a numerical target as sufficient.
 if(session?.status==='fault'){report.status='blocked';report.reason=session.reason;return report;}
 if(session?.status==='in_flight'){report.status='running';report.reason='pulse_in_flight';return report;}
 const c=await pool.connect();
 try {
  const decision=await evaluateSoilEcSamples(c,deviceId,rule,profileValue,{afterMs:session?.settle_until?.getTime()??0,
   cycles:session?.cycles??0,totalOnMs:Number(session?.total_on_ms??0),previousEc:session?.previous_ec??null,noResponseCycles:session?.no_response_cycles??0});
  if(decision.ec!==undefined){report.soilEcBasis='stable_mean';report.soilEc=fertigationProgressMetric('soil_1_ec_us_cm','EC tanah','µS/cm',decision.ec,rule.ecTargetUsCm,rule.ecLowUsCm,rule.ecHighUsCm);}
  report.reason=decision.reason;
  if(decision.action==='fault'){report.status='blocked';return report;}
  if(decision.action==='complete'){report.status='satisfied';return report;}
  if(!execution.enabled||!execution.serverAvailable||!saved.armed){report.status='disabled';report.reason=!execution.enabled?'ai_disabled':!execution.serverAvailable?'server_disabled':'operator_stop';return report;}
  if(decision.action==='wait'){report.status='waiting';return report;}
  if(!session){
   const due=(await listFertigationRecipes()).filter((r):r is FertigationRecipe=>!!r&&r.cropId===rule.cropId&&r.approvalStatus==='approved'&&applicationDue(r,day));
   if(due.length!==1||due[0]?.recipeId!==rule.recipeId){report.status='blocked';report.reason='rule_ambiguous';return report;}
  }
  try{await soilEcEquipment(c,deviceId);}catch(error){report.status=error instanceof Error&&error.message==='schedule_priority'?'waiting':'blocked';report.reason=error instanceof Error&&'status' in error?error.message:'equipment_not_ready';return report;}
  const pending=await c.query(`SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2
   AND status IN ('completed','cancelled') AND updated_at>now()-($3::bigint*interval '1 millisecond') LIMIT 1`,[siteId,deviceId,profileValue.cooldownMs]);
  if(pending.rowCount){report.status='waiting';report.reason='cooldown';return report;}
  if(!session){
   const outstanding=await c.query(`SELECT 1 FROM spff.soil_ec_pulse_commands pc JOIN spff.soil_ec_pulse_sessions s USING(session_id)
    WHERE s.site_id=$1 AND s.device_id=$2 AND pc.status IN ('pending','published','accepted')
    UNION ALL SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2 AND status IN ('pending','published','accepted') LIMIT 1`,[siteId,deviceId]);
   if(outstanding.rowCount){report.status='waiting';report.reason='command_pending';return report;}
   const ownership=await c.query(`SELECT 1 FROM spff.soil_ec_pulse_sessions s WHERE s.site_id=$1 AND s.device_id=$2
    AND NOT EXISTS(SELECT 1 FROM spff.soil_ec_pulse_commands pc WHERE pc.session_id=s.session_id
      AND pc.operation='release' AND pc.status='completed' AND pc.ack->>'pumpsOff'='true') LIMIT 1`,[siteId,deviceId]);
   if(ownership.rowCount){report.status='blocked';report.reason='ownership_unreleased';return report;}
  }
  report.status='needs_action';report.nextPulseOnMs=decision.onMs??null;return report;
 }catch(error){if(error instanceof Error&&'status' in error&&error.status===409){report.status='blocked';report.reason=error.message;return report;}throw error;}finally{c.release();}
}
