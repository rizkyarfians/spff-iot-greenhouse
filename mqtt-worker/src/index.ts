import { CommandDispatchService } from "./commandDispatchService.js";
import { IngestionService } from "./ingestionService.js";
import { MqttWorker } from "./mqttWorker.js";
import { PostgresIngestionRepository } from "./repository.js";
import { ScheduleEvaluator } from "./scheduleEvaluator.js";

const repository = new PostgresIngestionRepository();
const ingestionService = new IngestionService(repository);
const worker = new MqttWorker(ingestionService);
const commandDispatcher = new CommandDispatchService(repository, worker);
const scheduleEvaluator = new ScheduleEvaluator(repository);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[mqtt-worker] Received ${signal}, shutting down.`);
  scheduleEvaluator.stop();
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
    scheduleEvaluator.start();
    commandDispatcher.start();
  })
  .catch(async (error: unknown) => {
    console.error("[mqtt-worker] Startup failed", error);
    await shutdown("startup-error");
    process.exitCode = 1;
  });
