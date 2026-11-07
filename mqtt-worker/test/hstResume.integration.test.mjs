import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {recordEcFertilizerDelivery} from '../dist/ecDoseEstimator.js';

test('explicit same-batch resume preserves cumulative dose and baseline and starts a new interval anchor',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite();
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const now=new Date(),old=new Date(now.getTime()-300000),expires=new Date(now.getTime()-210000);
 const pid='11111111-1111-4111-8111-111111111111',phaseId='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
 try {
  const dir=new URL('../../infrastructure/postgres/migrations/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
  await db.exec(`INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','test');
   INSERT INTO spff.devices(site_id,device_id,display_name) VALUES('greenhouse-01','esp32-s3-01','test');
   INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name) VALUES
    ('greenhouse-01','esp32-s3-01','pump_water','Water'),('greenhouse-01','esp32-s3-01','pump_fert','Fert');
   INSERT INTO spff.device_automatic_control_configs(site_id,device_id,desired_mode,applied_mode,
    water_enabled,water_moisture_low_pct,water_moisture_target_pct,water_max_runtime_seconds,water_cooldown_seconds,water_min_flow_lpm,
    acknowledged_revision,acknowledgement_status) VALUES('greenhouse-01','esp32-s3-01','automatic','automatic',true,23,60,900,30,5,1,'applied');`);
  await query(`INSERT INTO spff.guide_programs(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,updated_by)
   VALUES('greenhouse-01',$1,1,'{}',$2,1,'{}','{}','test')`,[pid,'a'.repeat(64)]);
  await query(`INSERT INTO spff.hst_fertilization_phases(phase_id,site_id,device_id,program_id,activity_id,phase_number,title,hst,product,method,
   target_g,delivered_g,formula_status,started_at,baseline) VALUES($1,'greenhouse-01','esp32-s3-01',$2,'row-16',2,'Pemupukan ke-2',20,'Phonska plus','Tabur',50000,123,'ready',$3,$4)`,
   [phaseId,pid,old,JSON.stringify({bootId:'boot-a'})]);
  await query(`INSERT INTO spff.automatic_cycle_states(site_id,device_id,phase_id,mode,reason,dispatch_enabled)
   VALUES('greenhouse-01','esp32-s3-01',$1,'fertilization','fertilizer_remaining',true)`,[phaseId]);
  await db.exec(`INSERT INTO spff.device_schedule_sync_state(site_id,device_id) VALUES('greenhouse-01','esp32-s3-01') ON CONFLICT DO NOTHING;`);
  for(const [id,target] of [['old-water','pump_water'],['old-fert','pump_fert']])
   await query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,requested_is_active,requested_by,
    status,issued_at,expires_at,published_at,request_payload) VALUES($1,'greenhouse-01','esp32-s3-01',$2,true,'hst-fertilization','completed',$3,$4,$3,$5)`,
    [id,target,old,expires,JSON.stringify({hstRuntimeCompletedAt:now.toISOString()})]);
  await query(`INSERT INTO spff.hst_fertilization_starts(start_id,site_id,device_id,program_id,activity_id,hst,application_day,
   product,method,water_command_id,fertilizer_command_id,phase_id,status,started_at)
   VALUES($1,'greenhouse-01','esp32-s3-01',$2,'row-16',20,current_date,'Phonska plus','Tabur','old-water','old-fert',$3,'started',$4)`,[sid,pid,phaseId,old]);
  await query(`INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)
   VALUES('greenhouse-01','esp32-s3-01',true,'automatic',$1,$2)`,[now,JSON.stringify({pulseBootId:'boot-a',pumpReadbackValid:true,pumpWaterActualActive:false,pumpFertActualActive:false})]);
  await query(`INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at)
   VALUES('greenhouse-01','esp32-s3-01','old',1,$1)`,[old]);
  const profile={coefficient:6400,validated:true,baselineBasis:'WATER_ONLY_STABLE'};
  await query(`INSERT INTO spff.ec_dose_profiles(site_id,device_id,product_key,product,coefficient,validated,calibration_reference,updated_by)
   VALUES('greenhouse-01','esp32-s3-01','phonska plus','Phonska plus',6400,true,'test','test')`);
  await query(`INSERT INTO spff.ec_dose_estimates(phase_id,profile_snapshot,baseline_ec,baseline_at,baseline_boot_id,cursor_id,anchor,estimated_g)
   VALUES($1,$2,200,$3,'boot-a',1,$4,123)`,[phaseId,JSON.stringify(profile),old,JSON.stringify({id:'1',at:old.toISOString(),totalL:50})]);
  const resumeSql=readFileSync(new URL('../../scripts/sql/resume-hst-cycle.sql',import.meta.url),'utf8');
  await query(`UPDATE spff.device_status_events SET raw_payload=raw_payload||'{"pumpWaterActualActive":true}'::jsonb`);
  await assert.rejects(()=>db.exec(resumeSql),/BOTH pumps OFF/);await db.exec('ROLLBACK');
  assert.equal(Number((await query('SELECT count(*) AS n FROM spff.control_commands')).rows[0].n),2);
  await query(`UPDATE spff.device_status_events SET raw_payload=raw_payload||'{"pumpWaterActualActive":false}'::jsonb`);
  await query('UPDATE spff.hst_fertilization_phases SET fulfilled=true');
  await assert.rejects(()=>db.exec(resumeSql),/no unfinished/);await db.exec('ROLLBACK');
  await query('UPDATE spff.hst_fertilization_phases SET fulfilled=false');
  await db.exec(resumeSql);
  const state=(await query('SELECT * FROM spff.ec_dose_estimates')).rows[0];
  assert.equal(state.estimated_g,123);assert.equal(state.cursor_id,1);assert.equal(state.baseline_ec,200);
  assert.deepEqual(state.profile_snapshot,profile);assert.equal(state.anchor,null);
  const phase=(await query('SELECT * FROM spff.hst_fertilization_phases')).rows[0];
  assert.equal(phase.delivered_g,123);assert.equal(new Date(phase.baseline.originalStartedAt).getTime(),old.getTime());
  const h=(await query('SELECT * FROM spff.hst_fertilization_starts')).rows[0];
  assert.equal(h.status,'queued');assert.equal(h.started_at,null);assert.notEqual(h.water_command_id,'old-water');
  const newCommand=(await query('SELECT request_payload FROM spff.control_commands WHERE command_id=$1',[h.water_command_id])).rows[0].request_payload;
  assert.equal(newCommand.previousWaterCommandId,'old-water');assert.equal(newCommand.hstRuntimeLimitSeconds,900);
  assert.equal(newCommand.hstRuntimeCompletedAt,undefined);assert.equal(newCommand.sameBatch,true);
  await assert.rejects(()=>db.exec(resumeSql),/already queued/);await db.exec('ROLLBACK');
  assert.equal(Number((await query('SELECT count(*) AS n FROM spff.control_commands')).rows[0].n),4,'double invocation cannot queue another ON');
  const resumedAt=phase.started_at;
  for(const [i,seconds] of [5,35].entries()) {
   const at=new Date(resumedAt.getTime()+seconds*1000),statusAt=new Date(at.getTime()-1000);
   await query(`INSERT INTO spff.device_status_events(site_id,device_id,online,mode,recorded_at,raw_payload)
    VALUES('greenhouse-01','esp32-s3-01',true,'automatic',$1,$2)`,[statusAt,JSON.stringify({pulseBootId:'boot-a',pumpReadbackValid:true,pumpWaterActualActive:true,pumpFertActualActive:true})]);
   await query(`INSERT INTO spff.telemetry_samples(site_id,device_id,message_id,sequence,recorded_at,liquid_ec_us_cm,
    flow_water_lpm,flow_fert_lpm,flow_water_total_l,flow_fert_total_l,sensor_health,raw_payload)
    VALUES('greenhouse-01','esp32-s3-01',$1,$2,$3,3000,200,7,$4,$5,$6,$7)`,['resumed-'+i,i+2,at,1000+i*100,20+i*3,
    JSON.stringify(Object.fromEntries(['liquid_ec_us_cm','flow_water_lpm','flow_fert_lpm','flow_water_total_l','flow_fert_total_l'].map(k=>[k,{valid:true}]))),
    JSON.stringify({sensorHealth:{soil_2_moisture:{pollBootId:'boot-a'}}})]);
  }
  const result=await recordEcFertilizerDelivery({query},phase,new Date(resumedAt.getTime()+60000));
  assert.equal(result.grams,166.75,'adds 43.75g to existing 123g, without integrating the stopped gap');
  const again=await recordEcFertilizerDelivery({query},phase,new Date(resumedAt.getTime()+60000));
  assert.equal(again.grams,166.75);
 }finally{await db.close();}
});
