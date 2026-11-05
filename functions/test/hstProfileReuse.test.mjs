import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {guideEcRecipe} from '@spff/contracts';

test('stored HST installation profiles are suggested read-only and rebound only after explicit review',async t=>{
 process.env.DATABASE_URL??='postgresql://spff_test:invalid@127.0.0.1:1/spff_test';
 const repo=await import('../lib/services/postgresRepository.js');
 const service=await import('../lib/services/hstRealExecutionService.js');
 const original=repo.pool.query;
 const sourceId='11111111-1111-4111-8111-111111111111';
 const targetId='22222222-2222-4222-8222-222222222222';
 const activity=(row=19)=>({id:'row-'+row,hst:20,title:'Kocor',method:'Kocor',waterL:100,warnings:[],
  requirements:[{row,product:'Ultradap',amount:0.4,unit:'kg',waterL:100,warnings:[]}]});
 const config={cropId:'ubi-jalar',plantingDate:'2026-10-15',basis:'plants',quantity:100,
  deviceId:'esp32-s3-01',waterEcMsCm:0.1};
 const profile={site_id:'greenhouse-01',program_id:sourceId,activity_id:'row-19',source_row:19,
  device_id:'esp32-s3-01',product:'Ultradap',program_revision:2,ec_profile_revision:3,
  stock_concentration_g_l:40,water_meter_position:'before_injector',hydraulics_reference:'Measured fixture only, not a field calibration',
  ec_tolerance_us:100,max_duration_sec:600,flush_duration_sec:30};
 let rows,sourceProgram,targetProgram,ecRevision,writes;
 const reset=()=>{
  rows=[structuredClone(profile)];
  sourceProgram={revision:2,config:{...config},plan:{activities:[activity()]}};
  targetProgram={revision:9,config:{...config},plan:{activities:[activity(21)]}};
  ecRevision=3;writes=[];
 };
 repo.pool.query=async(sql,params=[])=>{
  if(sql.includes('SELECT p.* FROM spff.hst_real_profiles'))return {rows};
  if(sql.includes('FROM spff.guide_programs'))return {rows:[params[1]===sourceId?sourceProgram:targetProgram]};
  if(sql.includes('FROM spff.guide_ec_profiles'))return {rows:[{
   recipe_key:createHash('sha256').update(guideEcRecipe(activity()).key).digest('hex'),revision:ecRevision,
   profile:{sourceReference:'Synthetic measured test curve',referenceWaterEcMsCm:0,temperatureCompensated25C:true,
    mixtureVerified:true,points:[{concentrationGPerL:0,ecMsCm:0},{concentrationGPerL:10,ecMsCm:2}]},
   updated_by:'test-admin',updated_at:new Date('2026-11-01T00:00:00Z'),
  }]};
  if(sql.includes('INSERT INTO spff.hst_real_profiles')){writes.push(params);return {rows:[{verified_at:new Date()}]};}
  throw Error('Unexpected database operation: '+sql);
 };
 try{
  await t.test('uses saved stock concentration, not the Guide final-solution concentration',async()=>{
   reset();const suggestion=await service.readReusableHstHardwareProfile('esp32-s3-01','Ultradap');
   assert.equal(suggestion.stockConcentrationGPerL,40);
   assert.equal(guideEcRecipe(activity()).concentrationGPerL,4);
   assert.equal(suggestion.programId,sourceId);
   assert.equal(writes.length,0);
  });
  await t.test('rejects another device, product, source revision, source row, or EC revision',async()=>{
   for(const change of ['device','product','program','row','ec']){
    reset();
    if(change==='device')rows[0].device_id='other-esp';
    if(change==='product')rows[0].product='Other fertilizer';
    if(change==='program')sourceProgram.revision=3;
    if(change==='row')sourceProgram.plan.activities[0].requirements[0].row=99;
    if(change==='ec')ecRevision=4;
    assert.equal(await service.readReusableHstHardwareProfile('esp32-s3-01','Ultradap'),null,change);
    assert.equal(writes.length,0);
   }
  });
  await t.test('does not suggest multi-product stock or invent a profile when none exists',async()=>{
   reset();rows=[];
   assert.equal(await service.readReusableHstHardwareProfile('esp32-s3-01','Ultradap'),null);
   reset();sourceProgram.plan.activities[0].requirements.push({...activity().requirements[0],product:'Other'});
   assert.equal(await service.readReusableHstHardwareProfile('esp32-s3-01','Ultradap'),null);
  });
  await t.test('explicit save binds current Guide identity and revisions, retaining measured installation data',async()=>{
   reset();const suggestion=await service.readReusableHstHardwareProfile('esp32-s3-01','Ultradap');
   const result=await service.saveHstRealHardwareProfile({...suggestion,programId:targetId,activityId:'row-21',
    sourceRow:21,programRevision:9,ecProfileRevision:3},'test-admin');
   assert.equal(result.profile.programId,targetId);
   assert.equal(result.profile.stockConcentrationGPerL,40);
   assert.equal(writes.length,1);
   assert.equal(writes[0][1],targetId);assert.equal(writes[0][6],9);assert.equal(writes[0][14],'test-admin');
  });
  await t.test('rejects saving a reviewed suggestion after the target Guide changes',async()=>{
   reset();const suggestion=await service.readReusableHstHardwareProfile('esp32-s3-01','Ultradap');
   targetProgram.revision=10;
   await assert.rejects(service.saveHstRealHardwareProfile({...suggestion,programId:targetId,activityId:'row-21',
    sourceRow:21,programRevision:9,ecProfileRevision:3},'test-admin'),/revisi/);
   assert.equal(writes.length,0);
  });
 }finally{repo.pool.query=original;await repo.pool.end();}
});
