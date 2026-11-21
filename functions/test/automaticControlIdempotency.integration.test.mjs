import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

test('identical automatic saves preserve firmware revision and ACK; genuine changes increment once',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
 const db=new PGlite();
 const {pool,repository}=await import('../lib/services/postgresRepository.js');
 const originalQuery=pool.query;
 const originalConnect=pool.connect;
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 try {
  const dir=new URL('../../infrastructure/postgres/migrations/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())
   await db.exec(readFileSync(new URL(name,dir),'utf8'));
  pool.query=query;
  pool.connect=async()=>({query,release(){}});
  await db.exec(`INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','test');
   INSERT INTO spff.devices(site_id,device_id,display_name) VALUES('greenhouse-01','esp32-s3-01','test');`);
  const input={desiredMode:'automatic',water:{enabled:true,sensorKey:'soil_2_moisture',
   moistureLowPercent:23,moistureTargetPercent:60,maxRuntimeSeconds:120,cooldownSeconds:30,
   minTankLevelPercent:null,minFlowLpm:5,triggerSampleCount:3,sensorStaleSeconds:120},
   fertilizer:{enabled:false,sensorKey:'liquid_ec_us_cm',ecLowUsCm:null,ecTargetUsCm:null,ecHighUsCm:null,
    dosePulseSeconds:null,mixingDelaySeconds:null,cooldownSeconds:null,maxDoseVolumeL:null,
    maxDailyVolumeL:null,minTankLevelPercent:null,minFlowLpm:null,triggerSampleCount:3,sensorStaleSeconds:120}};
  await repository.updateAutomaticControl(input,'fixture');
  await db.exec(`UPDATE spff.device_automatic_control_configs SET published_revision=revision,published_at=now(),
   acknowledged_revision=revision,acknowledgement_status='applied',acknowledged_at=now(),applied_mode='automatic';`);
  const before=await repository.automaticControl();
  const same=await repository.updateAutomaticControl(input,'different-actor');
  assert.deepEqual(same,before,'identical input retains timestamps, actor, revision and physical confirmation');
  const changed={...input,water:{...input.water,cooldownSeconds:31}};
  await Promise.all([repository.updateAutomaticControl(changed,'admin'),repository.updateAutomaticControl(changed,'admin')]);
  const after=await repository.automaticControl();
  assert.equal(after.revision,before.revision+1);
  assert.equal(after.water.cooldownSeconds,31);assert.equal(after.acknowledgedRevision,null);
  assert.equal(after.publishedRevision,null);assert.equal(after.acknowledgementStatus,null);
  const repeated=await repository.updateAutomaticControl(changed,'again');
  assert.deepEqual(repeated,after,'an unacknowledged same-value save also does not churn the revision');
  const manual=await repository.updateAutomaticControl({...changed,desiredMode:'manual'},'admin');
  assert.equal(manual.desiredMode,'manual');assert.equal(manual.revision,after.revision+1);
  const soil1=await repository.updateAutomaticControl({
    ...changed, desiredMode:'manual', water:{...changed.water,sensorKey:'soil_1_moisture'},
  },'admin');
  assert.equal(await repository.selectAiSoil2(soil1.deviceId,'operator'),null,'requires a fresh Manual heartbeat');
  await db.exec(`INSERT INTO spff.device_status_events(site_id,device_id,message_id,recorded_at,online,mode)
    VALUES('greenhouse-01','esp32-s3-01','manual',now(),true,'manual');
    INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)
    VALUES('greenhouse-01','esp32-s3-01','pump_water','Pompa Air');
    INSERT INTO spff.actuator_state_events(site_id,device_id,actuator_key,recorded_at,state,is_active,source)
    VALUES('greenhouse-01','esp32-s3-01','pump_water',now(),'active',true,'system');`);
  assert.equal(await repository.selectAiSoil2(soil1.deviceId,'operator'),null,'blocks while a pump is active');
  await db.exec(`UPDATE spff.actuator_state_events SET state='inactive',is_active=false;`);
  const soil2=await repository.selectAiSoil2(soil1.deviceId,'operator');
  assert.equal(soil2.desiredMode,'manual');
  assert.deepEqual(soil2.water,{...soil1.water,sensorKey:'soil_2_moisture'});
  assert.deepEqual(soil2.fertilizer,soil1.fertilizer);
  assert.equal(soil2.revision,soil1.revision+1);
  assert.equal(soil2.updatedBy,'operator');
  assert.deepEqual(await repository.selectAiSoil2(soil1.deviceId,'operator'),soil2);
  assert.equal((await query('SELECT count(*)::int AS n FROM spff.control_commands')).rows[0].n,0);
 } finally {pool.query=originalQuery;pool.connect=originalConnect;await db.close();}
});
