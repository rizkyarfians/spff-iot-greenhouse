/**
 * Isolated MQTT QoS1 transport: no real pump, Edge, DB, or production broker.
 * Accepts only --isolated-test-only. Uses synthetic identity on 127.0.0.1:18884.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import mqtt from 'mqtt';
import { isPumpCommandMessage, isCommandAckMessage, mqttTopics } from '@spff/contracts';

const PORT = 18884;
const SITE = 'ai-acc-isolated-test';
const DEVICE = 'esp32-simulator-no-hardware';
const COMMAND_TOPIC = mqttTopics.commands(SITE, DEVICE);
const ACK_TOPIC = mqttTopics.acknowledgements(SITE, DEVICE);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([
  promise,
  sleep(ms).then(() => { throw new Error('Timed out after ' + ms + ' ms'); }),
]);

async function portMustBeFree() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}

async function waitForBroker(proc) {
  for (let i = 0; i < 65; i++) {
    if (proc.exitCode !== null) throw new Error('Isolated broker exited unexpectedly');
    const ready = await new Promise(resolve => {
      const socket = net.connect(PORT, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(150, () => { socket.destroy(); resolve(false); });
    });
    if (ready) return;
    await sleep(75);
  }
  throw new Error('Isolated broker startup timeout');
}

async function connectClient(prefix) {
  const client = mqtt.connect('mqtt://127.0.0.1:' + PORT, {
    clientId: prefix + randomUUID(), clean: true, reconnectPeriod: 0,
    connectTimeout: 2500,
  });
  await withTimeout(new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  }), 3500);
  client.on('error', () => {});
  return client;
}

async function subscribe(client, topic) {
  await withTimeout(new Promise((resolve, reject) => client.subscribe(
    topic, { qos: 1 }, (error, granted) => error || !granted?.length ||
    granted[0].qos === 128 ? reject(error ?? new Error('Subscribe rejected')) : resolve(),
  )), 2500);
}

async function publish(client, topic, payload) {
  await withTimeout(new Promise((resolve, reject) => client.publish(
    topic, JSON.stringify(payload), { qos: 1, retain: false },
    error => error ? reject(error) : resolve(),
  )), 2500);
}

export async function runIsolatedAccMqtt() {
  if (spawnSync('which', ['mosquitto']).status !== 0) {
    throw new Error('mosquitto executable not installed');
  }
  await portMustBeFree();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'spff-acc-isolated-'));
  const conf = path.join(directory, 'mosquitto.conf');
  await writeFile(conf, [
    'listener 18884 127.0.0.1', 'allow_anonymous true',
    'persistence false', 'log_dest stderr', '',
  ].join('\n'), { mode: 0o600 });
  const broker = spawn('mosquitto', ['-c', conf], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const clients = [];
  let brokerLog = '';
  broker.stderr.on('data', bytes => { brokerLog = (brokerLog + String(bytes)).slice(-1500); });

  try {
    await waitForBroker(broker);
    const simulator = await connectClient('sim-esp-');
    const observer = await connectClient('sim-ack-');
    const sender = await connectClient('sim-acc-');
    clients.push(simulator, observer, sender);

    const commandId = 'sim-' + randomUUID();
    const issuedAt = new Date().toISOString();
    const command = {
      kind: 'command', schemaVersion: 1, siteId: SITE, deviceId: DEVICE,
      commandId, issuedAt, expiresAt: new Date(Date.now() + 15000).toISOString(),
      requestedBy: 'trial:water:simulation-only',
      type: 'set_pump', targetId: 'pump_water',
      params: { isActive: true, waterTrial: { targetWaterL: 1, durationSec: 5 } },
    };
    assert.equal(isPumpCommandMessage(command), true);

    let starts = 0, ignored = 0, accepted = false, completedOff = false;
    const ids = new Set();
    let resolveDuplicate, resolveAck, rejectAck;
    const duplicate = new Promise(resolve => { resolveDuplicate = resolve; });
    const ackFinished = new Promise((resolve, reject) => {
      resolveAck = resolve; rejectAck = reject;
    });

    simulator.on('message', (topic, bytes) => {
      if (topic !== COMMAND_TOPIC) return;
      void (async () => {
        const c = JSON.parse(bytes.toString());
        assert.equal(isPumpCommandMessage(c), true);
        assert.equal(c.siteId, SITE);
        assert.equal(c.deviceId, DEVICE);
        assert.equal(c.commandId, commandId);
        assert.ok(Date.parse(c.expiresAt) > Date.now());
        if (ids.has(c.commandId)) {
          ignored++;
          resolveDuplicate();
          return;
        }
        ids.add(c.commandId);
        starts++;
        const ack = (status, active) => ({
          kind: 'command_ack', schemaVersion: 1, siteId: SITE,
          deviceId: DEVICE, commandId, targetId: 'pump_water',
          status, acknowledgedAt: new Date().toISOString(),
          actualState: { isActive: active },
          reason: 'simulated_no_hardware',
        });
        await publish(simulator, ACK_TOPIC, ack('accepted', true));
        await sleep(20);
        await publish(simulator, ACK_TOPIC, ack('completed', false));
      })().catch(rejectAck);
    });

    observer.on('message', (topic, bytes) => {
      if (topic !== ACK_TOPIC) return;
      try {
        const a = JSON.parse(bytes.toString());
        assert.equal(isCommandAckMessage(a), true);
        assert.equal(a.commandId, commandId);
        assert.equal(a.siteId, SITE);
        assert.equal(a.deviceId, DEVICE);
        if (a.status === 'accepted') accepted = true;
        if (a.status === 'completed') {
          assert.equal(accepted, true);
          assert.equal(a.actualState?.isActive, false);
          completedOff = true;
          resolveAck();
        }
      } catch (error) { rejectAck(error); }
    });

    await subscribe(simulator, COMMAND_TOPIC);
    await subscribe(observer, ACK_TOPIC);
    await publish(sender, COMMAND_TOPIC, command);
    await withTimeout(ackFinished, 5000);
    await publish(sender, COMMAND_TOPIC, command);
    await withTimeout(duplicate, 2000);
    assert.equal(starts, 1);
    assert.equal(ignored, 1);
    assert.equal(completedOff, true);

    return {
      status: 'SIMULATED_COMPLETED_OFF_NOT_PHYSICAL_PROOF',
      simulationOnly: true, mqttQoS: 1, broker: '127.0.0.1:18884',
      siteId: SITE, deviceId: DEVICE,
      acceptedAckObserved: accepted, completedAckOffObserved: completedOff,
      attemptedCommands: 2, simulatedStarts: starts, duplicateIgnored: ignored,
      productionBrokerTouched: false, productionDatabaseTouched: false,
      physicalAckReceived: false, physicalWaterDeliveredL: null,
    };
  } catch (error) {
    throw new Error((error instanceof Error ? error.message : String(error)) +
      (brokerLog ? '\nTest broker: ' + brokerLog : ''));
  } finally {
    await Promise.all(clients.map(client => new Promise(resolve =>
      client.end(true, {}, resolve)))).catch(() => {});
    if (broker.exitCode === null) broker.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--isolated-test-only') {
    console.error('Refusing to run: pass --isolated-test-only');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await runIsolatedAccMqtt(), null, 2));
    } catch (error) {
      console.error('ISOLATED_TEST_FAILED: ' + String(error));
      process.exitCode = 1;
    }
  }
}
