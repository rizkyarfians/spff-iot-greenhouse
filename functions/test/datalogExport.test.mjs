import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseDatalogExportFilter, readDatalogExport } from '../lib/services/datalogExport.js';
import { getDatalogExport } from '../lib/controllers/datalogExportController.js';
import { pool } from '../lib/services/postgresRepository.js';

const input = { kind: 'sensor', parameter: 'all', from: '2026-10-10T17:00:00Z', to: '2026-10-14T16:59:59.999Z' };
const filter = parseDatalogExportFilter(input);
const definitions = [
  { sensor_key: 'air_temp', display_name: 'Suhu Udara', unit: '°C' },
  { sensor_key: 'soil_1_moisture', display_name: 'Tanah 1', unit: '%' },
];
const sample = {
  telemetry_id: '9007199254740993', recorded_at: new Date('2026-10-14T12:00:00Z'),
  air_temp: 0, soil_1_moisture: 22.5,
  sensor_health: { air_temp: { valid: false, reason: 'fault' }, soil_1_moisture: { valid: true } },
};

function fakePool(batches = [[sample]], catalog = definitions, failFetch = false) {
  const calls = [];
  const released = [];
  const client = Object.assign(new EventEmitter(), {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM spff.sensor_definitions')) return { rows: catalog };
      if (sql.startsWith('FETCH')) {
        if (failFetch) throw new Error('query failure');
        return { rows: batches.shift() ?? [] };
      }
      return { rows: [] };
    },
    release(destroy) { released.push(destroy); },
  });
  return { connect: async () => client, client, calls, released };
}

test('export accepts exact date/time endpoints and rejects invalid/unbounded filters', () => {
  assert.equal(filter.from.toISOString(), '2026-10-10T17:00:00.000Z');
  assert.equal(filter.to.toISOString(), '2026-10-14T16:59:59.999Z');
  for (const patch of [
    { kind: 'other' }, { from: '' }, { to: 'bad' }, { parameter: 'air_temp; DROP TABLE x' },
    { parameter: 'not_a_sensor' }, { from: ['2026-10-10'] },
    { to: '2026-10-09T00:00:00Z' }, { to: '2026-12-01T00:00:00Z' },
  ]) assert.equal(parseDatalogExportFilter({ ...input, ...patch }), null);
});

test('one snapshot/cursor exports every batch without COUNT, OFFSET, or full-row JSON', async () => {
  const db = fakePool([[sample], [{ ...sample, telemetry_id: '2', air_temp: null }]]);
  const chunks = [];
  for await (const chunk of readDatalogExport(db, 'greenhouse-01', filter, new AbortController().signal)) chunks.push(chunk);
  assert.equal(chunks.flat().length, 3);
  assert.equal(chunks[0][0].id, '9007199254740993:air_temp');
  assert.equal(chunks[0][0].value, 0);
  assert.equal(chunks[0][0].sensorValid, false);
  assert.equal(chunks[0][0].reason, 'fault');
  assert.equal(chunks[0][1].sensorValid, true);
  const sql = db.calls.map((call) => call.sql).join('\n');
  assert.match(sql, /REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(sql, /count\(|OFFSET|to_jsonb|raw_payload/i);
  assert.equal(db.calls.filter((call) => call.sql.startsWith('DECLARE')).length, 1);
  const declaration = db.calls.find((call) => call.sql.startsWith('DECLARE'));
  assert.deepEqual(declaration.values, ['greenhouse-01', filter.from.toISOString(), filter.to.toISOString()]);
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
  assert.deepEqual(db.released, [undefined]);
});

test('untrusted catalog keys cannot become SQL identifiers', async () => {
  const db = fakePool([[sample]], [definitions[0], { sensor_key: 'bad";select 1;--' }]);
  for await (const chunk of readDatalogExport(db, 'site', filter, new AbortController().signal)) {
    assert.equal(chunk.length, 1);
  }
  assert.doesNotMatch(db.calls.map((call) => call.sql).join('\n'), /bad"/);
});

test('actuator export applies the same site/time/parameter filters', async () => {
  const db = fakePool([[{ actuator_state_id: '42', recorded_at: sample.recorded_at,
    actuator_key: 'pump_water', display_name: 'Pompa Air', state: 'active', source: 'telemetry', reason: null }]]);
  const chunks = [];
  for await (const chunk of readDatalogExport(db, 'site', { ...filter, kind: 'actuator', parameter: 'pump_water' }, new AbortController().signal)) chunks.push(chunk);
  assert.equal(chunks[0][0].state, 'active');
  assert.equal(chunks[0][0].kind, 'actuator');
  assert.equal(db.calls.find((call) => call.sql.startsWith('DECLARE')).values.at(-1), 'pump_water');
});

test('empty catalog finishes cleanly without querying telemetry', async () => {
  const db = fakePool([], []);
  for await (const _chunk of readDatalogExport(db, 'site', filter, new AbortController().signal)) assert.fail('unexpected batch');
  assert.equal(db.calls.some((call) => call.sql.startsWith('DECLARE')), false);
  assert.deepEqual(db.released, [undefined]);
});

test('cancellation discards the connection and does not fetch another batch', async () => {
  const db = fakePool();
  const controller = new AbortController();
  const iterator = readDatalogExport(db, 'site', filter, controller.signal);
  await iterator.next();
  controller.abort();
  await assert.rejects(iterator.next(), { name: 'AbortError' });
  assert.deepEqual(db.released, [true]);
  assert.equal(db.calls.filter((call) => call.sql.startsWith('FETCH')).length, 1);
});

test('cancel while waiting for the pool releases any connection acquired later', async () => {
  const db = fakePool();
  let acquire;
  const waitingPool = { connect: () => new Promise((resolve) => { acquire = resolve; }) };
  const controller = new AbortController();
  const iterator = readDatalogExport(waitingPool, 'site', filter, controller.signal);
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  acquire(db.client);
  await Promise.resolve();
  assert.deepEqual(db.released, [true]);
  assert.equal(db.calls.length, 0);
});

test('consumer stopping early rolls back and releases the snapshot', async () => {
  const db = fakePool();
  for await (const _chunk of readDatalogExport(db, 'site', filter, new AbortController().signal)) break;
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(db.released, [undefined]);
});

test('idle database connection errors are handled instead of crashing the API', async () => {
  const db = fakePool();
  const iterator = readDatalogExport(db, 'site', filter, new AbortController().signal);
  await iterator.next();
  db.client.emit('error', new Error('idle transaction timeout'));
  await assert.rejects(iterator.next(), /idle transaction timeout/);
  assert.deepEqual(db.released, [true]);
});

test('failed FETCH rolls back and never commits', async () => {
  const db = fakePool([], definitions, true);
  await assert.rejects(async () => {
    for await (const _chunk of readDatalogExport(db, 'site', filter, new AbortController().signal)) { /* drain */ }
  }, /query failure/);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.calls.some((call) => call.sql === 'COMMIT'), false);
  assert.deepEqual(db.released, [undefined]);
});

function fakeResponse() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200, headers: {}, output: '', destroyed: false, writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    set(key, value) { Object.assign(this.headers, typeof key === 'object' ? key : { [key]: value }); return this; },
    json(data) { this.output = JSON.stringify(data); return this; },
    flushHeaders() {},
    write(data) { this.output += data; return true; },
    end(data = '') { this.output += data; this.writableEnded = true; return this; },
  });
}

test('HTTP export frames include completion only after all rows', async (t) => {
  const db = fakePool();
  t.mock.method(pool, 'connect', db.connect);
  const res = fakeResponse();
  await getDatalogExport({ query: input }, res);
  const events = res.output.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type), ['start', 'batch', 'complete']);
  assert.equal(events.at(-1).rowCount, 2);
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
  assert.equal(res.headers['Content-Type'], 'application/x-ndjson; charset=utf-8');
});

test('HTTP failure sends error, never a misleading complete frame', async (t) => {
  t.mock.method(pool, 'connect', fakePool([], definitions, true).connect);
  t.mock.method(console, 'error', () => {});
  const res = fakeResponse();
  await getDatalogExport({ query: input }, res);
  const events = res.output.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type), ['start', 'error']);
});

test('invalid HTTP filter is rejected before opening a connection', async (t) => {
  t.mock.method(pool, 'connect', () => assert.fail('should not connect'));
  const res = fakeResponse();
  await getDatalogExport({ query: { ...input, to: 'bad' } }, res);
  assert.equal(res.statusCode, 400);
});

test('HTTP backpressure pauses fetching until the browser can receive more', async (t) => {
  const db = fakePool([[sample], [sample]]);
  t.mock.method(pool, 'connect', db.connect);
  const res = fakeResponse();
  let reachedBatch;
  const paused = new Promise((resolve) => { reachedBatch = resolve; });
  let pausedOnce = false;
  res.write = function (data) {
    this.output += data;
    if (!pausedOnce && JSON.parse(data).type === 'batch') {
      pausedOnce = true;
      reachedBatch();
      return false;
    }
    return true;
  };
  const pending = getDatalogExport({ query: input }, res);
  await paused;
  assert.equal(db.calls.filter((call) => call.sql.startsWith('FETCH')).length, 1);
  res.emit('drain');
  await pending;
  assert.equal(JSON.parse(res.output.trim().split('\n').at(-1)).rowCount, 4);
});

test('a third simultaneous export is rejected; disconnect releases its slot', async (t) => {
  t.mock.method(pool, 'connect', fakePool().connect);
  const blocked = [fakeResponse(), fakeResponse()];
  for (const res of blocked) res.write = () => false;
  const pending = blocked.map((res) => getDatalogExport({ query: input }, res));
  const rejected = fakeResponse();
  await getDatalogExport({ query: input }, rejected);
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.headers['Retry-After'], '10');
  for (const res of blocked) { res.destroyed = true; res.emit('close'); }
  await Promise.all(pending);
  const next = fakeResponse();
  await getDatalogExport({ query: input }, next);
  assert.equal(next.statusCode, 200);
  assert.equal(JSON.parse(next.output.trim().split('\n').at(-1)).type, 'complete');
});
