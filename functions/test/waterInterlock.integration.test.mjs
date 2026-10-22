import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
test('water interlock SQL and controller: default enabled, revision CAS, durable ACK, retries and stale rejection',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href),db=new PGlite();
  process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.MQTT_URL='mqtt://localhost:1883';
  const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
  const client={query,release(){}};const adapter={query,connect:async()=>client,end:async()=>{}};
  const repo=await import('../lib/services/postgresRepository.js');const realEnd=repo.pool.end.bind(repo.pool);
  repo.pool.query=query;repo.pool.connect=adapter.connect;
  try{
    await db.exec('CREATE ROLE spff_app; CREATE ROLE spff_api_role; CREATE ROLE spff_worker; CREATE ROLE spff_worker_role; CREATE ROLE spff_sync; CREATE ROLE spff_backup_role;');
    const base=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations');
    const names=readdirSync(base).sort();
    for(const name of names.filter(n=>!n.startsWith('027')))await db.exec(readFileSync(resolve(base,name),'utf8'));
    await db.exec("INSERT INTO spff.sites(site_id,name)VALUES('greenhouse-01','Test'); INSERT INTO spff.devices(site_id,device_id,display_name)VALUES('greenhouse-01','esp32-s3-01','Test');");
    await db.exec(readFileSync(resolve(base,'027_web_water_interlock.sql'),'utf8'));
    const {readWaterInterlock,putWaterInterlock}=await import('../lib/controllers/waterInterlockController.js');
    const initial=await readWaterInterlock('esp32-s3-01');assert.equal(initial.enabled,true);assert.equal(initial.revision,1);assert.equal(initial.appliedEnabled,null);
    assert.equal((await query("SELECT has_table_privilege('spff_api_role','spff.device_water_interlock_configs','UPDATE') AS allowed")).rows[0].allowed,true);
    async function update(body){
      let status=200,json;const res={status(v){status=v;return this},json(v){json=v;return this}};
      await putWaterInterlock({body,auth:{username:'test-admin'}},res,e=>{throw e});return {status,...json};
    }
    let result=await update({deviceId:'esp32-s3-01',expectedRevision:1,enabled:false});
    assert.equal(result.status,200);assert.equal(result.data.revision,2);assert.equal(result.data.enabled,false);assert.equal(result.data.acknowledgementStatus,null);
    assert.equal((await update({deviceId:'esp32-s3-01',expectedRevision:1,enabled:false})).data.revision,2); // uncertain HTTP retry
    assert.equal((await update({deviceId:'esp32-s3-01',expectedRevision:1,enabled:true})).status,409);
    assert.equal((await update({deviceId:'esp32-s3-01',expectedRevision:2,enabled:'false'})).status,400);
    const {WaterInterlockSyncService}=await import('../../mqtt-worker/dist/waterInterlockSync.js');
    const messages=[],sync=new WaterInterlockSyncService(async value=>{messages.push(value)},adapter);
    assert.equal(await sync.installed(),true);await sync.runOnce(true);assert.equal(messages.length,1);assert.equal(messages[0].enabled,false);
    const ack={kind:'water_interlock_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',revision:2,
      status:'applied',appliedRevision:2,enabled:false,acknowledgedAt:new Date().toISOString(),reason:'interlock_config_applied'};
    await assert.rejects(sync.saveAck({...ack,siteId:'other'}));
    await assert.rejects(sync.saveAck({...ack,enabled:true}));
    await sync.saveAck(ack);await sync.saveAck(ack);
    assert.equal((await readWaterInterlock('esp32-s3-01')).appliedEnabled,false);
    await sync.saveAck({...ack,status:'rejected',appliedRevision:1,enabled:true,reason:'late_rejection'});
    assert.equal((await readWaterInterlock('esp32-s3-01')).acknowledgementStatus,'applied');
    assert.equal((await query('SELECT * FROM spff.water_interlock_ack_events')).rows.length,2);
    result=await update({deviceId:'esp32-s3-01',expectedRevision:2,enabled:true});assert.equal(result.data.revision,3);
    await sync.saveAck(ack); // stale previous revision cannot mark current revision applied
    assert.equal((await readWaterInterlock('esp32-s3-01')).acknowledgementStatus,null);
    await sync.runOnce();assert.equal(messages.at(-1).revision,3);assert.equal(messages.at(-1).enabled,true);
    await sync.saveAck({...ack,revision:3,appliedRevision:3,enabled:true});
    await db.exec(`INSERT INTO spff.device_status_events(site_id,device_id,message_id,recorded_at,online,mode,raw_payload)
      VALUES('greenhouse-01','esp32-s3-01','test-water-status',now(),true,'manual','{"waterInterlockConfigCapable":true,"waterInterlockEnabled":true,"waterInterlockRevision":3}');`);
    const actual=await readWaterInterlock('esp32-s3-01');assert.equal(actual.reportedEnabled,true);assert.equal(actual.capable,true);
  }finally{await realEnd();await db.close();}
});
