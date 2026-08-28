import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduleSyncMessage } from "@spff/contracts";
import {
  ScheduleSyncService,
  type ScheduleSyncPublisher,
} from "../src/scheduleSyncService.js";
import type { ScheduleSyncRepository } from "../src/repository.js";

const snapshot: ScheduleSyncMessage = {
  kind: "schedule_sync",
  schemaVersion: 1,
  siteId: "greenhouse-01",
  deviceId: "esp32-s3-01",
  revision: 4,
  generatedAt: "2026-08-28T15:20:00.000Z",
  executionAuthority: "server",
  schedules: [
    {
      scheduleId: "schedule-water-01",
      targetId: "pump_water",
      onTime: "07:00:00",
      offTime: "07:10:00",
      repeatRule: "daily",
      runDate: null,
      timezone: "Asia/Jakarta",
      enabled: true,
    },
  ],
};

test("schedule sync publishes retained snapshot and marks the exact revision", async () => {
  const requested: Array<{ authority: string; force: boolean }> = [];
  const marked: Array<{
    siteId: string;
    deviceId: string;
    revision: number;
    authority: string;
  }> = [];
  const published: ScheduleSyncMessage[] = [];

  const repository: ScheduleSyncRepository = {
    async scheduleSnapshots(authority, force) {
      requested.push({ authority, force });
      return [snapshot];
    },
    async markSchedulePublished(
      siteId,
      deviceId,
      revision,
      authority,
    ) {
      marked.push({
        siteId,
        deviceId,
        revision,
        authority,
      });
    },
  };

  const publisher: ScheduleSyncPublisher = {
    async publishScheduleSync(message) {
      published.push(message);
    },
  };

  const service = new ScheduleSyncService(
    repository,
    publisher,
    "server",
    1_000,
  );

  await service.runOnce(true);

  assert.deepEqual(requested, [
    {
      authority: "server",
      force: true,
    },
  ]);
  assert.deepEqual(published, [snapshot]);
  assert.deepEqual(marked, [
    {
      siteId: "greenhouse-01",
      deviceId: "esp32-s3-01",
      revision: 4,
      authority: "server",
    },
  ]);
});
