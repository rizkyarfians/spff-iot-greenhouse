import { CommandDispatchService } from "./commandDispatchService.js";
import { IngestionService } from "./ingestionService.js";
import { MqttWorker } from "./mqttWorker.js";
import { PostgresIngestionRepository } from "./repository.js";
import { ScheduleEvaluator } from "./scheduleEvaluator.js";
import { ScheduleSyncService } from "./scheduleSyncService.js";
import { config } from "./config.js";

const repository = new PostgresIngestionRepository();
const ingestionService = new IngestionService(repository);
const worker = new MqttWorker(ingestionService);
const commandDispatcher = new CommandDispatchService(repository, worker);
const scheduleEvaluator = new ScheduleEvaluator(repository);
const scheduleSyncService = new ScheduleSyncService(
  repository,
  worker,
  config.schedule.executionMode,
  config.schedule.syncPollIntervalMs,
);
worker.onConnected(() => scheduleSyncService.runOnce(true));
let shuttingDown = false; 

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[mqtt-worker] Received ${signal}, shutting down.`);
  scheduleEvaluator.stop();
  scheduleSyncService.stop();
  commandDispatcher.stop();
  try {
    await worker.stop();
  } finally {
    await repository.close();
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT")
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("[mqtt-worker] Shutdown failed", error);
      process.exit(1);
    });
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM")
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("[mqtt-worker] Shutdown failed", error);
      process.exit(1);
    });
});

void repository
  .checkConnection()
  .then(() => worker.start())
  .then(() => {
    scheduleSyncService.start();
    if (config.schedule.executionMode === "server") {
      scheduleEvaluator.start();
    } else {
      console.log(
        "[schedule-evaluator] Disabled; ESP32 is the schedule execution authority.",
      );
    }
    commandDispatcher.start();
  })
  .catch(async (error: unknown) => {
    console.error("[mqtt-worker] Startup failed", error);
    await shutdown("startup-error");
    process.exitCode = 1;
  });
