import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresIngestionRepository,
  type DatabasePool,
  type ScheduledCommandRequest,
} from "../src/repository.js";

type CapturedQuery = { text: string; values: unknown[] };

test("createScheduledCommand atomically records command and idempotency run", async () => {
  const queries: CapturedQuery[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (/INSERT INTO spff\.actuator_schedule_runs/.test(text)) {
        return { rowCount: 1, rows: [{ schedule_run_id: 1 }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
    async connect() {
      return client;
    },
    async end() {},
  } as unknown as DatabasePool;

  const request: ScheduledCommandRequest = {
    commandId: "scheduled-command-001",
    scheduleId: "schedule-001",
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    actuatorKey: "pump_water",
    action: "on",
    requestedIsActive: true,
    scheduledFor: "2026-08-17T14:05:00.000Z",
    issuedAt: "2026-08-17T14:05:05.000Z",
    expiresAt: "2026-08-17T14:05:35.000Z",
    repeatRule: "daily",
    timezone: "Asia/Jakarta",
  };

  const repository = new PostgresIngestionRepository(pool);
  const created = await repository.createScheduledCommand(request);

  assert.equal(created, true);
  assert.match(queries[0]?.text ?? "", /BEGIN/);
  assert.match(
    queries[1]?.text ?? "",
    /INSERT INTO spff\.control_commands/,
  );
  assert.equal(queries[1]?.values[5], "schedule:schedule-001:on");
  assert.match(
    queries[2]?.text ?? "",
    /ON CONFLICT \(schedule_id, scheduled_for, action\) DO NOTHING/,
  );
  assert.match(queries[3]?.text ?? "", /COMMIT/);
});

test("duplicate schedule occurrence rolls back newly generated command", async () => {
  const queries: CapturedQuery[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (/INSERT INTO spff\.actuator_schedule_runs/.test(text)) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
    async connect() {
      return client;
    },
    async end() {},
  } as unknown as DatabasePool;

  const repository = new PostgresIngestionRepository(pool);
  const created = await repository.createScheduledCommand({
    commandId: "scheduled-command-duplicate",
    scheduleId: "schedule-001",
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    actuatorKey: "pump_water",
    action: "on",
    requestedIsActive: true,
    scheduledFor: "2026-08-17T14:05:00.000Z",
    issuedAt: "2026-08-17T14:05:06.000Z",
    expiresAt: "2026-08-17T14:05:36.000Z",
    repeatRule: "daily",
    timezone: "Asia/Jakarta",
  });

  assert.equal(created, false);
  assert.match(queries.at(-1)?.text ?? "", /ROLLBACK/);
});
