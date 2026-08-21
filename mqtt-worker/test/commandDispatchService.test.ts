import assert from "node:assert/strict";
import test from "node:test";
import type { PumpCommandMessage } from "@spff/contracts";
import {
  CommandDispatchService,
  type CommandPublisher,
} from "../src/commandDispatchService.js";
import type {
  CommandDispatchRepository,
  PendingControlCommand,
} from "../src/repository.js";

const pending: PendingControlCommand = {
  commandId: "cmd-test-001",
  siteId: "greenhouse-01",
  deviceId: "esp32-s3-01",
  actuatorKey: "pump_water",
  requestedIsActive: true,
  requestedBy: "dashboard:test",
  issuedAt: "2026-08-17T13:00:00.000Z",
  expiresAt: "2026-08-17T13:00:30.000Z",
};

test("dispatcher publishes pending pump command then marks it published", async () => {
  const published: PumpCommandMessage[] = [];
  const marked: Array<{ commandId: string; publishedAt: string }> = [];
  let expiryRuns = 0;

  const repository: CommandDispatchRepository = {
    async expireCommands() {
      expiryRuns += 1;
      return 0;
    },
    async pendingCommands(limit) {
      assert.equal(limit, 20);
      return [pending];
    },
    async markCommandPublished(commandId, publishedAt) {
      marked.push({ commandId, publishedAt });
    },
  };

  const publisher: CommandPublisher = {
    async publishCommand(message) {
      published.push(message);
    },
  };

  const service = new CommandDispatchService(repository, publisher);
  await service.runOnce();

  assert.equal(expiryRuns, 1);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], {
    schemaVersion: 1,
    siteId: "greenhouse-01",
    deviceId: "esp32-s3-01",
    kind: "command",
    commandId: "cmd-test-001",
    issuedAt: "2026-08-17T13:00:00.000Z",
    expiresAt: "2026-08-17T13:00:30.000Z",
    requestedBy: "dashboard:test",
    type: "set_pump",
    targetId: "pump_water",
    params: { isActive: true },
  });
  assert.equal(marked.length, 1);
  assert.equal(marked[0]?.commandId, "cmd-test-001");
  assert.equal(Number.isNaN(Date.parse(marked[0]?.publishedAt ?? "")), false);
});

test("dispatcher leaves command pending when MQTT publish fails", async () => {
  let marked = false;
  const repository: CommandDispatchRepository = {
    async expireCommands() {
      return 0;
    },
    async pendingCommands() {
      return [pending];
    },
    async markCommandPublished() {
      marked = true;
    },
  };
  const publisher: CommandPublisher = {
    async publishCommand() {
      throw new Error("broker unavailable");
    },
  };

  const originalError = console.error;
  console.error = () => undefined;
  try {
    await new CommandDispatchService(repository, publisher).runOnce();
  } finally {
    console.error = originalError;
  }

  assert.equal(marked, false);
});
