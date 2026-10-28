import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
test('editing preserves schedule identity, disabled state and execution history, syncs revision and rejects stale writes',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href)
 const db=new PGlite(),repo=await import('../lib/services/postgresRepository.js'),end=repo.pool.end.bind(repo.pool)
 const original=repo.pool.query
 repo.pool.query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 try{
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations')
  for(const n of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,n),'utf8'))
  await db.exec(`INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test'),('other','Other');
   INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test'),('other','esp32-other','Other');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name)VALUES('greenhouse-01','esp32-s3-01','pump_water','Air'),('other','esp32-other','pump_water','Other');
   INSERT INTO spff.actuator_schedules(schedule_id,site_id,device_id,actuator_key,on_time,off_time,repeat_rule,enabled,requested_by)
   VALUES('s','greenhouse-01','esp32-s3-01','pump_water','07:00','07:15','daily',false,'admin'),('other-s','other','esp32-other','pump_water','07:00','07:15','daily',true,'admin');
   INSERT INTO spff.schedule_executions(schedule_id,action,scheduled_for)VALUES('s','on',now()-interval '1 day');`)
  const before=(await repo.repository.schedules())[0]
  const revision=async()=>(await db.query("SELECT revision FROM spff.device_schedule_sync_state WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'")).rows[0].revision
  const rev=await revision()
  const input={onTime:'08:00',offTime:'08:10',repeatRule:'once',runDate:'2026-11-01',expectedUpdatedAt:before.updatedAt}
  const edited=await repo.repository.updateSchedule('s',input)
  assert.equal(edited.id,before.id);assert.equal(edited.deviceId,before.deviceId);assert.equal(edited.actuatorKey,before.actuatorKey)
  assert.equal(edited.enabled,false);assert.equal(edited.onTime,'08:00');assert.equal(edited.repeatRule,'once');assert.equal(edited.runDate,'2026-11-01')
  assert.equal(Number(await revision()),Number(rev)+1)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM spff.schedule_executions WHERE schedule_id='s'")).rows[0].n,1)
  assert.equal(await repo.repository.updateSchedule('s',{...input,onTime:'09:00'}),null)
  assert.equal(await repo.repository.updateSchedule('other-s',input),null)
  const again=await repo.repository.updateSchedule('s',{...input,expectedUpdatedAt:edited.updatedAt,repeatRule:'weekdays',runDate:null})
  assert.equal(again.runDate,null);assert.equal(again.enabled,false)
  // Validate the public handler before any database mutation.
  const {updateSchedule}=await import('../lib/controllers/dashboardController.js')
  const call=body=>new Promise((resolve,reject)=>{
   const res={statusCode:200,status(n){this.statusCode=n;return this},json(body){resolve({status:this.statusCode,body});return this}}
   updateSchedule({params:{id:'s'},body},res,reject)
  })
  for(const patch of [{onTime:'25:00'},{offTime:'06:00'},{repeatRule:'unknown'},{runDate:null},{runDate:'2026-02-31'},{expectedUpdatedAt:'0'}]){
   assert.equal((await call({...input,...patch})).status,400)
  }
  assert.equal((await call(input)).status,409)
 }finally{repo.pool.query=original;await end();await db.close()}
})
