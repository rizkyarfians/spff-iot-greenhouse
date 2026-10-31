import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {adaptiveSessionInputSchema,adaptiveStartCommandSchema,adaptiveEventSchema,adaptiveEventPayloadSchema} from '@spff/contracts'
test('adaptive backend pins conversion, allocates batches, persists duplicate telemetry once, guards ownership and reconciles uncertain sessions',{skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite()
 const repo=await import('../lib/services/postgresRepository.js'),realEnd=repo.pool.end.bind(repo.pool)
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 repo.pool.query=query;repo.pool.connect=async()=>({query,release(){}})
 const programs=await import('../lib/services/guideProgramService.js'),ec=await import('../lib/services/guideEcConversionService.js'),adaptive=await import('../lib/services/adaptiveFertigationService.js')
 process.env.DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test';
 const {AdaptiveFertigationTransport}=await import('../../mqtt-worker/dist/adaptiveFertigationTransport.js')
 const database={query,connect:async()=>({query,release(){}}),end:async()=>{}},sent=[]
 const transport=new AdaptiveFertigationTransport(async p=>sent.push(p),database)
 const event=raw=>{const payload=adaptiveEventPayloadSchema.parse(raw);return adaptiveEventSchema.parse({kind:'adaptive_fert_event',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',messageId:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),receivedAt:new Date().toISOString(),payload})}
 try{
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations');for(const name of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,name),'utf8'))
  await db.exec("INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test');INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','ESP');INSERT INTO spff.device_automatic_control_configs(site_id,device_id,desired_mode,water_enabled,fertilizer_enabled,acknowledgement_status,acknowledged_revision,applied_mode)VALUES('greenhouse-01','esp32-s3-01','manual',false,false,'applied',1,'manual');UPDATE spff.device_automatic_control_configs SET water_min_tank_level_pct=10,fertilizer_min_tank_level_pct=10;INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)VALUES('greenhouse-01','esp32-s3-01',true,'manual',now(),'{\"firmwareVersion\":\"1.5.03-SHT20-TELEMETRY-SYNC\",\"pulseBootId\":\"0123456789abcdef\"}');")
  await query("INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at,liquid_ec_us_cm,tank_water_level_pct,tank_fert_level_pct,flow_water_lpm,flow_fert_lpm,sensor_health,raw_payload)VALUES('greenhouse-01','esp32-s3-01','test-adaptive',1,now(),100,80,70,0,0,$1,'{}')",[JSON.stringify(Object.fromEntries(['liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm'].map(k=>[k,{valid:true}])))]);
  await query("INSERT INTO spff.alarm_rules(site_id,rule_key,source_type,source_key,comparator,severity,trigger_count,recovery_count,title,description,recommendation)VALUES('greenhouse-01','adaptive_fertigation_attention','actuator','pump_fert','failed','warning',1,1,'Adaptive','Test','Check session')");
  const config={cropId:'terong',plantingDate:'2026-01-01',basis:'plants',quantity:6000,deviceId:'esp32-s3-01',waterEcMsCm:0.1}
  const preview=await programs.previewGuideProgram(config),p=await programs.saveGuideProgram({config,sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},'admin')
  const input=adaptiveSessionInputSchema.parse({programId:p.programId,expectedProgramRevision:1,expectedProfileRevision:1,activityId:'row-10',requestId:randomUUID(),waterMeterPosition:'before_injector',waterVolumeL:100,stockConcentrationGPerL:100,ecToleranceUs:100,maxDurationSec:600,flushDurationSec:30,hydraulicsReference:'Synthetic test calibration only'})
  await assert.rejects(adaptive.previewAdaptiveSession(input),/Profil konversi/)
  await ec.saveGuideEcProfile(p.programId,{expectedProgramRevision:1,expectedProfileRevision:0,activityId:'row-10',sourceReference:'Synthetic test curve only',referenceWaterEcMsCm:0,temperatureCompensated25C:true,mixtureVerified:true,points:[{concentrationGPerL:0,ecMsCm:0},{concentrationGPerL:50,ecMsCm:4}]},'admin')
  const calculated=await adaptive.previewAdaptiveSession(input);assert.ok(calculated.command.targetFertVolumeL>1);assert.ok(Math.abs(calculated.command.targetEcUs-2608)<0.001)
  assert.ok(Math.abs((calculated.command.targetWaterVolumeL+calculated.command.targetFertVolumeL)*31.35-calculated.command.targetFertVolumeL*100)<0.001)
  assert.equal(adaptiveStartCommandSchema.safeParse({...calculated.command,targetEcUs:null}).success,false)
  await assert.rejects(adaptive.createAdaptiveSession(input,'admin'),/belum diaktifkan/)
  process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED='true'
  await assert.rejects(adaptive.createAdaptiveSession({...input,expectedProfileRevision:99},'admin'),/Profil konversi/);
  await assert.rejects(adaptive.createAdaptiveSession(input,'admin'),/Telemetry adaptive/);
  const evidence={ecValid:true,flowValid:true,ecAgeMs:100,flowAgeMs:100,waterPumpKnown:true,fertPumpKnown:true,volumeEstimated:false,targetEcUs:2608,bootId:'0123456789abcdef',controlAlgorithm:'ec_hysteresis_ema',firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC'};
  const idle={kind:'adaptive_fert_telemetry',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'',timestamp:new Date().toISOString(),state:'IDLE',filteredEc:2000,rawEc:2000,waterFlowLpm:0,fertFlowLpm:0,waterVolumeL:0,fertVolumeL:0,fertMassGrams:0,volumePerPlantMl:0,waterPump:false,fertPump:false,faultReason:'none',ecTargetUnreachable:false,...evidence};
  await transport.saveEvent(event({...idle,bootId:'fedcba9876543210'}));
  await assert.rejects(adaptive.createAdaptiveSession(input,'admin'),/Boot\/status/);
  await transport.saveEvent(event({...idle,timestamp:new Date().toISOString()}));
  const session=await adaptive.createAdaptiveSession(input,'admin');assert.equal((await adaptive.createAdaptiveSession(input,'admin')).session_id,session.session_id)
  assert.equal(session.command_snapshot.bootId,'0123456789abcdef');assert.equal(adaptiveStartCommandSchema.safeParse(session.command_snapshot).success,true)
  const savedCommand=(await query('SELECT payload,expires_at FROM spff.adaptive_fert_commands WHERE command_id=$1',[session.command_snapshot.commandId])).rows[0]
  assert.equal(savedCommand.expires_at.toISOString(),session.command_snapshot.expiresAt)
  assert.equal(Date.parse(savedCommand.payload.expiresAt)-Date.parse(savedCommand.payload.issuedAt),15000)
  await assert.rejects(adaptive.createAdaptiveSession({...input,requestId:randomUUID()},'admin'),/masih aktif/)
  await assert.rejects(query("UPDATE spff.device_automatic_control_configs SET desired_mode='automatic',water_enabled=true,water_moisture_low_pct=10,water_moisture_target_pct=60,water_max_runtime_seconds=600,water_cooldown_seconds=60,water_min_tank_level_pct=10,water_min_flow_lpm=1 WHERE site_id='greenhouse-01'"),/adaptive_session_owns_relays/)
  await transport.dispatch();await transport.dispatch();assert.equal(sent.length,1)
  const now=new Date().toISOString(),telemetry={kind:'adaptive_fert_telemetry',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:session.session_id,timestamp:now,state:'EC_CONTROL',filteredEc:2000,rawEc:2000,waterFlowLpm:10,fertFlowLpm:1,waterVolumeL:10,fertVolumeL:1,fertMassGrams:100,volumePerPlantMl:1,waterPump:true,fertPump:true,faultReason:'none',ecTargetUnreachable:false,...evidence}
  const first=event(telemetry);await transport.saveEvent(first);await transport.saveEvent(first)
  let progress=await adaptive.adaptiveProgress(p.programId);assert.equal(progress.activities[0].estimatedDeliveredMassG,100);assert.equal(progress.history[0].status,'running')
  assert.equal((await query("SELECT count(*)::int AS n FROM spff.adaptive_fert_events WHERE payload->>'sessionId'=$1",[session.session_id])).rows[0].n,1)
  await transport.saveEvent(event({...idle,sessionId:session.session_id,timestamp:new Date().toISOString(),fertVolumeL:999,fertMassGrams:99900}));
  assert.equal((await adaptive.adaptiveProgress(p.programId)).history[0].status,'running')
  assert.equal((await adaptive.adaptiveProgress(p.programId)).activities[0].estimatedDeliveredMassG,100)
  await transport.saveEvent(event({...telemetry,timestamp:new Date(Date.now()-1000).toISOString(),waterVolumeL:5,fertVolumeL:0.5,fertMassGrams:50}));assert.equal((await adaptive.adaptiveProgress(p.programId)).activities[0].estimatedDeliveredMassG,100)
  await assert.rejects(adaptive.controlAdaptiveSession(session.session_id,'resume',randomUUID()),/sesi dijeda/)
  const pause=await adaptive.controlAdaptiveSession(session.session_id,'pause',randomUUID());await transport.dispatch();assert.equal(sent.length,2)
  // Firmware ACKs reuse the start command ID; the pause command must not be falsely acknowledged.
  await transport.saveEvent(event({kind:'adaptive_fert_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:session.session_id,commandId:session.command_snapshot.commandId,state:'PAUSED',status:'accepted',acknowledgedAt:new Date().toISOString(),reason:'session_paused'}))
  assert.notEqual((await query('SELECT status FROM spff.adaptive_fert_commands WHERE command_id=$1',[pause.command_id])).rows[0].status,'accepted')
  await transport.saveEvent(event({...telemetry,timestamp:new Date().toISOString(),state:'PAUSED',waterPump:false,fertPump:false}));
  const resumeId=randomUUID();
  process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED='false';
  await assert.rejects(adaptive.controlAdaptiveSession(session.session_id,'resume',resumeId),/belum diaktifkan/);
  process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED='true';
  const resume=await adaptive.controlAdaptiveSession(session.session_id,'resume',resumeId);
  assert.equal(resume.payload.bootId,'0123456789abcdef');assert.equal(resume.payload.expiresAt,resume.expires_at.toISOString());
  assert.equal((await adaptive.controlAdaptiveSession(session.session_id,'resume',resumeId)).command_id,resume.command_id);
  process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED='false';
  await transport.dispatch();assert.equal(sent.length,2);
  process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED='true';
  await transport.dispatch();assert.equal(sent.length,3);
  await transport.saveEvent(event({...telemetry,timestamp:new Date().toISOString(),state:'FAULT',waterPump:false,fertPump:false,faultReason:'dry_run_water'}))
  assert.equal((await adaptive.adaptiveProgress(p.programId)).history[0].status,'reconciliation_required')
  for(const invalid of [{bootId:'fedcba9876543210'},{volumeEstimated:true},{flowValid:false},{waterPumpKnown:false}]){
   await transport.saveEvent(event({...telemetry,timestamp:new Date().toISOString(),waterVolumeL:20,fertVolumeL:2,fertMassGrams:200,...invalid}));
   assert.equal((await adaptive.adaptiveProgress(p.programId)).activities[0].estimatedDeliveredMassG,100)
  }
  await query("INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name,actuator_type)VALUES('greenhouse-01','esp32-s3-01','pump_water','Water','pump')")
  const controlSql="INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,requested_by,issued_at,expires_at)VALUES($1,'greenhouse-01','esp32-s3-01','pump_water',$2,'test',now(),now()+interval '15 seconds')"
  await assert.rejects(query(controlSql,['blocked-on',true]),/adaptive_session_owns_relays/)
  await query(controlSql,['manual-off',false])
  assert.ok((await query("SELECT 1 FROM spff.adaptive_fert_commands WHERE session_id=$1 AND payload->>'commandType'='stop'",[session.session_id])).rows.length)

  await assert.rejects(adaptive.reconcileAdaptiveSession(session.session_id,{pumpsOffVerified:true,waterVolumeL:10,fertVolumeL:1,note:'Operator test verification'},'admin'),/kedaluwarsa/)
  await query("UPDATE spff.adaptive_fert_commands SET expires_at=now()-interval '1 second' WHERE session_id=$1",[session.session_id])
  await adaptive.reconcileAdaptiveSession(session.session_id,{pumpsOffVerified:true,waterVolumeL:10,fertVolumeL:1,note:'Operator test verification'},'admin')
  progress=await adaptive.adaptiveProgress(p.programId);assert.equal(progress.history[0].status,'fault');assert.equal(progress.activities[0].estimatedDeliveredMassG,100)
  assert.equal((await query("SELECT status FROM spff.alarms WHERE incident_key=$1",['adaptive_fert:'+session.session_id])).rows[0].status,'resolved');
  await transport.saveEvent(event({...telemetry,timestamp:new Date().toISOString(),state:'FAULT',waterPump:false,fertPump:false,faultReason:'dry_run_water'}));
  const reset=await adaptive.controlAdaptiveSession(session.session_id,'reset_fault',randomUUID());
  assert.equal(reset.payload.commandType,'reset_fault');
  await transport.dispatch();assert.equal(sent.at(-1).command.commandType,'reset_fault');
  await programs.completeGuideActivity(p.programId,1,'row-10','Manual completion recorded','admin');
  await assert.rejects(adaptive.previewAdaptiveSession({...input,requestId:randomUUID()}),/selesai manual/);
  const foreign={...telemetry,sessionId:randomUUID(),timestamp:new Date().toISOString(),fertVolumeL:999};await transport.saveEvent(event(foreign));assert.equal((await adaptive.adaptiveProgress(p.programId)).activities[0].estimatedDeliveredMassG,100)
 }finally{delete process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED;await realEnd();await db.close()}
})
