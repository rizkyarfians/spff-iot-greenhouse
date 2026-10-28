import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
test('pump failure incidents persist, deduplicate and recover, with scheduled-start grace and firmware gates',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href)
 const db=new PGlite()
 const client={query:async(sql,params=[])=>{const r=await db.query(sql,params);return{...r,rowCount:r.rows.length||r.affectedRows||0}}}
 const {observeSoilEcPumpAlert,observeScheduledPumpAlerts}=await import('../lib/services/soilEcPumpAlerts.js')
 try{
  await db.exec('CREATE ROLE spff_app;')
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations')
  for(const n of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,n),'utf8'))
  await db.exec(`INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test');
   INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)VALUES('greenhouse-01','esp32-s3-01','pump_water','Test');
   INSERT INTO spff.device_automatic_control_configs(site_id,device_id,revision,desired_mode,water_enabled,
    water_moisture_low_pct,water_moisture_target_pct,water_max_runtime_seconds,water_cooldown_seconds,water_min_flow_lpm,
    acknowledged_revision,acknowledgement_status,applied_mode)
   VALUES('greenhouse-01','esp32-s3-01',1,'automatic',true,30,60,20,60,1,1,'applied','automatic');
   INSERT INTO spff.device_status_events(site_id,device_id,message_id,recorded_at,online,mode,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01','status',now(),true,'automatic','{"independentSoilEcCapable":true}');
   INSERT INTO spff.alarm_rules(site_id,rule_key,source_type,source_key,comparator,severity,trigger_count,recovery_count,title,description,recommendation)
   VALUES('greenhouse-01','command_failed','system','control_command','failed','critical',1,1,'Command aktuator gagal','Perintah gagal','Periksa ACK dan interlock');
   GRANT USAGE ON SCHEMA spff TO spff_app;`)
  // Apply the real API read grants; ownership reassignment is unrelated to this test.
  const security=readFileSync(resolve(dir,'../security/001_roles_and_grants.sql'),'utf8')
  await db.exec('CREATE ROLE spff_api_role; '+security.slice(security.indexOf('GRANT SELECT ON'),security.indexOf('TO spff_api_role;')+'TO spff_api_role;'.length)+' GRANT spff_api_role TO spff_app;')
  // Exercise the actual API role: no new permission migration is needed.
  await db.exec('SET ROLE spff_app')
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'calibration_missing')
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'calibration_missing')
  let rows=(await db.query('SELECT * FROM spff.alarms')).rows
  assert.equal(rows.length,1);assert.equal(rows[0].occurrence_count,1)
  // The production manual-resolution path clears active_alarm_id without observing recovery.
  const dismiss=async()=>{await db.exec(`UPDATE spff.alarms SET status='resolved',resolved_at=now(),resolved_by='admin',resolution_type='manual' WHERE status<>'resolved';
   UPDATE spff.alarm_rule_states SET active_alarm_id=NULL,violation_count=0,recovery_count=0;`)}
  await dismiss()
  for(let i=0;i<3;i++)await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'calibration_missing')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM spff.alarms')).rows[0].n,1)
  assert.equal((await db.query('SELECT status FROM spff.alarms')).rows[0].status,'resolved')
  // A recovered condition is retained in SQL, so a new occurrence is not muted forever.
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',false,'waiting_evaluation')
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'calibration_missing')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM spff.alarms')).rows[0].n,2)
  await dismiss()
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'pulse_outcome_unknown','session-1')
  rows=(await db.query('SELECT * FROM spff.alarms')).rows
  assert.equal(rows.length,3);assert.equal(rows.find(row=>row.status==='open').metadata.reason,'pulse_outcome_unknown')
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',false,'session_started')
  assert.ok((await db.query('SELECT status FROM spff.alarms')).rows.every(row=>row.status==='resolved'))
  // A fresh session with the same reason must also bypass a previous dismissal.
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'pulse_outcome_unknown','session-2')
  await dismiss()
  await observeSoilEcPumpAlert(client,'greenhouse-01','esp32-s3-01',true,'pulse_outcome_unknown','session-3')
  assert.equal((await db.query("SELECT metadata->>'sessionId' AS session FROM spff.alarms WHERE status='open'")).rows[0].session,'session-3')
  await db.exec('RESET ROLE')
  // Closed windows and older firmware must not generate a scheduled-start failure.
  await db.exec(`INSERT INTO spff.actuator_schedules(schedule_id,site_id,device_id,actuator_key,on_time,off_time,repeat_rule,requested_by)
   VALUES('s','greenhouse-01','esp32-s3-01','pump_water','00:00','23:59:59','daily','test');`)
  await db.exec('SET ROLE spff_app')
  await observeScheduledPumpAlerts(client)
  let scheduled=(await db.query("SELECT * FROM spff.alarms WHERE incident_key='scheduled_start:pump_water'")).rows
  assert.equal(scheduled.length,1);assert.equal(scheduled[0].metadata.reason,'schedule_start_unconfirmed')
  await observeScheduledPumpAlerts(client)
  assert.equal((await db.query("SELECT occurrence_count FROM spff.alarms WHERE incident_key='scheduled_start:pump_water'")).rows[0].occurrence_count,1)
  await db.exec('RESET ROLE')
  await db.exec(`INSERT INTO spff.actuator_state_events(site_id,device_id,actuator_key,recorded_at,state,is_active,source)
   VALUES('greenhouse-01','esp32-s3-01','pump_water',now(),'active',true,'system');`)
  await observeScheduledPumpAlerts(client)
  assert.equal((await db.query("SELECT status FROM spff.alarms WHERE incident_key='scheduled_start:pump_water'")).rows[0].status,'resolved')
  await db.exec("UPDATE spff.device_status_events SET raw_payload='{}'; DELETE FROM spff.actuator_state_events;")
  await observeScheduledPumpAlerts(client)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM spff.alarms WHERE incident_key='scheduled_start:pump_water'")).rows[0].n,1)
  await db.exec("UPDATE spff.device_status_events SET raw_payload='{\"independentSoilEcCapable\":true}'; UPDATE spff.actuator_schedules SET on_time=((now() AT TIME ZONE timezone)-interval '10 seconds')::time;")
  await observeScheduledPumpAlerts(client)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM spff.alarms WHERE incident_key='scheduled_start:pump_water'")).rows[0].n,1)
 }finally{await db.close()}
})
