import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

test('explicit operator override keeps automatic mode, dispatches its own identity, and resumes only after fresh OFF',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite();
 const {pool,repository}=await import('../lib/services/postgresRepository.js');
 process.env.DATABASE_URL??='postgresql://test:test@127.0.0.1:1/test';
 process.env.MQTT_URL??='mqtt://127.0.0.1:1';
 const {PostgresIngestionRepository}=await import('../../mqtt-worker/dist/repository.js');
 const {CommandDispatchService}=await import('../../mqtt-worker/dist/commandDispatchService.js');
 const originalQuery=pool.query,originalConnect=pool.connect;
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const c={query,release(){}};
 try {
  const dir=new URL('../../infrastructure/postgres/migrations/',import.meta.url);
  for(const n of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(n,dir),'utf8'));
  pool.query=query;pool.connect=async()=>c;
  await db.exec(`INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','test');
   INSERT INTO spff.devices(site_id,device_id,display_name) VALUES('greenhouse-01','esp32-s3-01','test');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name) VALUES
    ('greenhouse-01','esp32-s3-01','pump_water','Water'),('greenhouse-01','esp32-s3-01','pump_fert','Fert');
   INSERT INTO spff.device_automatic_control_configs(site_id,device_id,desired_mode,applied_mode,
    water_enabled,water_moisture_low_pct,water_moisture_target_pct,water_max_runtime_seconds,water_cooldown_seconds,water_min_flow_lpm,
    acknowledged_revision,acknowledgement_status) VALUES('greenhouse-01','esp32-s3-01','automatic','automatic',true,23,60,900,30,5,1,'applied');`);
  const heartbeat=async(raw={})=>query(`INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01',true,'automatic',now(),$1)`,[JSON.stringify({pumpReadbackValid:true,pumpWaterActualActive:false,pumpFertActualActive:false,...raw})]);
  await heartbeat();
  await assert.rejects(()=>repository.updatePump('pump_water',true,'operator','web-legacy-on'),/automatic mode/);
  await assert.rejects(()=>repository.updatePump('pump_water',true,'operator','web-no-capability',true),/operatorOverrideCapable/);
  assert.equal((await repository.automaticControl()).operatorOverrideActive,false);
  await heartbeat({operatorOverrideCapable:true});
  await repository.updatePump('pump_water',true,'operator','web-override-on',true);
  let config=await repository.automaticControl();
  assert.equal(config.desiredMode,'automatic');assert.equal(config.appliedMode,'automatic');
  assert.equal(config.operatorOverrideActive,true);assert.equal(config.revision,1);
  assert.equal((await query("SELECT request_payload->>'operatorOverride' AS flag FROM spff.control_commands WHERE command_id='web-override-on'")).rows[0].flag,'true');
  const worker=new PostgresIngestionRepository({query,connect:async()=>c,end:async()=>{}});
  let pending=await worker.pendingCommands(10);
  assert.equal(pending.length,1);assert.equal(pending[0].operatorOverride,true);assert.equal(pending[0].requestedBy,'operator');
  const published=[];
  const dispatch=new CommandDispatchService(worker,{publishCommand:async m=>published.push(m)});
  await dispatch.runOnce();
  assert.equal(published[0].params.operatorOverride,true);assert.equal(published[0].params.isActive,true);
  assert.equal(published[0].requestedBy,'operator','never impersonates an automatic schedule');
  await repository.updatePump('pump_water',true,'operator','web-override-on',true);
  assert.equal(Number((await query('SELECT count(*) AS n FROM spff.control_commands')).rows[0].n),1,'same request deduplicates');
  await assert.rejects(()=>repository.updatePump('pump_water',true,'operator','web-override-on'),/different target or parameter/);
  await assert.rejects(()=>repository.updatePump('pump_fert',true,'operator','web-second-on',true),/sebelumnya selesai/);
  await heartbeat({operatorOverrideCapable:false,pumpReadbackValid:false});
  await repository.updatePump('pump_water',false,'operator','web-emergency-off',true);
  assert.equal((await worker.pendingCommands(10))[0].commandId,'web-emergency-off','OFF can preempt a published ON without a new capability or valid sensor');
  await query("UPDATE spff.control_commands SET status='completed' WHERE command_id='web-emergency-off'");
  await query("UPDATE spff.control_commands SET status='completed' WHERE command_id='web-override-on'");
  await query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,requested_by,issued_at,expires_at,request_payload)
    VALUES('old-auto-off','greenhouse-01','esp32-s3-01','pump_water',false,'hst-runtime-limit',now(),now()+interval '30 seconds','{}'),
    ('operator-emergency-off','greenhouse-01','esp32-s3-01','pump_water',false,'operator',now(),now()+interval '30 seconds','{}')`);
  pending=await worker.pendingCommands(10);
  assert.deepEqual(pending.map(p=>p.commandId),['operator-emergency-off'],'automation cannot overwrite operator control; ordinary OFF is still available');
  let stalePublished=false;
  assert.equal(await worker.publishPendingCommand('old-auto-off',async()=>{stalePublished=true}),false);
  assert.equal(stalePublished,false,'a dispatcher snapshot taken before override cannot publish after takeover');
  assert.equal((await worker.automaticControlSnapshots(true))[0].releaseOperatorOverride,false);
  assert.equal((await worker.scheduleSnapshots('device',true)).length,0,'native schedule sync is held during override');
  await query("UPDATE spff.control_commands SET status='failed' WHERE command_id IN('old-auto-off','operator-emergency-off')");
  await heartbeat({operatorOverrideCapable:true,pumpWaterActualActive:true});
  await assert.rejects(()=>repository.resumeAutomation('esp32-s3-01','operator'),/Matikan kedua pompa/);
  await heartbeat({operatorOverrideCapable:true});
  await assert.rejects(()=>repository.resumeAutomation('esp32-s3-01','operator'),/masa berlaku ON/);
  await query("UPDATE spff.control_commands SET expires_at=now()-interval '1 second',issued_at=now()-interval '31 seconds' WHERE command_id='web-override-on'");
  config=await repository.resumeAutomation('esp32-s3-01','operator');
  assert.equal(config.operatorOverrideActive,false);assert.equal(config.desiredMode,'automatic');
  assert.equal(config.revision,2);assert.equal(config.acknowledgedRevision,null);
  assert.equal(config.acknowledgementStatus,null,'automatic restarts wait for new configuration ACK');
  assert.equal((await worker.automaticControlSnapshots(true))[0].releaseOperatorOverride,true);
  assert.equal((await worker.pendingCommands(10)).length,0);
  await query("UPDATE spff.device_automatic_control_configs SET acknowledged_revision=revision,acknowledgement_status='applied'");
  await repository.updatePump('pump_water',true,'operator','web-override-next',true);
  config=await repository.automaticControl();
  config=await repository.updateAutomaticControl({...config,water:{...config.water,cooldownSeconds:31}},'operator');
  assert.equal(config.operatorOverrideActive,true,'editing automatic settings does not release override');
  assert.equal((await worker.automaticControlSnapshots(true))[0].releaseOperatorOverride,false);
  config=await repository.updateAutomaticControl({...config,desiredMode:'manual'},'operator');
  assert.equal(config.operatorOverrideActive,false,'explicit Manual mode restores the ordinary manual command path');
  await query("UPDATE spff.device_automatic_control_configs SET acknowledged_revision=revision,acknowledgement_status='applied',applied_mode='manual'");
  assert.equal((await worker.pendingCommands(10)).length,0,'old override ON is not replayed after mode change');
 } finally {pool.query=originalQuery;pool.connect=originalConnect;await db.close();}
});
