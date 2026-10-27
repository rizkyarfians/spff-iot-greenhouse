import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional PostgreSQL-WASM integration. No live DB or device is contacted.
// Install PGlite into a disposable directory and set SPFF_TEST_PGLITE_MODULE
// to its absolute dist/index.js path. See docs/server-soil-ec-pulses.md.
test('soil EC session SQL lifecycle, dispatch identity, durable ACKs and one-pulse reservation',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
  const db=new PGlite();
  process.env.DATABASE_URL='postgres://test:test@localhost/test';
  process.env.MQTT_URL='mqtt://localhost:1883';
  process.env.SPFF_SOIL_EC_PULSES_ENABLED='true';
  process.env.AI_EVALUATION_ENABLED='true';
  const base=resolve(import.meta.dirname,'../..');
  const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
  const client={query,release(){}};
  const adapter={query,connect:async()=>client,end:async()=>{}};
  const repo=await import('../lib/services/postgresRepository.js');
  const realEnd=repo.pool.end.bind(repo.pool);
  repo.pool.query=query;repo.pool.connect=adapter.connect;
  try{
    await db.exec('CREATE ROLE spff_app; CREATE ROLE spff_worker; CREATE ROLE spff_sync; CREATE ROLE spff_backup_role;');
    for(const name of readdirSync(resolve(base,'infrastructure/postgres/migrations')).sort())
      await db.exec(readFileSync(resolve(base,'infrastructure/postgres/migrations',name),'utf8'));
    await db.exec(`INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test');
      INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test');
      INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)VALUES
        ('greenhouse-01','esp32-s3-01','pump_fert','Test'),('greenhouse-01','esp32-s3-01','pump_water','Test');
      INSERT INTO spff.device_automatic_control_configs(site_id,device_id,revision,desired_mode,water_enabled,
        water_moisture_low_pct,water_moisture_target_pct,water_max_runtime_seconds,water_cooldown_seconds,water_min_flow_lpm,
        acknowledged_revision,acknowledgement_status,applied_mode)
      VALUES('greenhouse-01','esp32-s3-01',1,'automatic',true,30,60,20,60,1,1,'applied','automatic');
      INSERT INTO spff.site_crop_selections(site_id,zone_id,crop_id,selected_by)VALUES('greenhouse-01','soil-1','tomato','test-admin');
      INSERT INTO spff.actuator_schedules(schedule_id,site_id,device_id,actuator_key,on_time,off_time,repeat_rule,requested_by)
        VALUES('test','greenhouse-01','esp32-s3-01','pump_fert','00:00','23:59:59','daily','test');
      UPDATE spff.device_schedule_sync_state SET acknowledged_revision=revision,acknowledgement_status='applied';
      INSERT INTO spff.device_status_events(site_id,device_id,message_id,recorded_at,online,mode,raw_payload)
        VALUES('greenhouse-01','esp32-s3-01','status-test',now(),true,'automatic','{"serverPulseCapable":true,"pulseBootId":"0123456789abcdef"}');`);
    const {createFertigationRecipe}=await import('../lib/services/fertigationRepository.js');
    const {jakartaDay}=await import('../lib/services/fertigationSchedule.js');
    const service=await import('../lib/services/soilEcPulseService.js');
    const rule=await createFertigationRecipe({cropId:'tomato',cropName:'Tomat',hstFrom:0,hstTo:100,
      plantingDate:jakartaDay(new Date()),applicationDate:null,applicationMode:'sensor',applicationIntervalDays:null,
      triggerSampleCount:3,targetWaterL:10,targetStockL:0.5,fertilizerName:'Test',stockConcentrationGPerL:100,
      minWaterTankPercent:0,minStockTankPercent:0,sourceReference:'Test only',useForEvaluation:true,
      moistureLowPercent:30,moistureTargetPercent:60,ecLowUsCm:500,ecTargetUsCm:1200,ecHighUsCm:1500},'test-admin');
    const profile={calibrationReference:'TEST ONLY not a dosage recommendation',soilEcTargetsVerified:true,hydraulicsVerified:true,
      kpMsPerUsCm:10,minOnMs:1500,maxOnMs:10000,settleMs:1000,maxSessionMs:3600000,maxTotalOnMs:30000,maxDailyOnMs:60000,
      maxCycles:10,stableSamples:3,stableSpreadUsCm:20,toleranceUsCm:25,minimumRiseUsCm:10,maxNoResponseCycles:2,
      moistureMinPercent:30,moistureMaxPercent:60,cooldownMs:1000,waterWithPulse:false,flowSensorKey:'flow_fert_lpm',minFlowLpm:1};
    const input={deviceId:'esp32-s3-01',recipeId:rule.recipeId,requestId:'00000000-0000-4000-8000-000000000001',profile};
    // Deployment flags alone cannot arm the new per-device web permission.
    let execution=await service.readSoilEcExecution(input.deviceId);
    assert.equal(execution.enabled,false);assert.equal(execution.revision,0);
    await assert.rejects(service.startSoilEcSession(input,'test-admin'),/Settings/);
    execution=await service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:0,enabled:true},'test-admin');
    assert.equal(execution.revision,1);assert.equal(execution.enabled,true);
    assert.equal((await service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:0,enabled:true},'test-admin')).revision,1);
    await assert.rejects(service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:0,enabled:false},'test-admin'),/berubah/);
    await assert.rejects(service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:1,enabled:'false'},'test-admin'));
    const s=await service.startSoilEcSession(input,'test-admin');
    assert.equal((await service.startSoilEcSession(input,'test-admin')).session_id,s.session_id);
    await assert.rejects(service.startSoilEcSession({...input,profile:{...profile,maxCycles:9}},'test-admin'));
    await assert.rejects(service.startSoilEcSession({...input,requestId:'00000000-0000-4000-8000-000000000009'},'test-admin'));
    async function readings(ec){
      await query(`DELETE FROM spff.telemetry_samples`);
      for(let i=0;i<3;i++)await query(`INSERT INTO spff.telemetry_samples
        (site_id,device_id,message_id,sequence,recorded_at,soil_1_ec_us_cm,soil_1_moisture,tank_water_level_pct,tank_fert_level_pct,sensor_health)
        VALUES('greenhouse-01','esp32-s3-01',$1,$2,now()-($2::bigint*interval '1 second'),$3,40,80,80,$4)`,
        [`sample-${i}`,i,ec,JSON.stringify({soil_1_ec_us_cm:{valid:true},soil_1_moisture:{valid:true},tank_water_level_pct:{valid:true},tank_fert_level_pct:{valid:true}})]);
      await query(`UPDATE spff.soil_ec_pulse_sessions SET settle_until=now()-interval '10 seconds' WHERE session_id=$1`,[s.session_id]);
    }
    await readings(400);await service.advanceSoilEcSession(s.session_id);
    let row=(await query('SELECT * FROM spff.soil_ec_pulse_sessions')).rows[0];
    assert.equal(row.cycles,1);assert.equal(Number(row.total_on_ms),8000);
    await service.advanceSoilEcSession(s.session_id);
    assert.equal((await query('SELECT * FROM spff.soil_ec_pulse_commands')).rows.length,1);
    const pc=(await query('SELECT * FROM spff.soil_ec_pulse_commands')).rows[0];
    const {SoilEcPulseTransport}=await import('../../mqtt-worker/dist/soilEcPulseTransport.js');
    const published=[];const transport=new SoilEcPulseTransport(async p=>{published.push(p)},adapter);
    process.env.SPFF_SOIL_EC_PULSES_ENABLED='false';
    await transport.dispatch();assert.equal(published.length,0);
    process.env.SPFF_SOIL_EC_PULSES_ENABLED='true';
    await query('UPDATE spff.device_soil_ec_execution_configs SET enabled=false');
    await transport.dispatch();assert.equal(published.length,0); // independent worker gate
    await query('UPDATE spff.device_soil_ec_execution_configs SET enabled=true');
    await transport.dispatch();assert.equal(published.length,1);assert.equal(published[0].params.onDurationMs,8000);
    await assert.rejects(transport.saveAck({kind:'fertigation_pulse_ack',schemaVersion:1,siteId:'other',deviceId:input.deviceId,
      sessionId:s.session_id,commandId:pc.command_id,cycle:1,status:'completed',pumpsOff:true,reason:'test',acknowledgedAt:new Date().toISOString()}));
    const ack={kind:'fertigation_pulse_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:input.deviceId,
      sessionId:s.session_id,commandId:pc.command_id,cycle:1,status:'completed',pumpsOff:true,reason:'pulse_duration_elapsed',acknowledgedAt:new Date().toISOString()};
    await assert.rejects(transport.saveAck({...ack,pumpsOff:false}));
    await transport.saveAck(ack);await transport.saveAck(ack);
    await transport.saveAck({...ack,status:'accepted',pumpsOff:false});
    assert.equal((await query('SELECT status FROM spff.soil_ec_pulse_commands WHERE command_id=$1',[pc.command_id])).rows[0].status,'completed');
    assert.equal((await query('SELECT * FROM spff.soil_ec_pulse_ack_events')).rows.length,2);
    await service.advanceSoilEcSession(s.session_id);
    row=(await query('SELECT * FROM spff.soil_ec_pulse_sessions')).rows[0];assert.equal(row.status,'waiting');
    // Same samples from before ACK cannot initiate another pulse.
    assert.equal((await query("SELECT * FROM spff.soil_ec_pulse_commands WHERE operation='pulse'")).rows.length,1);
    // Four sequential pulses, each recalculated from NEW soil EC, never an open-loop batch.
    for(const [ec,cycle,onMs] of [[600,2,6000],[800,3,4000],[1000,4,2000]]){
      await readings(ec);await service.advanceSoilEcSession(s.session_id);
      const next=(await query("SELECT * FROM spff.soil_ec_pulse_commands WHERE operation='pulse' ORDER BY cycle DESC LIMIT 1")).rows[0];
      assert.equal(next.cycle,cycle);assert.equal(next.payload.params.onDurationMs,onMs);
      await service.advanceSoilEcSession(s.session_id);
      assert.equal((await query("SELECT * FROM spff.soil_ec_pulse_commands WHERE operation='pulse'")).rows.length,cycle);
      await transport.saveAck({...ack,commandId:next.command_id,cycle});
      await service.advanceSoilEcSession(s.session_id);
    }
    await readings(1200);await service.advanceSoilEcSession(s.session_id);
    row=(await query('SELECT * FROM spff.soil_ec_pulse_sessions')).rows[0];assert.equal(row.status,'completed');
    assert.equal(row.reason,'soil_ec_target_stable');
    assert.equal(Number(row.total_on_ms),20000);
    assert.equal((await query("SELECT * FROM spff.soil_ec_pulse_commands WHERE operation='pulse'")).rows.length,4);
    assert.equal((await query("SELECT * FROM spff.soil_ec_pulse_commands WHERE operation='stop'")).rows.length,1);
    process.env.SPFF_SOIL_EC_PULSES_ENABLED='false';
    published.length=0;await transport.dispatch();assert.equal(published.length,1);assert.equal(published[0].kind,'fertigation_pulse_stop');
    await assert.rejects(service.releaseSoilEcOwnership(s.session_id));
    await db.exec("UPDATE spff.device_automatic_control_configs SET desired_mode='manual',applied_mode='manual'; UPDATE spff.device_automatic_control_configs SET acknowledged_revision=revision,acknowledgement_status='applied';");
    await service.releaseSoilEcOwnership(s.session_id);
    assert.equal((await query("SELECT * FROM spff.soil_ec_pulse_commands WHERE operation='release'")).rows.length,1);
    // An in-flight session is cancelled atomically with OFF; outstanding pulses cannot replay.
    const id='00000000-0000-4000-8000-000000000050';
    await query(`INSERT INTO spff.soil_ec_pulse_sessions(session_id,request_id,site_id,device_id,recipe_id,
      application_day,recipe_revision,profile,rule_snapshot,status,requested_by,cycles)
      SELECT $1,$1,site_id,device_id,recipe_id,application_day+1,recipe_revision,profile,rule_snapshot,'in_flight',requested_by,1
      FROM spff.soil_ec_pulse_sessions WHERE session_id=$2`,[id,s.session_id]);
    const pending={...pc.payload,sessionId:id,commandId:'00000000-0000-4000-8000-000000000051',
      issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15000).toISOString()};
    await query(`INSERT INTO spff.soil_ec_pulse_commands(command_id,session_id,cycle,operation,payload,expires_at)
      VALUES($1,$2,1,'pulse',$3,$4)`,[pending.commandId,id,JSON.stringify(pending),pending.expiresAt]);
    // OFF must work with env flags OFF and device offline.
    await query('DELETE FROM spff.device_status_events');
    execution=await service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:1,enabled:false},'test-admin');
    assert.equal(execution.enabled,false);assert.equal(execution.revision,2);
    assert.ok(execution.unconfirmedStopSessions>0);
    assert.equal((await query('SELECT status FROM spff.soil_ec_pulse_sessions WHERE session_id=$1',[id])).rows[0].status,'cancelled');
    process.env.SPFF_SOIL_EC_PULSES_ENABLED='true';
    published.length=0;await transport.dispatch();
    assert.ok(published.some(p=>p.sessionId===id&&p.kind==='fertigation_pulse_stop'));
    assert.ok(published.every(p=>p.kind!=='fertigation_pulse'));
    await service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:2,enabled:true},'test-admin');
    await service.advanceSoilEcSession(id);
    assert.equal((await query('SELECT status FROM spff.soil_ec_pulse_sessions WHERE session_id=$1',[id])).rows[0].status,'cancelled');
    // The deployment gate can still prevent arming despite a stored permission.
    process.env.AI_EVALUATION_ENABLED='false';
    await assert.rejects(service.setSoilEcExecution({deviceId:input.deviceId,expectedRevision:3,enabled:true},'test-admin'),/server/);
    await query('DROP TABLE spff.device_soil_ec_execution_configs');
    execution=await service.readSoilEcExecution(input.deviceId);
    assert.equal(execution.installed,false);assert.equal(execution.enabled,false);
    await query("UPDATE spff.soil_ec_pulse_commands SET last_published_at=NULL WHERE operation='stop'");
    process.env.SPFF_SOIL_EC_PULSES_ENABLED='false';
    published.length=0;await transport.dispatch();
    assert.ok(published.some(p=>p.sessionId===id&&p.kind==='fertigation_pulse_stop'));
    assert.ok(published.every(p=>p.kind!=='fertigation_pulse'));
  }finally{await realEnd();await db.close();}
});
