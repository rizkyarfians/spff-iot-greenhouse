import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {guideEcProfileSchema} from '@spff/contracts'
test('EC profile persistence, exact recipe matching, audit rollback, revision conflicts and site isolation', {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite()
 const repo=await import('../lib/services/postgresRepository.js'),realEnd=repo.pool.end.bind(repo.pool)
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 repo.pool.query=query;repo.pool.connect=async()=>({query,release(){}})
 const programs=await import('../lib/services/guideProgramService.js'),ec=await import('../lib/services/guideEcConversionService.js'),guide=await import('../lib/services/protocolGuideService.js')
 const config={cropId:'terong',plantingDate:'2026-01-01',basis:'plants',quantity:6000,deviceId:null,waterEcMsCm:0.3}
 const create=async(c=config)=>{const preview=await programs.previewGuideProgram(c);return programs.saveGuideProgram({config:c,sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},'admin')}
 const input=guideEcProfileSchema.parse({expectedProgramRevision:1,expectedProfileRevision:0,activityId:'row-10',sourceReference:'Synthetic integration data, not agronomic guidance',referenceWaterEcMsCm:0.1,temperatureCompensated25C:true,mixtureVerified:true,points:[{concentrationGPerL:0,ecMsCm:0.1},{concentrationGPerL:10,ecMsCm:1},{concentrationGPerL:40,ecMsCm:3.7}]})
 try{
  await db.exec('CREATE ROLE spff_app;')
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations');for(const name of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,name),'utf8'))
  await db.exec("INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test'),('other','Other'); GRANT USAGE ON SCHEMA spff TO spff_app; SET ROLE spff_app;")
  const p=await create();let result=(await ec.readGuideEcConversions(p.programId)).find(a=>a.activityId==='row-10')
  assert.equal(result.status,'blocked');assert.equal(result.targetEcMsCm,null)
  await ec.saveGuideEcProfile(p.programId,input,'admin')
  result=(await ec.readGuideEcConversions(p.programId)).find(a=>a.activityId==='row-10')
  assert.equal(result.status,'ready');assert.ok(result.targetEcMsCm>0.3);assert.equal(result.automaticExecutionEnabled,false)
  assert.equal(result.profile.sourceReference,input.sourceReference)
  await assert.rejects(ec.saveGuideEcProfile(p.programId,input,'admin'),e=>e.status===409)
  await assert.rejects(ec.saveGuideEcProfile(p.programId,{...input,expectedProgramRevision:99,expectedProfileRevision:1},'admin'),e=>e.status===409)
  const batch=await create({...config,quantity:3000}),batchConversion=(await ec.readGuideEcConversions(batch.programId)).find(a=>a.activityId==='row-10')
  assert.equal(batchConversion.targetEcMsCm,result.targetEcMsCm)
  const noWater=await create({...config,waterEcMsCm:undefined});assert.equal((await ec.readGuideEcConversions(noWater.programId)).find(a=>a.activityId==='row-10').targetEcMsCm,null)
  await guide.saveProtocolGuide('terong',{sourceSha256:p.sourceSha256,expectedRevision:0,changes:[{address:'E10',value:'Different product'}],note:'Changed blend'},'admin')
  const changed=await create();assert.equal((await ec.readGuideEcConversions(changed.programId)).find(a=>a.activityId==='row-10').targetEcMsCm,null)
  // Existing snapshots remain linked to their original blend.
  assert.equal((await ec.readGuideEcConversions(p.programId)).find(a=>a.activityId==='row-10').targetEcMsCm,result.targetEcMsCm)
  await assert.rejects(db.exec("UPDATE spff.guide_ec_profile_revisions SET actor='tamper'"),/permission denied/i)
  await db.exec('RESET ROLE')
  await db.exec("ALTER TABLE spff.guide_ec_profile_revisions ADD CONSTRAINT test_ec_actor CHECK(actor<>'fail-audit')")
  await assert.rejects(ec.saveGuideEcProfile(p.programId,{...input,expectedProfileRevision:1},'fail-audit'),/test_ec_actor/)
  assert.equal((await ec.readGuideEcConversions(p.programId)).find(a=>a.activityId==='row-10').profile.revision,1)
  const changedConversion=(await ec.readGuideEcConversions(changed.programId)).find(a=>a.activityId==='row-10');assert.ok(changedConversion.recipeKey)
  await query("INSERT INTO spff.guide_ec_profiles(site_id,recipe_key,revision,profile,updated_by)VALUES('other',$1,1,$2,'other')",[changedConversion.recipeKey,JSON.stringify(input)])
  assert.equal((await ec.readGuideEcConversions(changed.programId)).find(a=>a.activityId==='row-10').profile,null)
  const foreignId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await query("INSERT INTO spff.guide_programs SELECT 'other',$1,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,created_at,updated_at,updated_by FROM spff.guide_programs WHERE site_id='greenhouse-01' AND program_id=$2",[foreignId,changed.programId])
  await assert.rejects(ec.readGuideEcConversions(foreignId),e=>e.status===404)
  await assert.rejects(ec.saveGuideEcProfile(foreignId,input,'admin'),e=>e.status===404)
  await assert.rejects(ec.readGuideEcConversions('00000000-0000-0000-0000-000000000000'),e=>e.status===404)
 }finally{await realEnd();await db.close()}
})
