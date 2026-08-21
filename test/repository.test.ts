import assert from "node:assert/strict";
import test from "node:test";
import type { TelemetryMessage } from "@spff/contracts";
import {
  PostgresIngestionRepository,
  type DatabasePool,
} from "../src/repository.js";

type CapturedQuery = {
  text: string;
  values: unknown[];
};

const telemetryMessage = {
  schemaVersion: 1,
  siteId: "greenhouse-01",
  deviceId: "esp32-s3-01",
  messageId: "test-message-001",
  sequence: 42,
  recordedAt: "2026-08-17T11:30:00.000Z",
  sensorValid: true,
  sensors: {
    soil_1_moisture: 68.5,
    soil_1_n: 120,
    liquid_ph: 6.1,
    air_temp: 28.4,
    air_humidity: 72.5,
    tank_water_level_pct: 76,
    battery_voltage: 12.4,
  },
} as unknown as TelemetryMessage;

test("saveTelemetry maps contract payload and uses message idempotency", async () => {
  const captured: CapturedQuery[] = [];
  const fakePool = {
    async query(text: string, values: unknown[] = []) {
      captured.push({ text, values });
      return { rowCount: 1 };
    },
    async connect() {
      throw new Error("connect is not expected in telemetry test");
    },
    async end() {},
  } as unknown as DatabasePool;

  const repository = new PostgresIngestionRepository(fakePool);
  await repository.saveTelemetry(telemetryMessage);

  assert.equal(captured.length, 1);
  const [query] = captured;
  assert.match(query.text, /INSERT INTO spff\.telemetry_samples/);
  assert.match(
    query.text,
    /ON CONFLICT \(site_id, device_id, message_id\) DO NOTHING/,
  );

  assert.equal(query.values[0], 1);
  assert.equal(query.values[1], "greenhouse-01");
  assert.equal(query.values[2], "esp32-s3-01");
  assert.equal(query.values[3], "test-message-001");
  assert.equal(query.values[4], 42);
  assert.equal(query.values[5], "2026-08-17T11:30:00.000Z");
  assert.equal(query.values[6], 68.5);
  assert.equal(query.values[10], 120);
  assert.equal(query.values[20], 6.1);
  assert.equal(query.values[23], 28.4);
  assert.equal(query.values[24], 72.5);
  assert.equal(query.values[26], 76);
  assert.equal(query.values[33], 12.4);
  assert.equal(query.values[34], true);

  const rawPayload = JSON.parse(String(query.values[35])) as {
    messageId: string;
  };
  assert.equal(rawPayload.messageId, "test-message-001");
});
