import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

test('notification timing persists recovery/failure across packets, ignores duplicates/replay and never scans history',
  { skip: !process.env.SPFF_TEST_PGLITE_MODULE }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE spff_app; CREATE SCHEMA spff;
        CREATE TABLE spff.telemetry_samples (
          site_id text, device_id text, message_id text UNIQUE,
          recorded_at timestamptz, received_at timestamptz, sensor_health jsonb,
          air_temp double precision, tank_water_level_pct double precision);`);
      const sql = readFileSync(new URL('../../infrastructure/postgres/migrations/028_sensor_notification_timing.sql', import.meta.url), 'utf8');
      await db.exec(sql);
      const insert = async (id, recordedAt, receivedAt, valid, value = null, reason = 'stale_or_missing') => {
        await db.query(`INSERT INTO spff.telemetry_samples VALUES
          ('s','d',$1,$2,$3,$4,$5,NULL) ON CONFLICT(message_id) DO NOTHING`,
          [id, recordedAt, receivedAt, JSON.stringify({ air_temp: { valid, reason } }), value]);
      };
      const state = async () => (await db.query("SELECT sensor_state FROM spff.sensor_notification_timing WHERE site_id='s' AND device_id='d'")).rows[0].sensor_state.air_temp;
      const iso = value => value ? new Date(value).toISOString() : null;
      await insert('valid-zero', '2026-10-25T15:00:00Z', '2026-10-25T15:00:01Z', true, 0);
      assert.equal(iso((await state()).lastValidAt), '2026-10-25T15:00:00.000Z');
      assert.equal((await state()).invalidSince, null);
      await insert('failure', '2026-10-25T15:00:30Z', '2026-10-25T15:00:31Z', false);
      await insert('repeat', '2026-10-25T15:01:00Z', '2026-10-25T15:01:01Z', false);
      assert.equal(iso((await state()).invalidSince), '2026-10-25T15:00:31.000Z');
      assert.equal(iso((await state()).lastValidAt), '2026-10-25T15:00:00.000Z');
      await insert('failure', '2026-10-25T15:01:30Z', '2026-10-25T15:01:31Z', true, 20);
      await insert('replay', '2026-10-25T14:59:00Z', '2026-10-25T15:02:01Z', true, 20);
      await insert('future', '2085-01-01T00:00:00Z', '2026-10-25T15:02:01Z', true, 20);
      assert.equal(iso((await state()).lastValidAt), '2026-10-25T15:00:00.000Z');
      await insert('healthy-without-value', '2026-10-25T15:02:30Z', '2026-10-25T15:02:31Z', true);
      assert.equal(iso((await state()).lastValidAt), '2026-10-25T15:00:00.000Z');
      await insert('recovery', '2026-10-25T15:03:00Z', '2026-10-25T15:03:01Z', true, 25);
      assert.equal((await state()).invalidSince, null);
      await insert('new-failure', '2026-10-25T15:04:00Z', '2026-10-25T15:04:01Z', false);
      assert.equal(iso((await state()).lastValidAt), '2026-10-25T15:03:00.000Z');
      assert.equal(iso((await state()).invalidSince), '2026-10-25T15:04:01.000Z');
      assert.equal((await db.query("SELECT has_table_privilege('spff_app','spff.sensor_notification_timing','SELECT') AS allowed")).rows[0].allowed, true);
      await db.exec('GRANT USAGE ON SCHEMA spff TO spff_app; GRANT INSERT, SELECT ON spff.telemetry_samples TO spff_app');
      await db.exec('SET ROLE spff_app');
      await insert('role-test', '2026-10-25T15:05:00Z', '2026-10-25T15:05:01Z', false);
      assert.equal(Number((await db.query('SELECT count(*) AS count FROM spff.sensor_notification_timing')).rows[0].count), 1);
    } finally { await db.close(); }
  });
