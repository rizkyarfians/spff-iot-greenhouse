import assert from "node:assert/strict";
import test from "node:test";
import type { CommandAckMessage, TelemetryMessage } from "@spff/contracts";
import {
  AlarmEvaluator,
  evaluateNumericAlarmRule,
  type AlarmObservation,
  type AlarmRepository,
  type AlarmRule,
} from "../src/alarmEvaluator.js";

const rules: AlarmRule[] = [
  {
    siteId: "greenhouse-01",
    ruleKey: "air_temperature_high",
    sourceType: "sensor",
    sourceKey: "air_temp",
    comparator: "gt",
    thresholdValue: 30,
    unit: "°C",
    enabled: true,
  },
  {
    siteId: "greenhouse-01",
    ruleKey: "command_failed",
    sourceType: "system",
    sourceKey: "control_command",
    comparator: "failed",
    thresholdValue: null,
    unit: null,
    enabled: true,
  },
  {
    siteId: "greenhouse-01",
    ruleKey: "telemetry_stopped",
    sourceType: "system",
    sourceKey: "telemetry",
    comparator: "stale",
    thresholdValue: 600,
    unit: "detik",
    enabled: true,
  },
];

const repository = (observations: AlarmObservation[]): AlarmRepository => ({
  async alarmRules() {
    return rules;
  },
  async applyAlarmObservation(value) {
    observations.push(value);
  },
  async alarmHealthSubjects() {
    return [];
  },
  async alarmCommandSubjects() {
    return [];
  },
});

test("numeric rules return violation only when a finite configured threshold exists", () => {
  assert.equal(evaluateNumericAlarmRule(rules[0], 31), true);
  assert.equal(evaluateNumericAlarmRule(rules[0], 30), false);
  assert.equal(evaluateNumericAlarmRule(rules[0], null), null);
});

test("telemetry evaluates configured sensor rule and recovers telemetry-stopped incident", async () => {
  const observations: AlarmObservation[] = [];
  const evaluator = new AlarmEvaluator(repository(observations));
  const message = {
    kind: "telemetry",
    schemaVersion: 1,
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    messageId: "telemetry-001",
    sequence: 1,
    recordedAt: "2026-08-30T12:00:00.000Z",
    sensors: { air_temp: 31 },
  } satisfies TelemetryMessage;

  await evaluator.evaluateTelemetry(message);

  assert.equal(observations.length, 2);
  assert.equal(observations[0].ruleKey, "air_temperature_high");
  assert.equal(observations[0].violating, true);
  assert.equal(observations[0].thresholdText, "> 30 °C");
  assert.equal(observations[1].ruleKey, "telemetry_stopped");
  assert.equal(observations[1].violating, false);
});

test("telemetry skips numeric alarm evaluation for the faulted parameter only", async () => {
  const observations: AlarmObservation[] = [];
  const evaluator = new AlarmEvaluator(repository(observations));
  const message = {
    kind: "telemetry",
    schemaVersion: 1,
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    messageId: "telemetry-fault-001",
    sequence: 2,
    recordedAt: "2026-09-03T11:27:16.000Z",
    sensorValid: false,
    sensorHealth: {
      air_temp: { valid: false, reason: "crc_error" },
    },
    sensors: { air_temp: 99 },
  } satisfies TelemetryMessage;

  await evaluator.evaluateTelemetry(message);

  assert.equal(observations.length, 1);
  assert.equal(observations[0].ruleKey, "telemetry_stopped");
  assert.equal(observations[0].violating, false);
});

test("rejected command opens incident and completed command supplies recovery", async () => {
  const observations: AlarmObservation[] = [];
  const evaluator = new AlarmEvaluator(repository(observations));
  const base = {
    kind: "command_ack",
    schemaVersion: 1,
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    commandId: "command-001",
    acknowledgedAt: "2026-08-30T12:00:00.000Z",
    targetId: "pump_water",
  } as const;

  await evaluator.evaluateAcknowledgement({
    ...base,
    status: "rejected",
    reason: "interlock",
  } satisfies CommandAckMessage);
  await evaluator.evaluateAcknowledgement({
    ...base,
    commandId: "command-002",
    status: "completed",
  } satisfies CommandAckMessage);

  assert.equal(observations.length, 2);
  assert.equal(observations[0].incidentKey, "command_failed:pump_water");
  assert.equal(observations[0].violating, true);
  assert.equal(observations[1].violating, false);
});

test("health cycle turns a database-expired command into an alarm observation", async () => {
  const observations: AlarmObservation[] = [];
  const baseRepository = repository(observations);
  const evaluator = new AlarmEvaluator({
    ...baseRepository,
    async alarmCommandSubjects() {
      return [{
        siteId: "greenhouse-01",
        deviceId: "esp32-s3-01",
        targetId: "pump_fert",
        commandId: "command-timeout-001",
        status: "timed_out",
        reason: "command_expired",
        updatedAt: "2026-08-30T12:05:00.000Z",
      }];
    },
  });

  await evaluator.runOnce();

  assert.equal(observations.length, 1);
  assert.equal(observations[0].incidentKey, "command_failed:pump_fert");
  assert.equal(observations[0].violating, true);
  assert.equal(observations[0].metadata.commandStatus, "timed_out");
});
