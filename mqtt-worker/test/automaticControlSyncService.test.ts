import assert from "node:assert/strict";
import test from "node:test";
import type { AutomaticControlSyncMessage } from "@spff/contracts";
import {
  AutomaticControlSyncService,
  type AutomaticControlSyncPublisher,
} from "../src/automaticControlSyncService.js";
import type { AutomaticControlSyncRepository } from "../src/repository.js";

const snapshot: AutomaticControlSyncMessage = {
  kind: "automatic_control_sync",
  schemaVersion: 1,
  siteId: "greenhouse-01",
  deviceId: "esp32-s3-01",
  revision: 4,
  generatedAt: "2026-08-30T03:00:00.000Z",
  config: {
    desiredMode: "manual",
    water: {
      enabled: false,
      sensorKey: "soil_1_moisture",
      moistureLowPercent: null,
      moistureTargetPercent: null,
      maxRuntimeSeconds: null,
      cooldownSeconds: null,
      minTankLevelPercent: null,
      minFlowLpm: null,
      triggerSampleCount: 3,
      sensorStaleSeconds: 120,
    },
    fertilizer: {
      enabled: false,
      sensorKey: "liquid_ec_us_cm",
      ecLowUsCm: null,
      ecTargetUsCm: null,
      ecHighUsCm: null,
      dosePulseSeconds: null,
      mixingDelaySeconds: null,
      cooldownSeconds: null,
      maxDoseVolumeL: null,
      maxDailyVolumeL: null,
      minTankLevelPercent: null,
      minFlowLpm: null,
      triggerSampleCount: 3,
      sensorStaleSeconds: 120,
    },
  },
};

test("automatic control sync publishes and marks exact revision", async () => {
  const requested: boolean[] = [];
  const marked: Array<{ siteId: string; deviceId: string; revision: number }> = [];
  const published: AutomaticControlSyncMessage[] = [];
  const repository: AutomaticControlSyncRepository = {
    async automaticControlSnapshots(force) {
      requested.push(force);
      return [snapshot];
    },
    async markAutomaticControlPublished(siteId, deviceId, revision) {
      marked.push({ siteId, deviceId, revision });
    },
  };
  const publisher: AutomaticControlSyncPublisher = {
    async publishAutomaticControlSync(message) {
      published.push(message);
    },
  };
  const service = new AutomaticControlSyncService(repository, publisher, 1000);
  await service.runOnce(true);
  assert.deepEqual(requested, [true]);
  assert.deepEqual(published, [snapshot]);
  assert.deepEqual(marked, [{
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    revision: 4,
  }]);
});
