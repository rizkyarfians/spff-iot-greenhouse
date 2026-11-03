import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const mosquittoPresent = spawnSync('which', ['mosquitto']).status === 0;
async function run(args) {
  const child = spawn(process.execPath, ['scripts/ai-acc-isolated-mqtt.mjs', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += String(chunk); });
  child.stderr.on('data', chunk => { err += String(chunk); });
  const code = await new Promise(resolve => child.once('exit', resolve));
  return { code, out, err };
}

test('refuse to run without isolated-test-only flag', async () => {
  const r = await run([]);
  assert.equal(r.code, 2);
  assert.match(r.err, /Refusing to run/);
});

test('MQTT QoS1 simulated command + final OFF ACK + duplicate protection', {
  skip: mosquittoPresent ? false : 'Mosquitto executable missing',
  timeout: 12000,
}, async () => {
  const r = await run(['--isolated-test-only']);
  assert.equal(r.code, 0, r.err);
  const result = JSON.parse(r.out);
  assert.equal(result.simulationOnly, true);
  assert.equal(result.broker, '127.0.0.1:18884');
  assert.equal(result.siteId, 'ai-acc-isolated-test');
  assert.equal(result.deviceId, 'esp32-simulator-no-hardware');
  assert.equal(result.acceptedAckObserved, true);
  assert.equal(result.completedAckOffObserved, true);
  assert.equal(result.attemptedCommands, 2);
  assert.equal(result.simulatedStarts, 1);
  assert.equal(result.duplicateIgnored, 1);
  assert.equal(result.physicalAckReceived, false);
  assert.equal(result.physicalWaterDeliveredL, null);
  assert.equal(result.productionBrokerTouched, false);
  assert.equal(result.productionDatabaseTouched, false);
});
