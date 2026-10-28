import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
test('read-only AI progress uses current soil targets, separate liquid targets, healthy telemetry and real controller decisions',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href)
 const db=new PGlite();process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.SPFF_SOIL_EC_PULSES_ENABLED='true';process.env.AI_EVALUATION_ENABLED='true'
 const repo=await import('../lib/services/postgresRepository.js');const realEnd=repo.pool.end.bind(repo.pool)
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 repo.pool.query=query;repo.pool.connect=async()=>({query,release(){}})
 try{
  await db.exec('CREATE ROLE spff_app; CREATE ROLE spff_worker;')
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations')
  for(const n of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,n),'utf8'))
  await db.exec(`INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test');
   INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)VALUES('greenhouse-01','esp32-s3-01','pump_fert','Test');
   INSERT INTO spff.device_automatic_control_configs(site_id,device_id,revision,desired_mode,water_enabled,
    water_moisture_low_pct,water_moisture_target_pct,water_max_runtime_seconds,water_cooldown_seconds,water_min_flow_lpm,
    acknowledged_revision,acknowledgement_status,applied_mode,fertilizer_ec_target_us_cm)
   VALUES('greenhouse-01','esp32-s3-01',1,'automatic',true,30,60,20,60,1,1,'applied','automatic',1800);
   INSERT INTO spff.site_crop_selections(site_id,zone_id,crop_id,selected_by)VALUES('greenhouse-01','soil-1','tomato','admin');
   UPDATE spff.device_schedule_sync_state SET acknowledged_revision=revision,acknowledgement_status='applied';
   INSERT INTO spff.device_status_events(site_id,device_id,message_id,recorded_at,online,mode,raw_payload)
    VALUES('greenhouse-01','esp32-s3-01','status',now(),true,'automatic','{"serverPulseCapable":true,"independentSoilEcCapable":true,"pulseBootId":"0123456789abcdef"}');`)
  const svc=await import('../lib/services/soilEcPulseService.js')
  const {readFertigationProgress}=await import('../lib/services/fertigationProgressService.js')
  const {createFertigationRecipe,loadSiteFertigationSnapshot}=await import('../lib/services/fertigationRepository.js')
  const {jakartaDay}=await import('../lib/services/fertigationSchedule.js')
  const rule=await createFertigationRecipe({cropId:'tomato',cropName:'Tomat',hstFrom:0,hstTo:100,plantingDate:jakartaDay(new Date()),applicationMode:'sensor',applicationDate:null,applicationIntervalDays:null,
   triggerSampleCount:3,targetWaterL:10,targetStockL:0.5,fertilizerName:'Test',stockConcentrationGPerL:100,minWaterTankPercent:20,minStockTankPercent:20,sourceReference:'Test',useForEvaluation:true,
   moistureLowPercent:30,moistureTargetPercent:60,ecLowUsCm:600,ecTargetUsCm:1200,ecHighUsCm:1500},'test')
  const p={calibrationReference:'TEST ONLY',soilEcTargetsVerified:true,hydraulicsVerified:true,kpMsPerUsCm:10,minOnMs:1500,maxOnMs:10000,settleMs:1000,maxSessionMs:3600000,maxTotalOnMs:30000,maxDailyOnMs:60000,maxCycles:10,
   stableSamples:3,stableSpreadUsCm:20,toleranceUsCm:25,minimumRiseUsCm:10,maxNoResponseCycles:2,moistureMinPercent:30,moistureMaxPercent:60,cooldownMs:1000,waterWithPulse:false,flowSensorKey:'flow_fert_lpm',minFlowLpm:1}
  await svc.saveSoilEcAutomaticProfile({deviceId:'esp32-s3-01',recipeId:rule.recipeId,requestId:'00000000-0000-4000-8000-000000000001',profile:p},'test')
  await svc.setSoilEcExecution({deviceId:'esp32-s3-01',expectedRevision:0,enabled:true},'test')
  async function samples(ec){await db.exec('DELETE FROM spff.telemetry_samples');for(let i=0;i<3;i++)await query(`INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at,soil_1_ec_us_cm,soil_1_moisture,liquid_ec_us_cm,tank_water_level_pct,tank_fert_level_pct,sensor_health)
   VALUES('greenhouse-01','esp32-s3-01',$1,$2,now()-($2::bigint*interval '1 second'),$3,40,800,80,60,$4)`,['sample-'+i,i,ec,JSON.stringify(Object.fromEntries(['soil_1_ec_us_cm','soil_1_moisture','liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct'].map(k=>[k,{valid:true}])))]);}
  await samples(500);let report=await readFertigationProgress('esp32-s3-01')
  assert.equal(report.soilEc.target,1200);assert.equal(report.soilEc.value,500);assert.equal(report.soilEc.remaining,700);assert.ok(Math.abs(report.soilEc.percent-41.6666667)<0.0001)
  assert.equal(report.liquidEc.value,800);assert.equal(report.liquidEc.target,1800);assert.equal(report.waterTank.percent,80);assert.equal(report.waterTank.minimum,20)
  assert.equal(report.status,'needs_action');assert.equal(report.nextPulseOnMs,7000)
  for(const table of ['soil_ec_pulse_sessions','soil_ec_pulse_commands','control_commands'])assert.equal((await query(`SELECT count(*)::int AS n FROM spff.${table}`)).rows[0].n,0)
  // Future-dated historical rows must not outrank healthy current readings or fill the sample limit.
  await db.exec(`INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at,soil_1_ec_us_cm,sensor_health)
   SELECT 'greenhouse-01','esp32-s3-01','future-'||i,i,'2085-09-22'::timestamptz+i*interval '1 second',99999,'{}'::jsonb
   FROM generate_series(1,25) i;`)
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.telemetryFresh,true);assert.equal(report.soilEc.value,500)
  assert.equal(report.status,'needs_action');assert.equal(report.nextPulseOnMs,7000)
  let snapshot=await loadSiteFertigationSnapshot('esp32-s3-01');assert.ok(snapshot.telemetryRecordedAt.getTime()<=Date.now());assert.equal(snapshot.recentSamples.length,3)
  assert.equal((await query("SELECT count(*)::int AS n FROM spff.telemetry_samples WHERE recorded_at>now()")).rows[0].n,25)
  await db.exec('DELETE FROM spff.telemetry_samples WHERE recorded_at<=now()')
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.telemetryFresh,false);assert.equal(report.telemetryAt,null);assert.equal(report.soilEc.value,null);assert.equal(report.nextPulseOnMs,null)
  snapshot=await loadSiteFertigationSnapshot('esp32-s3-01');assert.equal(snapshot.telemetryRecordedAt,null);assert.equal(snapshot.recentSamples.length,0)
  for(const table of ['soil_ec_pulse_sessions','soil_ec_pulse_commands','control_commands'])assert.equal((await query(`SELECT count(*)::int AS n FROM spff.${table}`)).rows[0].n,0)
  await samples(1190);report=await readFertigationProgress('esp32-s3-01');assert.equal(report.status,'satisfied');assert.equal(report.soilEcToleranceUsCm,25);assert.equal(report.soilEc.remaining,10);
  await samples(1300);report=await readFertigationProgress('esp32-s3-01');assert.equal(report.status,'satisfied');assert.equal(report.soilEc.remaining,0);assert.equal(report.soilEc.percent,100)
  await db.exec('UPDATE spff.device_status_events SET online=false');
  await svc.evaluateAutomaticSoilEc();assert.equal((await svc.readSoilEcAutomaticProfile('esp32-s3-01')).reason,'soil_ec_already_sufficient');assert.equal((await query('SELECT count(*)::int AS n FROM spff.soil_ec_pulse_sessions')).rows[0].n,0);
  await db.exec('UPDATE spff.device_status_events SET online=true');
  await db.exec('UPDATE spff.telemetry_samples SET tank_water_level_pct=0');
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.status,'satisfied');assert.equal(report.waterTank.value,0);
  await samples(500);await db.exec('UPDATE spff.telemetry_samples SET tank_water_level_pct=0');
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.status,'blocked');assert.equal(report.reason,'tank_sensor_or_level_invalid');
  await samples(1600);report=await readFertigationProgress('esp32-s3-01');assert.equal(report.status,'blocked');assert.equal(report.reason,'soil_ec_high')
  await samples(500);await db.exec("UPDATE spff.telemetry_samples SET recorded_at=now()-interval '10 minutes'")
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.telemetryFresh,false);assert.equal(report.soilEc.value,null);assert.equal(report.waterTank.percent,null)
  await samples(500);await db.exec("UPDATE spff.telemetry_samples SET sensor_health='{}'")
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.soilEc.value,null);assert.equal(report.status,'blocked')
  await samples(500);await db.exec('UPDATE spff.device_automatic_control_configs SET fertilizer_ec_target_us_cm=NULL')
  report=await readFertigationProgress('esp32-s3-01');assert.equal(report.liquidEc.target,null);assert.equal(report.liquidEc.percent,null)
 }finally{await realEnd();await db.close()}
})
