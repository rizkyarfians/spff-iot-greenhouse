import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readDatalogExport, parseDatalogExportFilter } from '../lib/services/datalogExport.js';

const url = process.env.SPFF_EXPORT_TEST_DATABASE_URL;

test('real PostgreSQL export: parity, inclusive filters, and concurrent ingestion', { skip: !url }, async (t) => {
  // This test creates fixtures ONLY in an explicitly supplied, disposable database.
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/spff_export_test');
  assert.equal(target.username, 'spff_export_test');
  const db = new pg.Pool({ connectionString: url });
  t.after(() => db.end());
  await db.query(`
    CREATE SCHEMA spff;
    CREATE TABLE spff.sensor_definitions (sensor_key text PRIMARY KEY, display_name text, unit text, enabled boolean);
    CREATE TABLE spff.telemetry_samples (
      telemetry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      site_id text, recorded_at timestamptz, sensor_health jsonb,
      air_temp double precision, soil_1_moisture double precision, raw_payload jsonb
    );
    CREATE INDEX ON spff.telemetry_samples (site_id, recorded_at DESC);
    CREATE TABLE spff.actuators (site_id text, device_id text, actuator_key text, display_name text,
      PRIMARY KEY (site_id, device_id, actuator_key));
    CREATE TABLE spff.actuator_state_events (actuator_state_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      site_id text, device_id text, actuator_key text, recorded_at timestamptz, state text, source text, reason text);
    INSERT INTO spff.sensor_definitions VALUES ('air_temp', 'Suhu Udara', '°C', true), ('soil_1_moisture', 'Tanah 1', '%', true);
    INSERT INTO spff.telemetry_samples (site_id, recorded_at, air_temp, soil_1_moisture, sensor_health)
      SELECT 'site-a', '2026-10-14T00:00:00Z'::timestamptz + (n / 3) * interval '1 minute',
        CASE WHEN n = 1 THEN NULL ELSE n % 40 END, 22.5,
        '{"air_temp":{"valid":false,"reason":"fault"},"soil_1_moisture":{"valid":true}}'::jsonb
      FROM generate_series(0, 599) n;
    INSERT INTO spff.telemetry_samples (site_id, recorded_at, air_temp) VALUES
      ('other-site', '2026-10-14T00:00:00Z', 99),
      ('site-a', '2026-10-13T23:59:59.999999Z', 99),
      ('site-a', '2026-10-14T03:19:00.000001Z', 99);
    INSERT INTO spff.actuators VALUES ('site-a','esp','pump_water','Pompa Air'), ('site-a','esp','pump_fert','Pompa Pupuk');
    INSERT INTO spff.actuator_state_events (site_id,device_id,actuator_key,recorded_at,state,source)
      VALUES ('site-a','esp','pump_water','2026-10-14T00:00:00Z','active','telemetry'),
        ('site-a','esp','pump_fert','2026-10-14T00:00:00Z','inactive','telemetry'),
        ('site-a','esp','pump_water','2026-10-13T23:59:59Z','inactive','telemetry');
  `);
  const filter = parseDatalogExportFilter({ kind: 'sensor', parameter: 'all', from: '2026-10-14T00:00:00Z', to: '2026-10-14T03:19:00Z' });
  const collect = async (f = filter) => {
    const rows = [];
    for await (const batch of readDatalogExport(db, 'site-a', f, new AbortController().signal)) rows.push(...batch);
    return rows;
  };

  await t.test('all sensor rows match the old query including timestamp ties across batches', async () => {
    const expected = await db.query(`SELECT s.telemetry_id::text || ':' || d.sensor_key AS id,
      (to_jsonb(s)->>d.sensor_key)::double precision AS value
      FROM spff.telemetry_samples s CROSS JOIN spff.sensor_definitions d
      WHERE s.site_id = $1 AND s.recorded_at >= $2 AND s.recorded_at <= $3 AND d.enabled
        AND to_jsonb(s)->>d.sensor_key IS NOT NULL
      ORDER BY recorded_at DESC, telemetry_id DESC, sensor_key ASC`, ['site-a', filter.from, filter.to]);
    const rows = await collect();
    assert.equal(rows.length, 1199);
    assert.deepEqual(rows.map(({ id, value }) => ({ id, value })), expected.rows);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    assert.equal(rows.find((row) => row.parameterKey === 'air_temp').sensorValid, false);
  });

  await t.test('single sensor and pump filters export only selected parameters', async () => {
    const rows = await collect({ ...filter, parameter: 'air_temp' });
    assert.equal(rows.length, 599);
    assert.ok(rows.every((row) => row.parameterKey === 'air_temp'));
    const pumps = await collect({ ...filter, kind: 'actuator', parameter: 'pump_water' });
    assert.equal(pumps.length, 1);
    assert.equal(pumps[0].state, 'active');
    assert.equal((await collect({ ...filter, kind: 'actuator' })).length, 2);
    assert.equal((await collect({ ...filter, parameter: 'ac_power_w' })).length, 0);
  });

  await t.test('new/backfilled rows do not change an export already in progress', async () => {
    const iterator = readDatalogExport(db, 'site-a', filter, new AbortController().signal);
    const first = await iterator.next();
    assert.equal(first.value.length, 500);
    const inserted = await db.query(`INSERT INTO spff.telemetry_samples (site_id,recorded_at,air_temp)
      VALUES ('site-a','2026-10-14T02:00:00Z',123) RETURNING telemetry_id`);
    const rows = [...first.value];
    for await (const batch of iterator) rows.push(...batch);
    assert.equal(rows.length, 1199);
    assert.ok(!rows.some((row) => row.id.startsWith(`${inserted.rows[0].telemetry_id}:`)));
    assert.equal((await collect()).length, 1200);
  });

  await t.test('cancelling an export releases its snapshot/connection', async () => {
    const controller = new AbortController();
    const iterator = readDatalogExport(db, 'site-a', filter, controller.signal);
    await iterator.next();
    controller.abort();
    await assert.rejects(iterator.next(), { name: 'AbortError' });
    assert.equal((await db.query('SELECT 1 AS ok')).rows[0].ok, 1);
  });
});
