import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {adaptiveEventPayloadSchema} from '@spff/contracts';

test('dose-volume: plans, transactional ACC, receipt credit, STOP and protocol isolation',{
 skip:!process.env.SPFF_TEST_PGLITE_MODULE,
},async t=>{
 process.env.DATABASE_URL='postgresql://isolated:invalid@127.0.0.1:1/isolated';
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
 const db=new PGlite();
 const repo=await import('../lib/services/postgresRepository.js');
 const service=await import('../lib/services/doseVolumeService.js');
 const {setHstMode}=await import('../lib/services/hstExecutionModeService.js');
 const {AdaptiveFertigationTransport}=await import('../../mqtt-worker/dist/adaptiveFertigationTransport.js');
 const {SoilEcPulseTransport}=await import('../../mqtt-worker/dist/soilEcPulseTransport.js');
 const oldQuery=repo.pool.query,oldConnect=repo.pool.connect,oldFetch=globalThis.fetch;
 // Serialize isolated PGlite connections, matching PostgreSQL transaction ownership.
 let tail=Promise.resolve();
 async function acquire(){let release;const prior=tail;tail=new Promise(resolve=>{release=resolve});await prior;return release;}
 const query=async(sql,params=[])=>{const result=await db.query(sql,params);return {...result,rowCount:result.rows.length||result.affectedRows||0};};
 const database={query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},
  connect:async()=>{const release=await acquire();return {query,release};},end:async()=>{}};
 repo.pool.query=database.query;repo.pool.connect=database.connect;
 const published=[];
 const transport=new AdaptiveFertigationTransport(async dispatch=>{published.push(dispatch)},database);
 const pid='11111111-1111-4111-8111-111111111111',obligationId='a'.repeat(64),boot='0123456789abcdef';
 const limits={contract:'spff-dose-volume-v1',commissioned:true,configVersion:'fixture-1',measuredTotalizers:true,
  waterMeterPosition:'before_injector',waterStopPct:5,stockStopPct:2,primeWaterL:5,flushWaterL:10,
  minWaterFlowLpm:1,minStockFlowLpm:0.1,maxDurationSec:600,maxWaterL:5000,maxStockL:500,meterToleranceL:0.01};
 let now,activity,proposals,summary;
 async function fixture(){
  published.length=0;
  await db.exec('TRUNCATE spff.sites CASCADE');
  await db.exec("INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','Test'); INSERT INTO spff.devices(site_id,device_id,display_name) VALUES('greenhouse-01','esp32-s3-01','Test');");
  now=new Date().toISOString();
  const planting=new Date(Date.now()-20*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
  activity={id:'row-19',hst:20,title:'Test product',method:'Semprot',waterL:100,warnings:[],
   requirements:[{row:19,product:'Ultradap',amount:0.4,unit:'kg',waterL:100,warnings:[]}]};
  const config={cropId:'ubi-jalar',plantingDate:planting,basis:'plants',quantity:100,deviceId:'esp32-s3-01'};
  const plan={cropName:'Ubi Jalar',plants:100,area:100,activities:[activity]};
  await query(`INSERT INTO spff.guide_programs(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,updated_by)
   VALUES('greenhouse-01',$1,1,$2,$3,1,'{}',$4,'fixture')`,[pid,JSON.stringify(config),'a'.repeat(64),JSON.stringify(plan)]);
  await query(`INSERT INTO spff.guide_program_revisions(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,actor)
   VALUES('greenhouse-01',$1,1,$2,$3,1,'{}',$4,'fixture')`,[pid,JSON.stringify(config),'a'.repeat(64),JSON.stringify(plan)]);
  await db.exec("INSERT INTO spff.hst_execution_modes(site_id,shadow_enabled,changed_by) VALUES('greenhouse-01',false,'fixture');");
  await db.exec(`INSERT INTO spff.device_automatic_control_configs(site_id,device_id,desired_mode,applied_mode,water_enabled,fertilizer_enabled,acknowledgement_status,acknowledged_revision)
   VALUES('greenhouse-01','esp32-s3-01','manual','manual',false,false,'applied',1)`);
  const raw={firmwareVersion:'1.5.08-DOSE-VOLUME',pulseBootId:boot,pumpReadbackValid:true,pumpWaterActualActive:false,
   pumpFertActualActive:false,aiAccSessionActive:false,doseVolumeV1:limits};
  await query(`INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01',true,'manual',$1,$2)`,[now,JSON.stringify(raw)]);
  const health=Object.fromEntries(['soil_2_moisture','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm'].map(key=>[key,{valid:true}]));
  await query(`INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at,soil_2_moisture,tank_water_level_pct,tank_fert_level_pct,flow_water_lpm,flow_fert_lpm,sensor_health,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01',$1,1,$2,22.2,50,20,0,0,$3,$4)`,[randomUUID(),now,JSON.stringify(health),JSON.stringify({sensorHealth:{soil_2_moisture:{raw:222,rawAgeMs:0,rawFresh:true,lastPollOk:true,pollBootId:boot}}})]);
  proposals={schemaVersion:1,status:'READY',can_dispatch:false,proposals:[{
   obligation_id:obligationId,program_id:pid,activity_id:'row-19',source_row:19,hst:20,due_date:now.slice(0,10),product:'Ultradap',created_at:now,
   proposed_action:'FERTIGATE',mode:'SHADOW_MODE',target_g:400,delivered_g:0,remaining_g:400,status:'WAITING_APPROVAL',review_reasons:[],approval_count:0,can_dispatch:false,
  }]};
  summary={schemaVersion:1,mode:'SHADOW_MODE',can_dispatch:false,status:'NO_DECISION',evaluated_at:null,
   planning_source:'POSTGRES_READ_ONLY',planning_status:'CURRENT',planning_recorded_at:now,flow_reference:null,
   tank_preview:{basis:'LINEAR_LEVEL_APPROXIMATION',capacity_l:5000,tank_height_cm:180,reported_level_pct:50,sensor_valid:true,
    estimated_water_height_cm:90,estimated_available_l:2500,fuzzy_demand_l:null,theoretical_balance_l:null,level_status:'ESTIMATED',comparison_status:'NOT_COMPARABLE',can_dispatch:false},
   fertilizer_tank_preview:{basis:'LINEAR_LEVEL_APPROXIMATION',capacity_l:500,tank_height_cm:90,reported_level_pct:20,sensor_valid:true,
    estimated_liquid_height_cm:18,estimated_liquid_volume_l:100,level_status:'ESTIMATED',can_dispatch:false},
   irrigation_schedule_preview:{status:'GEOMETRY_ONLY',basis:'REPORTED_LIQUID_HEIGHT_UNCALIBRATED',today_date:now.slice(0,10),tomorrow_date:now.slice(0,10),
    reported_liquid_height_cm:90,illustrative_available_l:2500,fuzzy_demand_l:null,today_absolute_max_l:null,tomorrow_at_least_l:null,reserve_l:null,is_firm_schedule:false,can_dispatch:false},
   water_carryover:{status:'NO_PLAN',plan_id:null,planning_date:null,next_review_date:null,frozen_fuzzy_target_l:null,device_reported_delivered_l:null,
    remaining_for_reassessment_l:null,credited_session_count:0,last_device_session_at:null,evidence_basis:'DEVICE_SESSION_UNCALIBRATED',requires_fresh_reassessment:true,can_dispatch:false},
   decision:{type:null,proposed_action:null,hold_reasons:[],configuration_version:null},
   feedback:{status:'UNAVAILABLE',reported_off:false,boot_matches:false,water_pump:null,fert_pump:null,reported_at:null},
   sensors:{recorded_at:now,soil_moisture_pct:null,soil_2_moisture_pct:22.2,soil_1_valid:false,soil_2_valid:true,control_moisture_source:'soil_2_moisture',water_tank_pct:50,stock_tank_pct:20,device_mode:'manual'},
   calculation:{water_l:null,stock_l:null,fertilizer_mass_g:null,duration_seconds:null,fuzzy_score:null},fuzzy_preview:null,fuzzy_preview_blockers:[],programs:[],note:'Synthetic isolated test',
   operational_profile:{status:'TANK_BOUND',version:'test-policy',program_id:null,activity_id:null,target_water_l:2500,calculation_ready:true,can_dispatch:false,blockers:[]},
   production_fuzzy:{status:'READY',basis:'TANK_INVENTORY_FUZZY',evaluated_at:now,recorded_at:now,expires_at:new Date(Date.now()+50000).toISOString(),
    profile_version:'test-policy',program_id:null,activity_id:null,input_key:'soil_2_moisture',moisture_pct:22.2,memberships:{LOW:1},dominant_input_classes:['LOW'],rule_outputs:['HIGH'],
    score:0.84,max_water_l:2500,target_water_l:2500,irrigation_needed:true,can_dispatch:false,blockers:[],target_policy:'AVAILABLE_TANK',applies_to:'ALL_PROGRAMS',
    volume_basis:'LINEAR_LEVEL_APPROXIMATION',stop_policy:'DEVICE_LOW_LEVEL_INTERLOCK',execution_blockers:[]}};
  globalThis.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('/hst/proposals')?structuredClone(proposals):structuredClone(summary)});
  process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED='true';
 }
 const makePlan=()=>service.createDoseVolumePlan({mode:'fertigation',obligationId,requestId:randomUUID()},'operator');
 const approve=plan=>service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true,confirmApplicationRoute:true},'operator');
 async function snapshot(id){return (await query('SELECT * FROM spff.adaptive_fert_sessions WHERE session_id=$1',[id])).rows[0];}
 function telemetry(command,overrides={}){return {kind:'dose_volume_telemetry',schemaVersion:1,contract:'spff-dose-volume-v1',siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:command.sessionId,
  bootId:boot,commandId:command.commandId,timestamp:new Date().toISOString(),state:'COMPLETED',waterVolumeL:command.targetWaterVolumeL,stockVolumeL:command.targetStockVolumeL,
  waterFlowLpm:0,stockFlowLpm:0,waterPump:false,fertPump:false,waterPumpKnown:true,fertPumpKnown:true,flowValid:true,volumeEstimated:false,reason:'target_reached',...overrides};}
 function ack(command,overrides={}){return {kind:'dose_volume_ack',schemaVersion:1,contract:'spff-dose-volume-v1',siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:command.sessionId,
  bootId:boot,commandId:command.commandId,timestamp:new Date().toISOString(),status:'completed',state:'COMPLETED',reason:'target_reached',...overrides};}
 async function event(raw){const payload=adaptiveEventPayloadSchema.parse(raw);return transport.saveEvent({kind:'adaptive_fert_event',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',receivedAt:new Date().toISOString(),
  messageId:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),payload});}
 try{
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations');
  for(const name of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,name),'utf8'));
  await t.test('HST Phonska Tabur queues one ON pair and reports started only after both acknowledgements',async()=>{
   await fixture();
   const {tickHstFertilization,matchHstFertilization}=await import('../../mqtt-worker/dist/hstFertilizationSchedule.js');
   const configured={activities:[{...activity,method:'Tabur',
    requirements:[{...activity.requirements[0],product:'Phonska plus'}]}]};
   assert.equal(matchHstFertilization(configured,20).length,1);
   assert.equal(matchHstFertilization(configured,19).length,0);
   assert.equal(matchHstFertilization({activities:[{...configured.activities[0],method:'Semprot'}]},20).length,0);
   assert.equal(matchHstFertilization({activities:[{...configured.activities[0],
    requirements:[{...activity.requirements[0],product:'Ultradap'}]}]},20).length,0);
   await query('UPDATE spff.guide_programs SET plan=$1',[JSON.stringify(configured)]);
   await db.exec(`INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)
    VALUES('greenhouse-01','esp32-s3-01','pump_water','Water'),
          ('greenhouse-01','esp32-s3-01','pump_fert','Fertilizer')`);
   await tickHstFertilization({query},false);
   assert.equal((await query('SELECT 1 FROM spff.control_commands')).rows.length,0);
   for(let i=0;i<2;i++){
    await db.exec('BEGIN');
    await tickHstFertilization({query},true);
    await db.exec('COMMIT');
   }
   const commands=(await query('SELECT * FROM spff.control_commands')).rows;
   assert.equal(commands.length,2);
   assert.deepEqual(commands.map(c=>c.actuator_key).sort(),['pump_fert','pump_water']);
   assert.ok(commands.every(c=>c.requested_is_active));
   assert.equal((await query('SELECT status FROM spff.hst_fertilization_starts')).rows[0].status,'queued');
   const {PostgresIngestionRepository}=await import('../../mqtt-worker/dist/repository.js');
   const dispatchRepository=new PostgresIngestionRepository(database);
   assert.equal((await dispatchRepository.pendingCommands(20)).length,0,'HST ON is not dispatched in Manual');
   await db.exec(`UPDATE spff.device_automatic_control_configs SET desired_mode='automatic',applied_mode='automatic',
    water_enabled=true,water_moisture_low_pct=10,water_moisture_target_pct=30,
    water_max_runtime_seconds=120,water_cooldown_seconds=60,water_min_flow_lpm=5`);
   assert.equal((await dispatchRepository.pendingCommands(20)).length,0,'HST dispatch remains off before activation');
   process.env.SPFF_HST_SCHEDULE_DISPATCH_ENABLED='true';
   try{
    assert.equal((await dispatchRepository.pendingCommands(20)).length,2,'HST ON is dispatched in acknowledged Automatic');
   }finally{delete process.env.SPFF_HST_SCHEDULE_DISPATCH_ENABLED;}
   for(const command of commands){
    await query(`INSERT INTO spff.command_ack_events(command_id,status,actual_is_active,acknowledged_at)
     VALUES($1,'completed',true,now())`,[command.command_id]);
   }
   await tickHstFertilization({query},false);
   assert.equal((await query('SELECT status FROM spff.hst_fertilization_starts')).rows[0].status,'started');
  });
  await t.test('water-first terminal report records OFF and per-pump durations without crediting dose',async()=>{
   await fixture();
   const run=await approve(await makePlan());
   await query(`UPDATE spff.adaptive_fert_sessions
    SET command_snapshot=jsonb_build_object('kind','server_water_first_fertigation','bootId',$2::text)
    WHERE session_id=$1`,[run.session_id,boot]);
   const report={kind:'water_first_fertigation_completed',schemaVersion:1,siteId:'greenhouse-01',
    deviceId:'esp32-s3-01',sessionId:run.session_id,bootId:boot,timestamp:new Date().toISOString(),
    waterPump:{active:false,onDurationMs:30000},fertilizerPump:{active:false,onDurationMs:22000},
    reason:'local_stop'};
   assert.equal(adaptiveEventPayloadSchema.safeParse({...report,waterPump:{active:true,onDurationMs:30000}}).success,false);
   await event({...report,bootId:'abcdef0123456789'});
   assert.equal((await snapshot(run.session_id)).last_telemetry,null);
   await event(report);
   await event(report);
   const stored=await snapshot(run.session_id);
   assert.equal(stored.status,'reconciliation_required');
   assert.equal(stored.reason,'water_first_pumps_off_awaiting_dose_evidence');
   assert.deepEqual(stored.last_telemetry,report);
   assert.equal((await service.readDoseVolumeSession(run.session_id)).evidence_verified,false);
  });
  await t.test('water-first review uses live tank data without Fuzzy and cannot enqueue START',async()=>{
   await fixture();
   const previous=await approve(await makePlan());
   await query("UPDATE spff.adaptive_fert_sessions SET status='fault' WHERE session_id=$1",[previous.session_id]);
   await assert.rejects(makePlan(),/belum direkonsiliasi/);
   summary.production_fuzzy.irrigation_needed=false;
   const plan=await service.createDoseVolumePlan({mode:'fertigation',execution:'water_first',
    obligationId,requestId:randomUUID()},'operator');
   assert.equal(plan.recipe.waterFirst,true);
   assert.equal(plan.executionReady,false);
   assert.deepEqual(plan.recipe.blockers,['water_first_dispatch_pending']);
   await assert.rejects(approve(plan),/hanya untuk peninjauan/);
   assert.equal((await query('SELECT 1 FROM spff.control_commands')).rows.length,0);
   assert.equal((await query('SELECT 1 FROM spff.hst_dose_pulse_commands')).rows.length,0);
   assert.equal((await service.readDoseVolumeSession(previous.session_id)).evidence_verified,false);
  });
  await t.test('HST ACC publishes one combined pulse and credits only the confirmed meter delta',async()=>{
   await fixture();
   const env={SPFF_HST_DOSE_PULSES_ENABLED:'true',SPFF_HST_MAX_STOCK_FLOW_LPM:'25',SPFF_HST_MIN_WATER_FLOW_LPM:'5'};
   Object.assign(process.env,env);
   try{
    await db.exec(`UPDATE spff.device_automatic_control_configs SET desired_mode='automatic',applied_mode='automatic',water_enabled=true,
     water_moisture_low_pct=10,water_moisture_target_pct=30,water_max_runtime_seconds=120,water_cooldown_seconds=60,water_min_flow_lpm=5;
     UPDATE spff.device_status_events SET mode='automatic',raw_payload=(raw_payload-'doseVolumeV1')||
       '{"serverPulseCapable":true,"serverPulseOwner":false,"waterInterlockEnabled":true,"aiAccTankGuardHealthy":true}'::jsonb;
     UPDATE spff.telemetry_samples SET flow_water_total_l=100,flow_fert_total_l=20,
       sensor_health=sensor_health||'{"flow_water_total_l":{"valid":true},"flow_fert_total_l":{"valid":true}}'::jsonb;`);
    const plan=await makePlan();
    assert.equal(plan.executionReady,true);
    const run=await approve(plan), messages=[];
    const pulseTransport=new SoilEcPulseTransport(async command=>{messages.push(command)},database);
    await pulseTransport.dispatch();
    assert.deepEqual(messages.map(p=>p.kind),['fertigation_pulse']);
    assert.equal(messages[0].params.waterWithPulse,true);
    const confirm=async command=>pulseTransport.saveAck({kind:'fertigation_pulse_ack',schemaVersion:1,
     siteId:command.siteId,deviceId:command.deviceId,sessionId:command.sessionId,commandId:command.commandId,
     cycle:command.cycle,status:'completed',acknowledgedAt:new Date().toISOString(),pumpsOff:true,reason:'confirmed_off'});
    await confirm(messages[0]);
    await db.exec("UPDATE spff.hst_dose_pulse_commands SET expires_at=now()-interval '1 second' WHERE operation='pulse'");
    await pulseTransport.dispatch();
    assert.equal(messages[1].kind,'fertigation_pulse_stop');
    await confirm(messages[1]);
    assert.equal((await service.readDoseVolumeSession(run.session_id)).evidence_verified,false);
    for(const sequence of [2,3]){
     await query(`INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at,received_at,
        flow_water_total_l,flow_fert_total_l,sensor_health,raw_payload)
       SELECT site_id,device_id,$1,$2::bigint,now()+$2::bigint*interval '1 millisecond',now(),110,22,sensor_health,raw_payload
       FROM spff.telemetry_samples WHERE sequence=1`,[randomUUID(),sequence]);
    }
    await new Promise(resolve=>setTimeout(resolve,15));
    await pulseTransport.dispatch();
    assert.equal(messages[2].kind,'fertigation_pulse_release');
    await confirm(messages[2]);
    await pulseTransport.dispatch();
    const final=await service.readDoseVolumeSession(run.session_id);
    assert.equal(final.status,'completed');
    assert.equal(final.fert_volume_l,2);
    assert.equal(final.credited_g,8);
    const progress=await service.doseVolumeCredits(proposals.proposals[0]);
    assert.equal(progress.remaining_g,392);
   }finally{for(const key of Object.keys(env))delete process.env[key];}
  });
  await t.test('recipe uses Guide remaining mass and tank liters, without EC or manual dose injection',async()=>{
   await fixture();const plan=await makePlan();assert.equal(plan.recipe.recipe.batchMassG,400);
   assert.equal(plan.recipe.recipe.batchVolumeL,100);assert.equal(plan.recipe.recipe.targetStockL,90);
   assert.equal(plan.recipe.recipe.plannedMassG,360);assert.equal(plan.recipe.recipe.remainingAfterSessionG,40);
   assert.equal(plan.recipe.recipe.targetWaterL,2250);assert.equal(plan.executionReady,true);
   assert.equal((await query('SELECT count(*)::int n FROM spff.adaptive_fert_commands')).rows[0].n,0);
   await assert.rejects(service.createDoseVolumePlan({mode:'fertigation',obligationId,requestId:randomUUID(),massG:900},'operator'));
  });
  await t.test('legacy firmware and disabled flag stay blocked without a fake EC profile',async()=>{
   await fixture();await query("UPDATE spff.device_status_events SET raw_payload=jsonb_set(raw_payload,'{firmwareVersion}','\"1.5.07-AI-ACC-SESSION\"')");
   delete process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED;
   const plan=await makePlan();assert.equal(plan.executionReady,false);
   assert.ok(plan.recipe.blockers.includes('commissioned_dose_volume_firmware_required'));
   assert.equal((await service.readDoseVolumeReadiness('esp32-s3-01')).firmwareReady,false);
   await assert.rejects(approve(plan),/belum aktif/);
  });
  await t.test('concurrent ACC retry creates one durable START and persists the operator preparation',async()=>{
   await fixture();const plan=await makePlan();const input={planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true,confirmApplicationRoute:true};
   const [a,b]=await Promise.all([service.approveDoseVolume(input,'operator'),service.approveDoseVolume(input,'operator')]);
   assert.equal(a.session_id,b.session_id);assert.equal((await query('SELECT count(*)::int n FROM spff.adaptive_fert_commands')).rows[0].n,1);
   const command=(await snapshot(a.session_id)).command_snapshot;
   assert.equal(command.kind,'dose_volume_command');assert.equal(command.targetMassG,360);assert.equal(command.targetEcUs,undefined);
   await assert.rejects(service.approveDoseVolume(input,'other-operator'),/konflik/);
   await assert.rejects(setHstMode(true,'admin'),/aktif/);
  });
  await t.test('route approval and changed Guide revisions are rechecked at ACC',async()=>{
   await fixture();const plan=await makePlan();
   await assert.rejects(service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true},'operator'),/jalur pompa/);
   await query('UPDATE spff.guide_programs SET revision=2');
   await assert.rejects(approve(plan),/Panduan|berubah/);
   assert.equal((await query('SELECT count(*)::int n FROM spff.adaptive_fert_sessions')).rows[0].n,0);
  });
  await t.test('measured terminal telemetry plus matching ACK credit once, in either arrival order',async()=>{
   for(const order of ['telemetry-first','ack-first']){
    await fixture();const run=await approve(await makePlan());const command=(await snapshot(run.session_id)).command_snapshot;
    const a=ack(command),p=telemetry(command);
    await event(order==='ack-first'?a:p);
    assert.equal((await service.readDoseVolumeSession(run.session_id)).credited_g,0);
    await event(order==='ack-first'?p:a);await event(a);await event(p);
    const result=await service.readDoseVolumeSession(run.session_id);
    assert.equal(result.credited_g,360);assert.equal(result.evidence_verified,true);assert.equal(result.status,'completed');
    assert.equal((await service.doseVolumeCredits(proposals.proposals[0])).remaining_g,40);
    await assert.rejects(service.assertLegacyHstNotVolumeBound(obligationId),/ledger/);
   }
  });
  await t.test('wrong boot, estimated meters and terminal pumps ON never credit plant dose',async()=>{
   for(const overrides of [{bootId:'ffffffffffffffff'},{volumeEstimated:true},{fertPump:true}]){
    await fixture();const run=await approve(await makePlan());const command=(await snapshot(run.session_id)).command_snapshot;
    await event(telemetry(command,overrides));await event(ack(command));
    const result=await service.readDoseVolumeSession(run.session_id);
    assert.equal(result.credited_g,0);assert.equal(result.status,'reconciliation_required');
   }
  });
  await t.test('STOP is idempotent, cancels queued START, and does not claim physical OFF',async()=>{
   await fixture();const run=await approve(await makePlan());const requestId=randomUUID();
   const visible=await service.listDoseVolumeSessions();
   assert.deepEqual(visible.map(row=>[row.session_id,row.status]),[[run.session_id,'queued']]);
   const stop=await service.stopDoseVolume(run.session_id,requestId,'operator');
   assert.deepEqual(await service.stopDoseVolume(run.session_id,requestId,'operator'),stop);
   assert.equal((await service.readDoseVolumeSession(run.session_id)).evidence_verified,false);
   assert.equal((await query("SELECT status FROM spff.adaptive_fert_commands WHERE payload->>'commandType'='start'")).rows[0].status,'cancelled');
   await transport.dispatch();assert.equal(published.length,1);assert.equal(published[0].command.kind,'dose_volume_command');
   assert.equal(published[0].command.commandType,'stop');
  });
  await t.test('fresh valid zero water queues one STOP with START dispatch disabled',async()=>{
   await fixture();const run=await approve(await makePlan());
   await query(`UPDATE spff.telemetry_samples SET recorded_at=now(),tank_water_level_pct=0,
    sensor_health=jsonb_set(sensor_health,'{tank_water_level_pct,valid}','false')`);
   delete process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED;
   await transport.dispatch();
   assert.equal(published.length,0,'invalid zero is not an empty reading');
   await query(`UPDATE spff.telemetry_samples SET recorded_at=now()-interval '90 seconds',
    sensor_health=jsonb_set(sensor_health,'{tank_water_level_pct,valid}','true')`);
   await transport.dispatch();
   assert.equal(published.length,0,'stale zero is not an empty reading');
   await query('UPDATE spff.telemetry_samples SET recorded_at=now()');
   await transport.dispatch();await transport.dispatch();
   assert.equal(published.length,1);
   assert.equal(published[0].command.commandType,'stop');
   assert.equal(published[0].command.sessionId,run.session_id);
   const session=await service.readDoseVolumeSession(run.session_id);
   assert.equal(session.reason,'stop_requested_by:tank_water_empty');
   assert.equal(session.evidence_verified,false);
   assert.equal((await query("SELECT status FROM spff.adaptive_fert_commands WHERE payload->>'commandType'='start'")).rows[0].status,'cancelled');
  });
  await t.test('water-only has no stock target or fertilizer credit',async()=>{
   await fixture();const plan=await service.createDoseVolumePlan({mode:'water_only',programId:pid,activityId:'row-19',requestId:randomUUID()},'operator');
   const run=await service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true},'operator');
   const command=(await snapshot(run.session_id)).command_snapshot;
   assert.equal(command.targetStockVolumeL,0);assert.equal(command.targetMassG,0);
   await event(ack(command));await event(telemetry(command));
   assert.equal((await service.readDoseVolumeSession(run.session_id)).credited_g,0);
  });
  await t.test('water-only starts from live tank level and completes at low water without a liter target',async()=>{
   await fixture();
   await query(`UPDATE spff.device_status_events SET raw_payload=(raw_payload-'doseVolumeV1') ||
    '{"waterUntilLowV1":{"contract":"spff-water-until-low-v1","maxDurationSec":600},
      "waterInterlockEnabled":true,"aiAccTankGuardHealthy":true}'::jsonb`);
   const plan=await service.createDoseVolumePlan({mode:'water_only',programId:pid,activityId:'row-19',requestId:randomUUID()},'operator');
   assert.equal(plan.executionReady,true);
   assert.equal(plan.calculationReady,true);
   assert.equal(plan.recipe.recipe.targetWaterL,null);
   await query('UPDATE spff.telemetry_samples SET tank_water_level_pct=0');
   await assert.rejects(service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true},'operator'),/sensor|tandon/i);
   await query('UPDATE spff.telemetry_samples SET tank_water_level_pct=50');
   const run=await service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true},'operator');
   const command=(await snapshot(run.session_id)).command_snapshot;
   assert.equal(command.controlAlgorithm,'water_until_low_v1');
   assert.equal(command.targetWaterVolumeL,undefined);
   await transport.dispatch();
   assert.equal(published[0].command.controlAlgorithm,'water_until_low_v1');
   await event(ack(command,{reason:'water_low_reached'}));
   await event(telemetry(command,{reason:'water_low_reached',waterVolumeL:120,stockVolumeL:0}));
   const result=await service.readDoseVolumeSession(run.session_id);
   assert.equal(result.status,'completed');
   assert.equal(result.water_volume_l,120);
   assert.equal(result.credited_g,0);
  });
  async function serverWaterFixture(){
   await fixture();
   await query(`INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)
    VALUES('greenhouse-01','esp32-s3-01','pump_water','Water')`);
   await query(`INSERT INTO spff.device_water_interlock_configs(site_id,device_id,updated_by,acknowledgement_status,acknowledged_revision,applied_enabled)
    VALUES('greenhouse-01','esp32-s3-01','fixture','applied',1,true)`);
   await query('UPDATE spff.device_automatic_control_configs SET water_max_runtime_seconds=600');
   await query(`UPDATE spff.device_status_events SET raw_payload=(raw_payload-'doseVolumeV1') ||
    '{"firmwareVersion":"1.5.12-DHT-DOSE-VOLUME-STAGING","waterInterlockConfigCapable":true,
      "waterInterlockEnabled":true,"aiAccTankGuardHealthy":true,"waterInterlockRevision":1}'::jsonb`);
   await query(`UPDATE spff.telemetry_samples SET flow_water_total_l=100,
    sensor_health=sensor_health||'{"flow_water_total_l":{"valid":true}}'::jsonb`);
  }
  await t.test('server water uses ordinary pump ON/OFF on 1.5.12 and waits for measured OFF',async()=>{
   await serverWaterFixture();
   const plan=await service.createDoseVolumePlan({mode:'water_only',programId:pid,activityId:'row-19',requestId:randomUUID()},'operator');
   assert.equal(plan.recipe.serverWater,true);
   assert.equal(plan.executionReady,true);
   const run=await service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true},'operator');
   const command=(await snapshot(run.session_id)).command_snapshot;
   assert.equal(command.kind,'server_water_control');
   const on=(await query('SELECT * FROM spff.control_commands')).rows[0];
   assert.equal(on.requested_is_active,true);
   assert.equal(on.actuator_key,'pump_water');
   await assert.rejects(query('UPDATE spff.device_water_interlock_configs SET enabled=false'),/server_water_session_owns_interlock/);
   await transport.dispatch();assert.equal(published.length,0,'no firmware-specific message');
   await query(`UPDATE spff.control_commands SET status='completed',issued_at=now()-interval '30 seconds',
    expires_at=now()-interval '10 seconds' WHERE command_id=$1`,[on.command_id]);
   await query('UPDATE spff.telemetry_samples SET tank_water_level_pct=0,flow_water_total_l=125,recorded_at=now()');
   await transport.dispatch();await transport.dispatch();
   const off=(await query('SELECT * FROM spff.control_commands WHERE NOT requested_is_active')).rows;
   assert.equal(off.length,1);
   assert.equal((await service.readDoseVolumeSession(run.session_id)).evidence_verified,false);
   await query(`INSERT INTO spff.command_ack_events(command_id,status,actual_is_active,acknowledged_at)
    VALUES($1,'completed',false,now())`,[off[0].command_id]);
   await query('UPDATE spff.telemetry_samples SET recorded_at=now(),flow_water_total_l=126');
   await query('UPDATE spff.device_status_events SET recorded_at=now()');
   await transport.dispatch();
   const result=await service.readDoseVolumeSession(run.session_id);
   assert.equal(result.status,'completed');
   assert.equal(result.water_volume_l,26);
   assert.equal(result.evidence_verified,true);
  });
  await t.test('server water requests OFF on stale telemetry and cancels unpublished ON',async()=>{
   await serverWaterFixture();
   const plan=await service.createDoseVolumePlan({mode:'water_only',programId:pid,activityId:'row-19',requestId:randomUUID()},'operator');
   const run=await service.approveDoseVolume({planId:plan.planId,approvalId:randomUUID(),preparedBatchConfirmed:true},'operator');
   await query("UPDATE spff.telemetry_samples SET recorded_at=now()-interval '61 seconds'");
   await transport.dispatch();await transport.dispatch();
   const commands=(await query('SELECT requested_is_active,status FROM spff.control_commands ORDER BY requested_is_active DESC')).rows;
   assert.deepEqual(commands,[{requested_is_active:true,status:'failed'},{requested_is_active:false,status:'pending'}]);
   const session=await service.readDoseVolumeSession(run.session_id);
   assert.equal(session.reason,'sensor_stale_or_meter_invalid');
   assert.equal(session.evidence_verified,false);
  });
  await t.test('legacy emergency STOP is converted for a volume session with START gates OFF',async()=>{
   await fixture();const run=await approve(await makePlan());
   await query("UPDATE spff.adaptive_fert_commands SET status='cancelled'");
   const commandId=randomUUID();
   await query(`INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)
    VALUES('greenhouse-01',$1,$2,$3,$4,now()+interval '15 seconds')`,[commandId,run.session_id,randomUUID(),JSON.stringify({
    kind:'adaptive_fert_command',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:run.session_id,commandId,commandType:'stop'})]);
   delete process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED;delete process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED;
   await transport.dispatch();assert.equal(published.length,1);
   assert.equal(published[0].command.kind,'dose_volume_command');assert.equal(published[0].command.bootId,boot);
   assert.equal(published[0].command.commandType,'stop');
  });
  await t.test('worker has an independent volume gate and never republishes an uncertain START',async()=>{
   await fixture();await approve(await makePlan());
   delete process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED;
   await transport.dispatch();assert.equal(published.length,0);
   process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED='true';
   await transport.dispatch();await transport.dispatch();
   assert.equal(published.length,1);assert.equal(published[0].command.kind,'dose_volume_command');
   assert.equal(published[0].command.targetEcUs,undefined);
  });
  await t.test('stale Fuzzy evidence, manual completion and expired plans cannot start pumps',async()=>{
   await fixture();summary.production_fuzzy.expires_at=new Date(Date.now()-1000).toISOString();
   await assert.rejects(makePlan(),/Fuzzy/);
   await fixture();const plan=await makePlan();
   await query("UPDATE spff.dose_volume_plans SET valid_until=now()-interval '1 second'");
   await assert.rejects(approve(plan),/kedaluwarsa/);
   assert.equal((await query('SELECT count(*)::int n FROM spff.adaptive_fert_commands')).rows[0].n,0);
   await fixture();await query(`INSERT INTO spff.guide_program_completions(site_id,program_id,activity_id,activity_fingerprint,program_revision,activity_snapshot,actor)
    VALUES('greenhouse-01',$1,'row-19','fixture-completed',1,'{}','fixture')`,[pid]);
   await assert.rejects(makePlan(),/selesai manual/);
  });
  await t.test('counter rollback remains uncertain even after requesting STOP',async()=>{
   await fixture();const run=await approve(await makePlan());const command=(await snapshot(run.session_id)).command_snapshot;
   await event(telemetry(command,{state:'INJECTING',waterPump:true,fertPump:true,waterVolumeL:100,stockVolumeL:10}));
   await event(telemetry(command,{state:'INJECTING',waterPump:true,fertPump:true,waterVolumeL:90,stockVolumeL:9,timestamp:new Date(Date.now()+1).toISOString()}));
   await service.stopDoseVolume(run.session_id,randomUUID(),'operator');
   await event(ack(command));await event(telemetry(command));
   const result=await service.readDoseVolumeSession(run.session_id);
   assert.equal(result.credited_g,0);assert.equal(result.status,'reconciliation_required');
  });
  await t.test('explicit reconciliation credits partial delivery once and preserves the rest of the Guide dose',async()=>{
   await fixture();const run=await approve(await makePlan());const command=(await snapshot(run.session_id)).command_snapshot;
   await event(telemetry(command,{volumeEstimated:true}));
   const input={requestId:randomUUID(),pumpsOffVerified:true,waterVolumeL:100,stockVolumeL:10,reference:'External measured fixture volume and pump OFF check'};
   await assert.rejects(service.reconcileDoseVolume(run.session_id,input,'admin'),/kedaluwarsa/);
   await query("UPDATE spff.adaptive_fert_commands SET expires_at=now()-interval '1 second'");
   const first=await service.reconcileDoseVolume(run.session_id,input,'admin');
   assert.equal(first.credited_g,40);assert.equal(first.evidence_basis,'OPERATOR_RECONCILED');
   assert.deepEqual(await service.reconcileDoseVolume(run.session_id,input,'admin'),first);
   assert.equal((await service.doseVolumeCredits(proposals.proposals[0])).remaining_g,360);
   await assert.rejects(service.reconcileDoseVolume(run.session_id,{...input,stockVolumeL:11},'admin'),/konflik/);
  });
 }finally{globalThis.fetch=oldFetch;repo.pool.query=oldQuery;repo.pool.connect=oldConnect;delete process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED;await repo.pool.end();await db.close();}
});
