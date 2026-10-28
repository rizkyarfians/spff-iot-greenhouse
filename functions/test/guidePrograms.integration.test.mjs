import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {guideProgramCreateSchema,guideProgramUpdateSchema} from '@spff/contracts'
test('guide programs pin reviewed server snapshots, persist revisions and manual completion, enforce conflicts and site isolation',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite()
 const repo=await import('../lib/services/postgresRepository.js'),realEnd=repo.pool.end.bind(repo.pool)
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 repo.pool.query=query;repo.pool.connect=async()=>({query,release(){}})
 const svc=await import('../lib/services/guideProgramService.js'),guide=await import('../lib/services/protocolGuideService.js')
 const config={cropId:'ubi-jalar',plantingDate:'2026-01-01',basis:'plants',quantity:1000,deviceId:null}
 const input=async(c=config)=>{const p=await svc.previewGuideProgram(c);return guideProgramCreateSchema.parse({config:c,sourceSha256:p.sourceSha256,guideRevision:p.guideRevision})}
 try{
  await db.exec('CREATE ROLE spff_app;')
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations')
  for(const name of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,name),'utf8'))
  await db.exec("INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test'),('other','Other'); INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('other','foreign','Foreign'); GRANT USAGE ON SCHEMA spff TO spff_app; GRANT SELECT ON spff.devices TO spff_app; SET ROLE spff_app;")
  const originalInput=await input()
  let p=await svc.saveGuideProgram(originalInput,'admin')
  assert.equal(p.revision,1);assert.equal(p.guideRevision,0);assert.equal(p.plan.activities[0].requirements[0].amount,2.5)
  await svc.completeGuideActivity(p.programId,1,'row-11','Sudah tabur','operator')
  await svc.completeGuideActivity(p.programId,1,'row-11','Duplicate','operator')
  await svc.completeGuideActivity(p.programId,1,'row-14','','operator')
  p=(await svc.listGuidePrograms())[0];assert.equal(p.completions.length,2);assert.ok(p.completedActivityIds.includes('row-11'))
  await guide.saveProtocolGuide('ubi-jalar',{sourceSha256:p.sourceSha256,expectedRevision:0,changes:[{address:'H11',value:3}],note:'Dosis baru'},'admin')
  p=(await svc.listGuidePrograms())[0]
  assert.equal(p.sourceChanged,true);assert.equal(p.plan.activities[0].requirements[0].amount,2.5)
  await assert.rejects(svc.saveGuideProgram(originalInput,'admin'),e=>e.status===409)
  const nextInput=await input()
  p=await svc.saveGuideProgram(nextInput,'admin',p.programId,1)
  assert.equal(p.revision,2);assert.equal(p.guideRevision,1);assert.equal(p.plan.activities[0].requirements[0].amount,3)
  assert.equal(p.completedActivityIds.includes('row-11'),false);assert.equal(p.completedActivityIds.includes('row-14'),true)
  assert.equal(p.completions.length,2)
  await assert.rejects(svc.saveGuideProgram(nextInput,'admin',p.programId,1),e=>e.status===409)
  await assert.rejects(svc.completeGuideActivity(p.programId,1,'row-11','','operator'),e=>e.status===409)
  await svc.completeGuideActivity(p.programId,2,'row-11','','operator')
  const snapshots=(await query('SELECT revision,plan FROM spff.guide_program_revisions WHERE program_id=$1 ORDER BY revision',[p.programId])).rows
  assert.equal((await svc.readGuideProgramHistory(p.programId)).length,2);
  assert.equal(snapshots.length,2);assert.equal(snapshots[0].plan.activities[0].requirements[0].amount,2.5)
  const future=await svc.saveGuideProgram(await input({...config,plantingDate:'2099-01-01'}),'admin')
  await assert.rejects(svc.completeGuideActivity(future.programId,1,'row-11','','operator'),e=>e.status===409)
  await assert.rejects(svc.previewGuideProgram({...config,deviceId:'foreign'}),e=>e.status===400)
  await assert.rejects(svc.previewGuideProgram({...config,cropId:'unknown'}),e=>e.status===404)
  assert.equal(guideProgramCreateSchema.safeParse({...originalInput,sheet:{}}).success,false)
  assert.equal(guideProgramUpdateSchema.safeParse({...nextInput,expectedRevision:0}).success,false)
  await assert.rejects(db.exec('UPDATE spff.guide_program_revisions SET actor=\'tamper\''),/permission denied/i)
  await assert.rejects(db.exec('DELETE FROM spff.guide_program_completions'),/permission denied/i)
  await db.exec('RESET ROLE')
  // Another site's program must remain unreadable and unmodifiable through the service.
  await query("INSERT INTO spff.guide_programs SELECT 'other',program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,created_at,updated_at,updated_by FROM spff.guide_programs WHERE program_id=$1",[p.programId])
  await query("DELETE FROM spff.guide_program_completions WHERE site_id='greenhouse-01' AND program_id=$1",[p.programId])
  await query("DELETE FROM spff.guide_program_revisions WHERE site_id='greenhouse-01' AND program_id=$1",[p.programId])
  await query("DELETE FROM spff.guide_programs WHERE site_id='greenhouse-01' AND program_id=$1",[p.programId])
  assert.equal((await svc.listGuidePrograms()).some(x=>x.programId===p.programId),false)
  assert.deepEqual(await svc.readGuideProgramHistory(p.programId),[])
  await assert.rejects(svc.saveGuideProgram(nextInput,'admin',p.programId,2),e=>e.status===404)
  await assert.rejects(svc.completeGuideActivity(p.programId,2,'row-11','','operator'),e=>e.status===404)
  // Failed revision audit rolls back the current program as well.
  await db.exec("ALTER TABLE spff.guide_program_revisions ADD CONSTRAINT test_actor_guard CHECK(actor<>'fail-audit')")
  await assert.rejects(svc.saveGuideProgram(await input({...config,plantingDate:'2099-01-01'}),'fail-audit',future.programId,1),/test_actor_guard/)
  assert.equal((await svc.listGuidePrograms()).find(x=>x.programId===future.programId).revision,1)
 }finally{await realEnd();await db.close()}
})
