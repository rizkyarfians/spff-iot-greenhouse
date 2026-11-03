import assert from 'node:assert/strict';
import {
  changeAiExecutionMode,
  readAiExecutionMode,
} from '../lib/services/aiExecutionModeService.js';
import { pool } from '../lib/services/postgresRepository.js';

// Never use live SPFF database for a mode-mutation integration test.
if (process.env.SPFF_ISOLATED_AI_MODE_TEST !== 'yes' ||
    process.env.PGDATABASE === 'spff' ||
    !process.env.PGPORT || process.env.PGPORT === '5432' ||
    process.env.SPFF_AI_ACC_LIVE_SWITCH_ENABLED !== 'false' ||
    process.env.SPFF_AI_ACC_WATER_TRIAL_ENABLED !== 'false') {
  throw new Error('Refusing mode integration test outside isolated PostgreSQL.');
}

const deviceId = 'esp32-s3-01';
const base = {
  deviceId,
  confirmation: 'CHANGE_AI_MODE',
};

try {
  const before = await readAiExecutionMode(deviceId);
  assert.equal(before.mode, 'shadow');
  assert.equal(before.revision, 0);
  console.log('PASS 1/5: absent configuration defaults to SHADOW');

  const shadow = await changeAiExecutionMode({
    ...base, mode:'shadow',expectedRevision:0,
  }, 'test-admin');
  assert.equal(shadow.mode,'shadow');
  assert.equal(shadow.revision,1);
  console.log('PASS 2/5: SHADOW persisted to temporary PostgreSQL');

  const off = await changeAiExecutionMode({
    ...base,mode:'off',expectedRevision:1,
  }, 'test-admin');
  assert.equal(off.mode,'off');
  assert.equal(off.revision,2);
  assert.equal((await readAiExecutionMode(deviceId)).mode,'off');
  console.log('PASS 3/5: OFF persisted with incrementing revision');

  await assert.rejects(() => changeAiExecutionMode({
    ...base,mode:'shadow',expectedRevision:1,
  }, 'test-admin'));
  assert.equal((await readAiExecutionMode(deviceId)).mode,'off');
  console.log('PASS 4/5: stale revision cannot overwrite mode');

  await assert.rejects(() => changeAiExecutionMode({
    ...base,mode:'live',expectedRevision:2,
    confirmation:'ENABLE_AI_LIVE_SUPERVISED',
  }, 'test-admin'));
  assert.equal((await readAiExecutionMode(deviceId)).mode,'off');
  console.log('PASS 5/5: LIVE denied without explicit backend commissioning flags');

  console.log('RESULT: 5/5 PASS - ISOLATED AI MODE POSTGRESQL');
} finally {
  await pool.end();
}
