import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {hstRuntimeSeconds,enforceHstRuntimeLimit} from '../dist/hstRuntimeLimit.js';

test('HST runtime uses the stored setting, capped at 900 seconds',()=>{
 assert.equal(hstRuntimeSeconds(900),900);assert.equal(hstRuntimeSeconds(120),120);
 assert.equal(hstRuntimeSeconds(3600),900);assert.equal(hstRuntimeSeconds(null),900);
 assert.equal(hstRuntimeSeconds(-1),900);assert.equal(hstRuntimeSeconds(NaN),900);
});

test('HST OFF survives restart, stops both pumps, deduplicates and ends on confirmed OFF',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite();
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const start=new Date(),time=s=>new Date(start.getTime()+s*1000);
 const pid='11111111-1111-4111-8111-111111111111',phase='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
 try {
  const dir=new URL('../../infrastructure/postgres/migrations/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
  await db.exec(`INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','test');
   INSERT INTO spff.devices(site_id,device_id,display_name) VALUES('greenhouse-01','esp32-s3-01','test');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name) VALUES
    ('greenhouse-01','esp32-s3-01','pump_water','Water'),('greenhouse-01','esp32-s3-01','pump_fert','Fert');`);
  await query(`INSERT INTO spff.guide_programs(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,updated_by)
   VALUES('greenhouse-01',$1,1,'{}',$2,1,'{}','{}','test')`,[pid,'a'.repeat(64)]);
  await query(`INSERT INTO spff.hst_fertilization_phases(phase_id,site_id,device_id,program_id,activity_id,phase_number,title,hst,product,method)
   VALUES($1,'greenhouse-01','esp32-s3-01',$2,'row-16',2,'Pemupukan ke-2',20,'Phonska plus','Tabur')`,[phase,pid]);
  for(const [id,target] of [['water','pump_water'],['fert','pump_fert']]) {
   await query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,
    requested_by,status,issued_at,expires_at,published_at,request_payload)
    VALUES($1,'greenhouse-01','esp32-s3-01',$2,true,'hst-fertilization','completed',$3,$4,$3,$5)`,
    [id,target,start,time(90),JSON.stringify({source:'hst-fertilization',hstRuntimeLimitSeconds:900})]);
   await query(`INSERT INTO spff.command_ack_events(command_id,status,actual_is_active,acknowledged_at)
    VALUES($1,'completed',true,$2)`,[id,time(1)]);
  }
  await query(`INSERT INTO spff.hst_fertilization_starts(start_id,site_id,device_id,program_id,activity_id,hst,
   application_day,product,method,water_command_id,fertilizer_command_id,phase_id,status,started_at)
   VALUES($1,'greenhouse-01','esp32-s3-01',$2,'row-16',20,current_date,'Phonska plus','Tabur','water','fert',$3,'started',$4)`,[sid,pid,phase,time(2)]);
  await enforceHstRuntimeLimit({query},time(899));
  const count=async()=>Number((await query("SELECT count(*) AS n FROM spff.control_commands WHERE requested_by='hst-runtime-limit'")).rows[0].n);
  assert.equal(await count(),0);
  await enforceHstRuntimeLimit({query},time(900));
  assert.equal(await count(),2);
  let stops=(await query("SELECT * FROM spff.control_commands WHERE requested_by='hst-runtime-limit' ORDER BY actuator_key")).rows;
  assert.deepEqual(stops.map(c=>c.actuator_key),['pump_fert','pump_water']);
  assert.ok(stops.every(c=>c.requested_is_active===false&&c.request_payload.maxRuntimeSeconds===900));
  await enforceHstRuntimeLimit({query},time(905));assert.equal(await count(),2,'another process tick does not reset the deadline or duplicate live OFF');
  await query("UPDATE spff.control_commands SET status='timed_out' WHERE requested_by='hst-runtime-limit'");
  await enforceHstRuntimeLimit({query},time(931));assert.equal(await count(),4,'expired OFFs are retried until evidence arrives');
  stops=(await query("SELECT * FROM spff.control_commands WHERE requested_by='hst-runtime-limit' AND status='pending'")).rows;
  for(const c of stops) await query(`INSERT INTO spff.command_ack_events(command_id,status,actual_is_active,acknowledged_at)
   VALUES($1,'completed',false,$2)`,[c.command_id,time(932)]);
  await enforceHstRuntimeLimit({query},time(935));
  const metadata=(await query("SELECT request_payload FROM spff.control_commands WHERE command_id='water'")).rows[0].request_payload;
  assert.equal(metadata.hstRuntimeEndReason,'runtime_limit');
  await enforceHstRuntimeLimit({query},time(960));assert.equal(await count(),4);
  await query(`DELETE FROM spff.command_ack_events WHERE command_id IN
   (SELECT command_id FROM spff.control_commands WHERE requested_by='hst-runtime-limit')`);
  await query(`UPDATE spff.control_commands SET request_payload=request_payload-'hstRuntimeCompletedAt'
   WHERE command_id='water'`);
  await query(`INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01',true,'automatic',$1,
    '{"pumpReadbackValid":true,"pumpWaterActualActive":false,"pumpFertActualActive":false}')`,[time(10)]);
  await enforceHstRuntimeLimit({query},time(970));assert.equal(await count(),4);
  assert.equal((await query("SELECT request_payload FROM spff.control_commands WHERE command_id='water'")).rows[0].request_payload.hstRuntimeEndReason,'device_stopped');
  await query('DELETE FROM spff.device_status_events');
  await query(`UPDATE spff.control_commands SET request_payload=request_payload-'hstRuntimeCompletedAt' WHERE command_id='water'`);
  await query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,
   requested_by,status,issued_at,expires_at) VALUES('later-manual','greenhouse-01','esp32-s3-01','pump_water',true,'operator','completed',$1,$2)`,[time(100),time(130)]);
  await enforceHstRuntimeLimit({query},time(980));assert.equal(await count(),4,'old HST deadline does not stop a later owner');
  assert.equal((await query("SELECT request_payload FROM spff.control_commands WHERE command_id='water'")).rows[0].request_payload.hstRuntimeEndReason,'ownership_transferred');
 } finally {await db.close();}
});
