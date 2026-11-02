import assert from 'node:assert/strict';
import test from 'node:test';
import { aiAutomaticPumpReadinessSchema } from '@spff/contracts';
import { assessAutomaticAiPumpReadiness } from '../lib/services/aiAutomaticPumpReadiness.js';

const ai=(mode='automatic', status='CURRENT', hold=false)=>({
  mode:'SHADOW_MODE',can_dispatch:false,status,
  decision:{type:hold?'HOLD':'IRRIGATE',hold_reasons:hold?['not_ready']:[],proposed_action:'IRRIGATE',configuration_version:'rev1'},
  sensors:{device_mode:mode},
});
const evidence=(mode='automatic')=>({
  deviceEnabled:true,deviceOnline:true,deviceMode:mode,
  statusRecordedAt:new Date(),
  firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC',
  desiredMode:'automatic',appliedMode:'automatic',autoAckStatus:'applied',
  revision:'2',acknowledgedRevision:'2',waterEnabled:true,competingCommand:false,
});

test('even matching automatic mode is preview only: firmware 1.5.03 rejects AI ON',()=>{
  const result=assessAutomaticAiPumpReadiness(ai(),evidence(),'esp32-s3-01');
  assert.equal(aiAutomaticPumpReadinessSchema.safeParse(result).success,true);
  assert.equal(result.canDispatch,false);
  assert.equal(result.commandCreated,false);
  assert.equal(result.commandType,'set_pump');
  assert.equal(result.actualMode,'automatic');
  assert.deepEqual(result.blockers,['AI_SHADOW_NOT_EXECUTION_AUTHORITY','FIRMWARE_AUTO_AI_ON_UNSUPPORTED']);
  assert.equal(aiAutomaticPumpReadinessSchema.safeParse({...result,canDispatch:true}).success,false);
});

test('manual mode on device OR AI source prevents automatic AI control',()=>{
  const manualDevice=assessAutomaticAiPumpReadiness(ai(),evidence('manual'),'esp32-s3-01');
  assert.ok(manualDevice.blockers.includes('DEVICE_NOT_AUTOMATIC'));
  const manualAi=assessAutomaticAiPumpReadiness(ai('manual'),evidence(),'esp32-s3-01');
  assert.ok(manualAi.blockers.includes('AI_SOURCE_NOT_AUTOMATIC'));
});

test('unacknowledged mode, stale status, HOLD and command conflict each block',()=>{
  const base=evidence();
  const result=assessAutomaticAiPumpReadiness(ai('automatic','STALE',true),{
    ...base,autoAckStatus:'rejected',acknowledgedRevision:'1',
    statusRecordedAt:new Date(Date.now()-120000),competingCommand:true,waterEnabled:false,
  },'esp32-s3-01');
  for(const code of ['AI_DECISION_NOT_CURRENT','AI_DECISION_HOLD','DEVICE_NOT_ONLINE_FRESH',
    'AUTO_CONFIG_NOT_ACKNOWLEDGED','AUTO_WATER_NOT_ENABLED','COMPETING_COMMAND_IN_FLIGHT']){
    assert.ok(result.blockers.includes(code),code);
  }
});

test('ephemeral PostgreSQL preflight reads actual Manual/Automatic and ACK evidence', {
  skip:process.env.SPFF_TEST_ISOLATED_TRANSPORT!=='true',
  timeout:15000,
},async()=>{
  assert.match(process.env.SPFF_TEST_DB_DIRECTORY??'',/^\\/(?:var\\/)?tmp\\//);
  assert.equal(process.env.DATABASE_URL,'postgresql://invalid:invalid@127.0.0.1:1/never_used');
  assert.ok(process.env.PGPORT);
  const {default:pgModule}=await import('pg');
  const pg=new pgModule.Pool({
    host:process.env.PGHOST,
    port:Number(process.env.PGPORT),
    database:'postgres',
    user:process.env.PGUSER,
    max:2,
  });
  const {readAutomaticPumpEvidence}=await import('../lib/services/aiAutomaticPumpReadiness.js');
  const site='ai-automatic-isolated';
  const dev='esp32-s3-ai-auto-test';
  try {
    await pg.query('INSERT INTO spff.sites(site_id,name) VALUES($1,$2)',[site,'Automatic read-only test']);
    await pg.query('INSERT INTO spff.devices(site_id,device_id,display_name) VALUES($1,$2,$3)',
      [site,dev,'NO PHYSICAL DEVICE']);
    await pg.query(`INSERT INTO spff.device_automatic_control_configs(
        site_id,device_id,desired_mode,applied_mode,acknowledgement_status,
        revision,acknowledged_revision,water_enabled,water_moisture_low_pct,
        water_moisture_target_pct,water_max_runtime_seconds,water_cooldown_seconds,
        water_min_flow_lpm
      ) VALUES($1,$2,'automatic','automatic','applied',1,1,true,25,35,30,60,0)`,[site,dev]);
    await pg.query(`INSERT INTO spff.device_status_events(
       site_id,device_id,online,mode,firmware_version,recorded_at)
      VALUES($1,$2,true,'manual','1.5.03-SHT20-TELEMETRY-SYNC',now())`,[site,dev]);
    const before=await readAutomaticPumpEvidence(dev,pg,site);
    assert.equal(before.deviceMode,'manual');
    assert.ok(assessAutomaticAiPumpReadiness(ai(),before,dev).blockers.includes('DEVICE_NOT_AUTOMATIC'));
    await pg.query(`INSERT INTO spff.device_status_events(
       site_id,device_id,online,mode,firmware_version,recorded_at)
      VALUES($1,$2,true,'automatic','1.5.03-SHT20-TELEMETRY-SYNC',now())`,[site,dev]);
    const after=await readAutomaticPumpEvidence(dev,pg,site);
    assert.equal(after.deviceMode,'automatic');
    assert.equal(after.appliedMode,'automatic');
    assert.equal(after.autoAckStatus,'applied');
    const result=assessAutomaticAiPumpReadiness(ai(),after,dev);
    assert.deepEqual(result.blockers,['AI_SHADOW_NOT_EXECUTION_AUTHORITY','FIRMWARE_AUTO_AI_ON_UNSUPPORTED']);
    assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM spff.control_commands WHERE site_id=$1',[site])).rows[0].n,0);
  }finally{await pg.end();}
});
