import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';

const enabled = process.env.SPFF_TEST_ISOLATED_TRANSPORT === 'true';

test('real AI Fuzzy → temporary PostgreSQL → isolated Mosquitto QoS1 → simulated ESP32 ACK → real repository', {
  skip: !enabled,
  timeout: 45000,
}, async () => {
  // Hard preflight: never run against a production DB or MQTT broker.
  assert.match(process.env.SPFF_TEST_DB_DIRECTORY ?? '', /^\/(?:var\/)?tmp\//);
  assert.equal(process.env.SPFF_TEST_LIVE_AI_SHADOW, 'true');
  assert.equal(process.env.DATABASE_URL, 'postgresql://invalid:invalid@127.0.0.1:1/never_used');
  assert.ok(process.env.PGPORT, 'pg_virtualenv PGPORT is required');
  assert.ok(process.env.PGHOST, 'pg_virtualenv PGHOST is required');

  const { default: pgModule } = await import('pg');
  const { Pool } = pgModule;
  const { connect } = await import('mqtt');
  process.env.MQTT_URL = 'mqtt://127.0.0.1:18884';
  process.env.MQTT_CLIENT_ID = 'ai-isolated-worker-' + randomUUID();
  const { unifiedAiDashboardSchema, isPumpCommandMessage, mqttTopics } = await import('@spff/contracts');
  const { convertAiFuzzyToSoftwareTrial } = await import('../lib/services/aiVolumeTrialConversion.js');
  const { CommandDispatchService } = await import('../../mqtt-worker/dist/commandDispatchService.js');
  const { PostgresIngestionRepository } = await import('../../mqtt-worker/dist/repository.js');
  const { IngestionService } = await import('../../mqtt-worker/dist/ingestionService.js');
  const { MqttWorker } = await import('../../mqtt-worker/dist/mqttWorker.js');

  const pg = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: 'postgres', // same disposable DB where the wrapper applies migrations
    user: process.env.PGUSER,
    max: 3,
    connectionTimeoutMillis: 4000,
  });
  const siteId = 'ai-isolated-software-test';
  const deviceId = 'esp32-s3-test-isolated';
  const commandId = 'ai-isolated-' + randomUUID();
  const cmdTopic = mqttTopics.commands(siteId, deviceId);
  const ackTopic = mqttTopics.acknowledgements(siteId, deviceId);
  const broker = 'mqtt://127.0.0.1:18884';
  const clients = [];
  const messageErrors = [];
  let processedAcks = 0;

  async function connectTestClient(label) {
    const client = connect(broker, {
      clientId: 'ai-' + label + '-' + randomUUID(),
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 4000,
    });
    clients.push(client);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(label + ' broker connect timeout')), 5000);
      client.once('connect', () => { clearTimeout(timeout); resolve(); });
      client.once('error', err => { clearTimeout(timeout); reject(err); });
    });
    return client;
  }

  async function until(query, params, predicate, description, timeoutMs=5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (messageErrors.length) throw messageErrors[0];
      const result = await pg.query(query, params);
      if (predicate(result)) return result;
      await sleep(35);
    }
    throw new Error('Timed out: ' + description);
  }

  let sim;
  let mqttWorker;
  try {
    // This fetch is read-only; the conversion rejects stale/mismatched inputs.
    const sourceResponse = await fetch('http://127.0.0.1:5011/dashboard/summary', {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(sourceResponse.ok, true);
    const source = unifiedAiDashboardSchema.parse(await sourceResponse.json());
    const candidate = convertAiFuzzyToSoftwareTrial(source, {
      deviceId, trialCapL: 5, durationSec: 30,
    });
    assert.equal(candidate.canDispatch, false);
    assert.equal(candidate.commandCreated, false);
    assert.equal(candidate.mqttPublished, false);
    assert.ok(candidate.commandCandidate.params.waterTrial.targetWaterL >= 1);
    assert.ok(candidate.commandCandidate.params.waterTrial.targetWaterL <= 5);

    // All tables, rows, commands and ACKs exist ONLY in pg_virtualenv's temp DB.
    await pg.query('INSERT INTO spff.sites(site_id,name) VALUES ($1,$2)', [siteId, 'Isolated AI test']);
    await pg.query(
      'INSERT INTO spff.devices(site_id,device_id,display_name) VALUES ($1,$2,$3)',
      [siteId,deviceId,'ESP32 simulator only'],
    );
    await pg.query(
      'INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name,max_runtime_seconds) VALUES ($1,$2,$3,$4,$5)',
      [siteId,deviceId,'pump_water','Simulated pump',60],
    );
    await pg.query(
      `INSERT INTO spff.device_automatic_control_configs(
        site_id,device_id,desired_mode,applied_mode,revision,
        acknowledged_revision,acknowledgement_status
      ) VALUES ($1,$2,'manual','manual',1,1,'applied')`,
      [siteId,deviceId],
    );
    const created = new Date();
    await pg.query(
      `INSERT INTO spff.control_commands (
        command_id,site_id,device_id,actuator_key,requested_is_active,
        requested_by,issued_at,expires_at,request_payload
      ) VALUES ($1,$2,$3,'pump_water',true,$4,$5,$6,$7::jsonb)`,
      [commandId,siteId,deviceId,'trial:water:isolated-software-test',
        created.toISOString(),new Date(created.getTime()+15000).toISOString(),
        JSON.stringify({
          source:'isolated-ai-test-no-operator-approval',
          waterTrial:candidate.commandCandidate.params.waterTrial,
        })],
    );

    sim = await connectTestClient('esp-simulator');
    const queuedCommand = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MQTT command was not delivered')), 5000);
      sim.on('message',(topic,payload) => {
        if(topic !== cmdTopic)return;
        clearTimeout(timeout);
        try { resolve(JSON.parse(payload.toString())); } catch(error) { reject(error); }
      });
    });
    await sim.subscribeAsync(cmdTopic,{qos:1});

    const repository = new PostgresIngestionRepository(pg);
    const ingester = new IngestionService(repository);
    mqttWorker = new MqttWorker({
      async process(topic, payload) {
        try {
          const result = await ingester.process(topic, payload);
          if (topic === ackTopic) processedAcks += 1;
          return result;
        } catch (error) {
          messageErrors.push(error);
          throw error;
        }
      },
    });
    await mqttWorker.start();

    const dispatcher = new CommandDispatchService(repository, mqttWorker);
    await dispatcher.runOnce();
    const wire = await queuedCommand;
    assert.equal(wire.commandId,commandId);
    assert.equal(wire.params.waterTrial.targetWaterL,candidate.conversion.targetWaterL);
    assert.equal(wire.params.waterTrial.durationSec,30);
    assert.equal(wire.targetId,'pump_water');
    assert.equal(isPumpCommandMessage(wire),true);
    assert.equal((await pg.query('SELECT status FROM spff.control_commands WHERE command_id=$1',[commandId])).rows[0].status,'published');

    const deviceAck = (status,isActive,stamp) => ({
      kind:'command_ack',schemaVersion:1,siteId,deviceId,commandId,
      targetId:'pump_water',status,actualState:{isActive},
      actualWaterL:status==='accepted'?0:5,elapsedSec:15,
      acknowledgedAt:new Date(created.getTime()+stamp).toISOString(),
      reason:'trial_volume_reached',
    });
    const sendAck = async ack => sim.publishAsync(ackTopic,JSON.stringify(ack),{qos:1,retain:false});

    const accepted = deviceAck('accepted',true,1000);
    await sendAck(accepted);
    await until(
      'SELECT status FROM spff.control_commands WHERE command_id=$1', [commandId],
      result=>result.rows[0]?.status==='accepted','accepted ACK',
    );
    const unsafeCompleted = deviceAck('completed',true,2000);
    await sendAck(unsafeCompleted);
    await until(
      'SELECT COUNT(*)::int AS n FROM spff.command_ack_events WHERE command_id=$1', [commandId],
      result=>result.rows[0]?.n===2,'unsafe completion evidence recorded',
    );
    assert.equal((await pg.query('SELECT status FROM spff.control_commands WHERE command_id=$1',[commandId])).rows[0].status,'accepted',
      'actual ON must never finish a volume trial');

    const completed = deviceAck('completed',false,3000);
    await sendAck(completed);
    await until(
      'SELECT status FROM spff.control_commands WHERE command_id=$1', [commandId],
      result=>result.rows[0]?.status==='completed','OFF completion ACK',
    );
    await sendAck(completed); // Duplicate QoS1 delivery must not create a second ledger row.
    await until(
      'SELECT COUNT(*)::int AS n FROM spff.command_ack_events WHERE command_id=$1',
      [commandId],
      result => processedAcks >= 4 && result.rows[0]?.n === 3,
      'all four ACK packets ingested and duplicate deduplicated',
    );
    const records=await pg.query(
      'SELECT status,actual_is_active FROM spff.command_ack_events WHERE command_id=$1 ORDER BY acknowledged_at',
      [commandId],
    );
    assert.deepEqual(records.rows.map(r=>[r.status,r.actual_is_active]),[
      ['accepted',true],['completed',true],['completed',false],
    ]);
    const off = await pg.query(
      `SELECT is_active, source FROM spff.latest_actuator_states
       WHERE site_id=$1 AND device_id=$2 AND actuator_key='pump_water'`,[siteId,deviceId],
    );
    assert.equal(off.rows[0]?.is_active,false);
    assert.equal(off.rows[0]?.source,'command_ack');
    assert.equal(messageErrors.length,0);
    console.log('ISOLATED LIVE AI → PG → REAL MQTT → SIMULATED DEVICE ACK:',JSON.stringify({
      sourceVolumeL:candidate.source.illustrativeWaterL,
      trialVolumeL:candidate.conversion.targetWaterL,
      timeoutSec:candidate.conversion.durationSec,
      mqttBroker:broker,
      commandTopic:cmdTopic,
      ackTopic,
      commandId,
      dbCommandStatus:'completed',
      ackRows:records.rows.length,
      device:'SIMULATOR ONLY',
      pumpPhysicallyActuated:false,
    }));
  } finally {
    if (mqttWorker) await mqttWorker.stop();
    for(const client of clients) {
      await new Promise(resolve=>client.end(true,{},()=>resolve()));
    }
    await pg.end();
  }
});
