import {
 aiHstHardwareProfileSchema,aiHstRealExecuteRequestSchema,aiHstRealPlanSchema,
 aiHstRealSessionSummarySchema,aiHstProposalsSchema,aiHstApprovalResultSchema,
 guideProgramConfigSchema,guideProgramHst,guideEcRecipe,
 type AiHstHardwareProfile,type AiHstRealExecuteRequest,type GuideActivity,type GuideProgramPlan,
} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
import {readGuideEcConversions} from './guideEcConversionService.js';
import {createAdaptiveSession,readAdaptiveSession} from './adaptiveFertigationService.js';
import {localAiUrl} from './localAiEndpoint.js';
import {readHstMode} from './hstExecutionModeService.js';
import {assertLegacyHstNotVolumeBound} from './doseVolumeService.js';

const blocked=(reason:string,status=409):never=>{throw Object.assign(new Error(reason),{status});};
const bridge=()=>{const k=process.env.AI_HST_BRIDGE_KEY;if(!k||k.length<32)return blocked('Kunci bridge HST tidak dikonfigurasi.',503);return k;};
async function proposals(){
 const response=await fetch(localAiUrl('/hst/proposals'),{signal:AbortSignal.timeout(8000),cache:'no-store',redirect:'error'});
 if(!response.ok)return blocked('AI HST tidak tersedia.',503);
 const parsed=aiHstProposalsSchema.safeParse(await response.json() as unknown);
 if(!parsed.success)return blocked('Proposal AI HST tidak valid.',503);
 return parsed.data.proposals;
}
export async function readHstRealHardwareProfile(programId:string,activityId:string,sourceRow:number){
 const row=(await pool.query(`SELECT * FROM spff.hst_real_profiles WHERE site_id=$1 AND program_id=$2 AND activity_id=$3 AND source_row=$4`,
 [siteId,programId,activityId,sourceRow])).rows[0];
 if(!row)return null;
 return aiHstHardwareProfileSchema.parse({
  programId:row.program_id,activityId:row.activity_id,sourceRow:row.source_row,
  deviceId:row.device_id,product:row.product,programRevision:row.program_revision,
  ecProfileRevision:row.ec_profile_revision,stockConcentrationGPerL:row.stock_concentration_g_l,
  waterMeterPosition:row.water_meter_position,hydraulicsReference:row.hydraulics_reference,
  ecToleranceUs:row.ec_tolerance_us,maxDurationSec:row.max_duration_sec,
  flushDurationSec:row.flush_duration_sec,
 });
}
export async function saveHstRealHardwareProfile(raw:AiHstHardwareProfile,actor:string){
 const input=aiHstHardwareProfileSchema.parse(raw);
 const p=(await pool.query('SELECT config,plan,revision FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',[siteId,input.programId])).rows[0];
 const config=guideProgramConfigSchema.safeParse(p?.config);
 const plan=p?.plan as GuideProgramPlan|undefined;
 const activity=(plan?.activities as GuideActivity[]|undefined)?.find(a=>a.id===input.activityId);
 if(!config.success||!activity||p.revision!==input.programRevision||config.data.deviceId!==input.deviceId||
    activity.requirements.length!==1||activity.requirements[0].row!==input.sourceRow||
    activity.requirements[0].product!==input.product||!guideEcRecipe(activity))
  return blocked('Konfigurasi HST tidak cocok dengan satu produk, revisi, atau perangkat Panduan.');
 const conversion=(await readGuideEcConversions(input.programId)).find(c=>c.activityId===input.activityId);
 if(conversion?.status!=='ready'||conversion.profile?.revision!==input.ecProfileRevision)
  return blocked('Profil EC belum siap atau revisinya berubah.');
 const record=await pool.query(`INSERT INTO spff.hst_real_profiles
  (site_id,program_id,activity_id,source_row,device_id,product,program_revision,ec_profile_revision,
   stock_concentration_g_l,water_meter_position,hydraulics_reference,ec_tolerance_us,max_duration_sec,flush_duration_sec,verified_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT(site_id,program_id,activity_id,source_row) DO UPDATE SET
  device_id=EXCLUDED.device_id,product=EXCLUDED.product,program_revision=EXCLUDED.program_revision,
  ec_profile_revision=EXCLUDED.ec_profile_revision,stock_concentration_g_l=EXCLUDED.stock_concentration_g_l,
  water_meter_position=EXCLUDED.water_meter_position,hydraulics_reference=EXCLUDED.hydraulics_reference,
  ec_tolerance_us=EXCLUDED.ec_tolerance_us,max_duration_sec=EXCLUDED.max_duration_sec,
  flush_duration_sec=EXCLUDED.flush_duration_sec,verified_by=EXCLUDED.verified_by,verified_at=now()
  RETURNING verified_at`,
  [siteId,input.programId,input.activityId,input.sourceRow,input.deviceId,input.product,input.programRevision,
   input.ecProfileRevision,input.stockConcentrationGPerL,input.waterMeterPosition,input.hydraulicsReference,
   input.ecToleranceUs,input.maxDurationSec,input.flushDurationSec,actor]);
 return {profile:input,verifiedAt:record.rows[0].verified_at};
}

/** Read-only suggestions. Never create a new binding or mark another batch verified.
 * Operator must confirm unchanged stock/installation and save against current revisions.
 */
export async function readReusableHstHardwareProfile(deviceId:string,product:string){
 const rows=(await pool.query(`SELECT p.* FROM spff.hst_real_profiles p
  JOIN spff.guide_programs g ON g.site_id=p.site_id AND g.program_id=p.program_id
  WHERE p.site_id=$1 AND p.device_id=$2 AND p.product=$3
    AND g.revision=p.program_revision AND g.config->>'deviceId'=p.device_id
  ORDER BY p.verified_at DESC,p.program_id,p.activity_id,p.source_row LIMIT 5`,
  [siteId,deviceId,product])).rows;
 for(const row of rows){
  const profile=aiHstHardwareProfileSchema.safeParse({
   programId:row.program_id,activityId:row.activity_id,sourceRow:row.source_row,
   deviceId:row.device_id,product:row.product,programRevision:row.program_revision,
   ecProfileRevision:row.ec_profile_revision,stockConcentrationGPerL:row.stock_concentration_g_l,
   waterMeterPosition:row.water_meter_position,hydraulicsReference:row.hydraulics_reference,
   ecToleranceUs:row.ec_tolerance_us,maxDurationSec:row.max_duration_sec,flushDurationSec:row.flush_duration_sec,
  });
  if(!profile.success||profile.data.deviceId!==deviceId||profile.data.product!==product)continue;
  const program=(await pool.query('SELECT config,plan,revision FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',
    [siteId,profile.data.programId])).rows[0];
  const config=guideProgramConfigSchema.safeParse(program?.config);
  const plan=program?.plan as GuideProgramPlan|undefined;
  const activity=Array.isArray(plan?.activities)?plan.activities.find(a=>a.id===profile.data.activityId):undefined;
  if(!config.success||config.data.deviceId!==deviceId||program.revision!==profile.data.programRevision||
     !activity||activity.requirements.length!==1||activity.requirements[0].row!==profile.data.sourceRow||
     activity.requirements[0].product!==product||!guideEcRecipe(activity))continue;
  const ec=(await readGuideEcConversions(profile.data.programId)).find(c=>c.activityId===profile.data.activityId);
  if(ec?.status==='ready'&&ec.profile?.revision===profile.data.ecProfileRevision)return profile.data;
 }
 return null;
}

const toleratedHolds=new Set(['shadow_mode_no_fertigation_dispatch',
 'firmware_external_volume_only_authority_not_implemented','manual_mode_blocks_automatic_start']);
export async function executeHstReal(raw:AiHstRealExecuteRequest,actor:string){
 const input=aiHstRealExecuteRequestSchema.parse(raw);
 if((await readHstMode()).shadowEnabled)return blocked('SHADOW MODE ON. ACC fisik ditolak oleh server.');
 if(process.env.SPFF_HST_REAL_DISPATCH_ENABLED!=='true'||
    process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED!=='true')
  return blocked('Eksekusi real HST belum diaktifkan di server.',503);
 const existing=(await pool.query(`SELECT h.session_id FROM spff.hst_real_sessions h
  WHERE h.site_id=$1 AND h.approval_id=$2`,[siteId,input.approvalId])).rows[0];
 if(existing){
  // The binding is immutable. Same approval ID cannot be used for another duty.
  const rec=(await pool.query('SELECT obligation_id,expected_remaining_g,actor FROM spff.hst_real_sessions WHERE site_id=$1 AND approval_id=$2',[siteId,input.approvalId])).rows[0];
  if(rec.obligation_id!==input.obligationId||rec.actor!==actor||Math.abs(rec.expected_remaining_g-input.expectedRemainingG)>0.01)
   return blocked('Approval ID sudah digunakan untuk permintaan yang berbeda.');
  return hstRealSession(existing.session_id);
 }
 const proposal=(await proposals()).find(p=>p.obligation_id===input.obligationId);
 await assertLegacyHstNotVolumeBound(input.obligationId);
 if(!proposal||!['WAITING_APPROVAL','PARTIAL_WAITING_APPROVAL'].includes(proposal.status)||
   proposal.review_reasons.length||proposal.source_row===null||proposal.remaining_g===null||
   Math.abs(proposal.remaining_g-input.expectedRemainingG)>0.01)return blocked('Kewajiban HST sudah berubah atau tidak dapat dieksekusi.');
 const profile=await readHstRealHardwareProfile(proposal.program_id,proposal.activity_id,proposal.source_row);
 if(!profile)return blocked('Pengikatan stok dan hidrolik HST belum diverifikasi oleh admin.');
 if(proposal.product!==profile.product)return blocked('Produk AI berbeda dari stok yang diverifikasi.');
 const program=(await pool.query('SELECT config,plan,revision FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',[siteId,proposal.program_id])).rows[0];
 const cfg=guideProgramConfigSchema.safeParse(program?.config),plan=program?.plan as GuideProgramPlan|undefined;
 const activity=plan?.activities.find(a=>a.id===proposal.activity_id);
 if(!cfg.success||!activity||activity.hst!==proposal.hst||!cfg.data.deviceId||
    cfg.data.deviceId!==profile.deviceId||program.revision!==profile.programRevision||
    activity.requirements.length!==1||activity.requirements[0].row!==proposal.source_row||
    activity.requirements[0].product!==proposal.product||guideProgramHst(cfg.data.plantingDate)!==activity.hst)
  return blocked('Panduan HST, status jatuh tempo, atau binding produk berubah.');
 const ec=(await readGuideEcConversions(proposal.program_id)).find(c=>c.activityId===proposal.activity_id);
 if(ec?.status!=='ready'||ec.profile?.revision!==profile.ecProfileRevision)return blocked('Profil EC berubah. Konfigurasi ulang sesi real.');
 const response=await fetch(localAiUrl('/hst/approvals'),{
  method:'POST',headers:{'Content-Type':'application/json','X-SPFF-Bridge-Key':bridge()},
  body:JSON.stringify({obligation_id:input.obligationId,approval_id:input.approvalId,
   expected_remaining_g:input.expectedRemainingG,actor,confirmation:'REVIEW_HST_SHADOW_SESSION'}),
  signal:AbortSignal.timeout(8000),cache:'no-store',redirect:'error',
 });
 if(!response.ok)return blocked('Review AI HST ditolak atau kedaluwarsa.',response.status===409?409:503);
 const reviewed=aiHstApprovalResultSchema.safeParse(await response.json() as unknown);
 if(!reviewed.success)return blocked('Bukti perhitungan AI tidak sesuai kontrak.');
 const result=reviewed.data;
 if(result.approval_id!==input.approvalId||result.obligation_id!==input.obligationId||
    result.operator_id!==actor||Math.abs(result.expected_remaining_g-input.expectedRemainingG)>0.01||
    result.hold_reasons.some(r=>!toleratedHolds.has(r)) ||
    !result.sensor_evidence.water_valid||!result.sensor_evidence.fertilizer_valid||
    !result.sensor_evidence.soil_2_valid)
  return blocked('Pemeriksaan AI HST menolak pelaksanaan berdasarkan bukti sensor/konfigurasi.');
 const verified=aiHstRealPlanSchema.safeParse(result.plan);
 if(!verified.success)return blocked('AI HST belum menghasilkan rencana fertigasi terverifikasi.');
 const aiPlan=verified.data;
 const expectedConcentration=aiPlan.mass_g/aiPlan.stock_l;
 if(Math.abs(expectedConcentration-profile.stockConcentrationGPerL)>Math.max(0.01,expectedConcentration*0.001))
  return blocked('Konsentrasi stok yang dihitung AI berbeda dari stok fisik terverifikasi.');
 const commandInput={
  programId:profile.programId,activityId:profile.activityId,expectedProgramRevision:profile.programRevision,
  expectedProfileRevision:profile.ecProfileRevision,requestId:input.approvalId,
  waterMeterPosition:profile.waterMeterPosition,waterVolumeL:aiPlan.water_l,
  stockConcentrationGPerL:profile.stockConcentrationGPerL,ecToleranceUs:profile.ecToleranceUs,
  maxDurationSec:profile.maxDurationSec,flushDurationSec:profile.flushDurationSec,
  hydraulicsReference:profile.hydraulicsReference,
 };
 const session=await createAdaptiveSession(commandInput,actor,{
  obligationId:input.obligationId,approvalId:input.approvalId,
  expectedRemainingG:input.expectedRemainingG,sourceRow:proposal.source_row,
  product:proposal.product??'',aiPlan,
 });
 return hstRealSession(session.session_id);
}
export async function hstRealSession(id:string){
 const read=await readAdaptiveSession(id);
 const session=read.session;
 const link=(await pool.query(`SELECT * FROM spff.hst_real_sessions WHERE site_id=$1 AND session_id=$2`,[siteId,id])).rows[0];
 if(!link)return blocked('Sesi ini bukan sesi real HST.',404);
 const snapshot=session.command_snapshot as {commandId:string;targetWaterVolumeL:number;targetFertVolumeL:number;nominalConcentrationGPerL:number};
 return aiHstRealSessionSummarySchema.parse({
  obligationId:link.obligation_id,approvalId:link.approval_id,
  sessionId:session.session_id,commandId:snapshot.commandId,status:session.status,
  reason:session.reason??null,
  waterVolumeL:Number(session.water_volume_l),fertVolumeL:Number(session.fert_volume_l),
  commandedWaterL:snapshot.targetWaterVolumeL,commandedFertL:snapshot.targetFertVolumeL,
  estimatedMassG:Number(session.fert_volume_l)*snapshot.nominalConcentrationGPerL,
  requestedAt:session.created_at instanceof Date?session.created_at.toISOString():String(session.created_at),
  lastTelemetryAt:session.last_telemetry_at instanceof Date?session.last_telemetry_at.toISOString():session.last_telemetry_at??null,
 });
}

export async function latestHstRealSession(obligationId:string){
 const row=(await pool.query(`SELECT session_id FROM spff.hst_real_sessions WHERE site_id=$1 AND obligation_id=$2 ORDER BY created_at DESC LIMIT 1`,[siteId,obligationId])).rows[0];
 if(!row)return null;
 return hstRealSession(row.session_id);
}
