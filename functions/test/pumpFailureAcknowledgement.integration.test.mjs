import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
test('pump failure banner follows acknowledgement of the exact command without changing command or relay state',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href)
 const db=new PGlite()
 const repo=await import('../lib/services/postgresRepository.js'),end=repo.pool.end.bind(repo.pool)
 const original=repo.pool.query
 repo.pool.query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 try{
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations')
  for(const n of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,n),'utf8'))
  await db.exec(`INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test');
   INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)VALUES('greenhouse-01','esp32-s3-01','pump_fert','Test');
   INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,requested_by,status,issued_at,expires_at)
   VALUES('cmd-1','greenhouse-01','esp32-s3-01','pump_fert',false,'test','timed_out',now(),now()+interval '1 minute');`)
  const pump=async()=>(await repo.repository.pumps())[0]
  assert.equal((await pump()).commandFailureAcknowledged,false)
  await db.exec(`INSERT INTO spff.alarms(site_id,device_id,source_type,source_key,severity,status,title,description,triggered_at,first_seen_at,last_seen_at,rule_key,metadata)
   VALUES('greenhouse-01','esp32-s3-01','actuator','pump_fert','warning','open','Test','Test',now(),now(),now(),'command_failed','{"commandId":"cmd-1"}');`)
  assert.equal((await pump()).commandFailureAcknowledged,false)
  await db.exec("UPDATE spff.alarms SET status='acknowledged',acknowledged_by='test',acknowledged_at=now()")
  let p=await pump();assert.equal(p.commandFailureAcknowledged,true);assert.equal(p.commandStatus,'timed_out');assert.equal(p.isActive,false);assert.equal(p.state,'offline')
  await db.exec("UPDATE spff.alarms SET status='resolved',resolved_at=now()")
  assert.equal((await pump()).commandFailureAcknowledged,true)
  await db.exec("UPDATE spff.alarms SET status='open'")
  assert.equal((await pump()).commandFailureAcknowledged,false)
  await db.exec("UPDATE spff.alarms SET status='acknowledged',metadata='{\"commandId\":\"other-command\"}'")
  assert.equal((await pump()).commandFailureAcknowledged,false)
 }finally{repo.pool.query=original;await end();await db.close()}
})
