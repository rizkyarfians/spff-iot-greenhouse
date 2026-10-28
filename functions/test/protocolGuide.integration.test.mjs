import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {protocolGuideSaveSchema} from '@spff/contracts'
const source=JSON.parse(readFileSync(new URL('../../frontend/src/data/protocolGuide.json',import.meta.url),'utf8'))
test('guide edits persist with immutable history, source restoration, revision conflicts, source/merge/type guards and site isolation',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite()
 const repo=await import('../lib/services/postgresRepository.js'),realEnd=repo.pool.end.bind(repo.pool)
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 repo.pool.query=query;repo.pool.connect=async()=>({query,release(){}})
 const svc=await import('../lib/services/protocolGuideService.js')
 const input=(revision,changes)=>protocolGuideSaveSchema.parse({sourceSha256:source.sourceSha256,expectedRevision:revision,changes,note:'Uji perubahan'})
 try{
  await db.exec('CREATE ROLE spff_app;')
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations')
  for(const name of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,name),'utf8'))
  await db.exec("INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test'),('other','Other'); GRANT USAGE ON SCHEMA spff TO spff_app; SET ROLE spff_app;")
  let view=await svc.readProtocolGuide('ubi-jalar');assert.equal(view.revision,0);assert.deepEqual(view.overrides,{})
  view=await svc.saveProtocolGuide('ubi-jalar',input(0,[{address:'H11',value:3},{address:'E11',value:'Pupuk uji'},{address:'G11',value:true}]),'admin-one')
  assert.equal(view.revision,1);assert.equal(view.overrides.H11,3);assert.equal(view.updatedBy,'admin-one')
  assert.deepEqual((await svc.readProtocolGuide('ubi-jalar')).overrides,view.overrides)
  let history=await svc.readProtocolGuideHistory('ubi-jalar');assert.equal(history.length,1);assert.equal(history[0].changes[0].before,2.5);assert.equal(history[0].changes[0].after,3)
  await assert.rejects(svc.saveProtocolGuide('ubi-jalar',input(0,[{address:'H11',value:4}]),'admin-two'),e=>e.status===409)
  assert.equal((await svc.readProtocolGuideHistory('ubi-jalar')).length,1)
  // Restore a source value through normal editing without altering original JSON.
  view=await svc.saveProtocolGuide('ubi-jalar',input(1,[{address:'H11',value:2.5}]),'admin-two')
  assert.equal(view.revision,2);assert.equal(Object.hasOwn(view.overrides,'H11'),false);assert.equal(source.sheets[0].cells.H11.value,2.5)
  view=await svc.saveProtocolGuide('ubi-jalar',input(2,[{address:'H11',value:2.5}]),'admin-two');assert.equal(view.revision,2)
  for(const change of [{address:'A1',value:1},{address:'P11',value:1},{address:'B12',value:99},{address:'H11',value:-1},{address:'H11',value:'bad'},{address:'G11',value:1}]){
   await assert.rejects(svc.saveProtocolGuide('ubi-jalar',input(2,[change]),'test'),e=>e.status===400)
  }
  await assert.rejects(svc.saveProtocolGuide('ubi-jalar',{...input(2,[{address:'H11',value:1}]),sourceSha256:'0'.repeat(64)},'test'),e=>e.status===409)
  await assert.rejects(svc.readProtocolGuide('unknown'),e=>e.status===404)
  assert.equal(protocolGuideSaveSchema.safeParse({...input(2,[{address:'H11',value:1}]),changes:[{address:'H11',value:1},{address:'H11',value:2}]}).success,false)
  const kacang=await svc.saveProtocolGuide('kacang-tanah',input(0,[{address:'B11',value:-12}]),'test');assert.equal(kacang.overrides.B11,-12)
  // API role may append history but cannot rewrite or delete it.
  await assert.rejects(db.exec('UPDATE spff.protocol_guide_revisions SET actor=\'tamper\''),/permission denied/i)
  await assert.rejects(db.exec('DELETE FROM spff.protocol_guide_revisions'),/permission denied/i)
  await db.exec('RESET ROLE')
  await query("INSERT INTO spff.protocol_guide_edits(site_id,crop_id,source_sha256,revision,overrides,updated_by)VALUES('other','ubi-jalar',$1,99,'{\"H11\":999}','other')",[source.sourceSha256])
  assert.equal((await svc.readProtocolGuide('ubi-jalar')).revision,2)
  history=await svc.readProtocolGuideHistory('ubi-jalar');assert.equal(history.length,2);assert.equal(history[0].actor,'admin-two')
  // If audit persistence fails, the effective guide must not advance either.
  await db.exec("ALTER TABLE spff.protocol_guide_revisions ADD CONSTRAINT test_actor_guard CHECK(actor<>'fail-audit')")
  await assert.rejects(svc.saveProtocolGuide('ubi-jalar',input(2,[{address:'H11',value:7}]),'fail-audit'),/test_actor_guard/)
  assert.equal((await svc.readProtocolGuide('ubi-jalar')).revision,2)
  assert.equal((await svc.readProtocolGuideHistory('ubi-jalar')).length,2)
 }finally{await realEnd();await db.close()}
})
