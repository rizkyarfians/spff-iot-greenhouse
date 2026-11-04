import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {adaptiveSessionInputSchema,guideEcRecipe} from '@spff/contracts';

// This test is deliberately integration-only and requires an isolated PGlite.
// Never run against Orange Pi production database.
test('HST physical ACC allocates one atomic adaptive command + immutable duty binding', {
 skip:!process.env.SPFF_TEST_PGLITE_MODULE,
},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
 const db=new PGlite();
 const repo=await import('../lib/services/postgresRepository.js');
 const oldEnd=repo.pool.end.bind(repo.pool);
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 repo.pool.query=query;repo.pool.connect=async()=>({query,release(){}});
 const programs=await import('../lib/services/guideProgramService.js');
 const ec=await import('../lib/services/guideEcConversionService.js');
 const adaptive=await import('../lib/services/adaptiveFertigationService.js');
 try{
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations');
  for(const name of readdirSync(dir).sort())await db.exec(readFileSync(resolve(dir,name),'utf8'));
  await db.exec("INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test'); INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test ESP');");
  await db.exec(`INSERT INTO spff.device_automatic_control_configs
   (site_id,device_id,desired_mode,water_enabled,fertilizer_enabled,acknowledgement_status,acknowledged_revision,applied_mode)
   VALUES('greenhouse-01','esp32-s3-01','manual',false,false,'applied',1,'manual');
   UPDATE spff.device_automatic_control_configs SET water_min_tank_level_pct=10,fertilizer_min_tank_level_pct=10;
   INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01',true,'manual',now(),
   '{"firmwareVersion":"1.5.07-AI-ACC-SESSION","pulseBootId":"a1b2c3d4e5f60708","pumpReadbackValid":true,"pumpWaterActualActive":false,"pumpFertActualActive":false,"aiAccSessionActive":false}');`);
  const health=JSON.stringify(Object.fromEntries(
   ['liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm'].map(key=>[key,{valid:true}])
  ));
  await query(`INSERT INTO spff.telemetry_samples
   (site_id,device_id,message_id,sequence,recorded_at,liquid_ec_us_cm,tank_water_level_pct,tank_fert_level_pct,flow_water_lpm,flow_fert_lpm,sensor_health,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01','hst-test-1',1,now(),100,80,70,0,0,$1,'{}')`,[health]);
  const cfg={cropId:'terong',plantingDate:'2026-01-01',basis:'plants',quantity:6000,deviceId:'esp32-s3-01',waterEcMsCm:0.1};
  const preview=await programs.previewGuideProgram(cfg);
  const program=await programs.saveGuideProgram({config:cfg,sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},'admin');
  const activity=program.plan.activities.find(a=>a.method.toLowerCase()==='kocor' && a.requirements.length===1 && guideEcRecipe(a));
  if(!activity){t.skip('Fixture does not include a single-product HST kocor activity');return;}
  await ec.saveGuideEcProfile(program.programId,{
   expectedProgramRevision:1,expectedProfileRevision:0,activityId:activity.id,
   sourceReference:'Synthetic test curve only',referenceWaterEcMsCm:0,
   temperatureCompensated25C:true,mixtureVerified:true,
   points:[{concentrationGPerL:0,ecMsCm:0},{concentrationGPerL:50,ecMsCm:4}],
  },'admin');
  const conversion=(await ec.readGuideEcConversions(program.programId)).find(a=>a.activityId===activity.id);
  if(conversion?.status!=='ready'){t.skip('Fixture concentration outside synthetic EC calibration');return;}
  const requestId=randomUUID(),obligationId='a'.repeat(64);
  const input=adaptiveSessionInputSchema.parse({
   programId:program.programId,expectedProgramRevision:1,expectedProfileRevision:1,
   activityId:activity.id,requestId,waterMeterPosition:'before_injector',
   waterVolumeL:100,stockConcentrationGPerL:100,ecToleranceUs:100,
   maxDurationSec:900,flushDurationSec:30,
   hydraulicsReference:'Synthetic metered Venturi test; not physical certification',
  });
  const calculated=await adaptive.previewAdaptiveSession(input);
  const expectedG=calculated.remainingMassG;
  const stock=Math.min(calculated.command.targetFertVolumeL,expectedG/100);
  const aiPlan={water_l:calculated.command.targetWaterVolumeL,stock_l:stock,
    mass_g:stock*100,duration_seconds:600,priming_water_l:5,flush_reserve_l:5};
  const source=activity.requirements[0];
  await query(`INSERT INTO spff.hst_real_profiles(
   site_id,program_id,activity_id,source_row,device_id,product,program_revision,ec_profile_revision,
   stock_concentration_g_l,water_meter_position,hydraulics_reference,ec_tolerance_us,max_duration_sec,
   flush_duration_sec,verified_by)
   VALUES('greenhouse-01',$1,$2,$3,'esp32-s3-01',$4,1,1,100,'before_injector',$5,100,900,30,'admin')`,
  [program.programId,activity.id,source.row,source.product,input.hydraulicsReference]);
  const binding={obligationId,approvalId:requestId,expectedRemainingG:expectedG,
   sourceRow:source.row,product:source.product,aiPlan};
  process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED='true';
  const session=await adaptive.createAdaptiveSession(input,'admin',binding);
  assert.equal((await adaptive.createAdaptiveSession(input,'admin',binding)).session_id,session.session_id);
  const links=await query('SELECT count(*)::int AS n FROM spff.hst_real_sessions WHERE site_id=$1',[ 'greenhouse-01']);
  assert.equal(links.rows[0].n,1);
  const commands=await query('SELECT payload,status FROM spff.adaptive_fert_commands WHERE site_id=$1',['greenhouse-01']);
  assert.equal(commands.rows.length,1);
  assert.equal(commands.rows[0].payload.commandType,'start');
  assert.equal(commands.rows[0].payload.bootId,'a1b2c3d4e5f60708');
  assert.ok(Math.abs(commands.rows[0].payload.targetFertVolumeL-aiPlan.stock_l)<1e-9);
  await assert.rejects(adaptive.createAdaptiveSession({...input,requestId:randomUUID()},'admin',{
   ...binding,approvalId:randomUUID(),
  }),/sesi|aktif|Jadwal/);
  await assert.rejects(adaptive.createAdaptiveSession({...input,requestId:randomUUID()},'admin',{
   ...binding,sourceRow:source.row+1,approvalId:randomUUID(),
  }),/produk|baris|profil|sesi/);
  assert.equal((await query('SELECT count(*)::int AS n FROM spff.hst_real_sessions')).rows[0].n,1);
 }finally{
  delete process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED;
  await oldEnd();await db.close();
 }
});
