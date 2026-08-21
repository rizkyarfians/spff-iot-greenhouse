import assert from "node:assert/strict";
import test from "node:test";
import {
  ScheduleEvaluator,
} from "../src/scheduleEvaluator.js";
import type {
  ActuatorSchedule,
  ScheduleRepository,
  ScheduledCommandRequest,
} from "../src/repository.js";

const baseSchedule: ActuatorSchedule = {
  scheduleId: "schedule-water-01",
  siteId: "greenhouse-01",
  deviceId: "esp32-s3-01",
  actuatorKey: "pump_water",
  enabled: true,
  repeatRule: "daily",
  onTime: "21:05:00",
  offTime: "21:10:00",
  durationSeconds: null,
  onceDate: null,
  timezone: "Asia/Jakarta",
};

const repositoryFor = (
  schedules: ActuatorSchedule[],
  created: ScheduledCommandRequest[],
): ScheduleRepository => ({
  async enabledSchedules() {
    return schedules;
  },
  async createScheduledCommand(request) {
    created.push(request);
    return true;
  },
});

test("daily schedule creates ON command using Asia/Jakarta wall clock", async () => {
  const created: ScheduledCommandRequest[] = [];
  const service = new ScheduleEvaluator(
    repositoryFor([baseSchedule], created),
    {
      pollIntervalMs: 1_000,
      lookbackSeconds: 120,
      commandExpirySeconds: 30,
    },
    () => "schedule-command-001",
  );

  // 21:05:30 Asia/Jakarta == 14:05:30 UTC.
  await service.runOnce(new Date("2026-08-17T14:05:30.000Z"));

  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    commandId: "schedule-command-001",
    scheduleId: "schedule-water-01",
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    actuatorKey: "pump_water",
    action: "on",
    requestedIsActive: true,
    scheduledFor: "2026-08-17T14:05:00.000Z",
    issuedAt: "2026-08-17T14:05:30.000Z",
    expiresAt: "2026-08-17T14:06:00.000Z",
    repeatRule: "daily",
    timezone: "Asia/Jakarta",
  });
});

test("catch-up chooses latest OFF occurrence instead of briefly replaying ON", async () => {
  const created: ScheduledCommandRequest[] = [];
  const service = new ScheduleEvaluator(
    repositoryFor(
      [
        {
          ...baseSchedule,
          onTime: "21:10:00",
          offTime: "21:12:00",
        },
      ],
      created,
    ),
    {
      pollIntervalMs: 1_000,
      lookbackSeconds: 300,
      commandExpirySeconds: 30,
    },
    () => "schedule-command-002",
  );

  await service.runOnce(new Date("2026-08-17T14:12:30.000Z"));

  assert.equal(created.length, 1);
  assert.equal(created[0]?.action, "off");
  assert.equal(created[0]?.requestedIsActive, false);
  assert.equal(created[0]?.scheduledFor, "2026-08-17T14:12:00.000Z");
});

test("weekday schedule does not run on weekend", async () => {
  const created: ScheduledCommandRequest[] = [];
  const service = new ScheduleEvaluator(
    repositoryFor(
      [{ ...baseSchedule, repeatRule: "weekdays" }],
      created,
    ),
    {
      pollIntervalMs: 1_000,
      lookbackSeconds: 120,
      commandExpirySeconds: 30,
    },
  );

  // 2026-08-16 is Sunday in Asia/Jakarta.
  await service.runOnce(new Date("2026-08-16T14:05:30.000Z"));
  assert.equal(created.length, 0);
});

test("one-time schedule runs only on configured local date", async () => {
  const created: ScheduledCommandRequest[] = [];
  const service = new ScheduleEvaluator(
    repositoryFor(
      [
        {
          ...baseSchedule,
          repeatRule: "once",
          onceDate: "2026-08-17",
        },
      ],
      created,
    ),
    {
      pollIntervalMs: 1_000,
      lookbackSeconds: 120,
      commandExpirySeconds: 30,
    },
    () => "schedule-command-once",
  );

  await service.runOnce(new Date("2026-08-17T14:05:20.000Z"));
  assert.equal(created.length, 1);

  created.length = 0;
  await service.runOnce(new Date("2026-08-18T14:05:20.000Z"));
  assert.equal(created.length, 0);
});
