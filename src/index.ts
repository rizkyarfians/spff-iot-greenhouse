import { IngestionService } from "./ingestionService.js";
import { MqttWorker } from "./mqttWorker.js";
import { PostgresIngestionRepository } from "./repository.js";

const repository = new PostgresIngestionRepository();
const ingestionService = new IngestionService(repository);
const worker = new MqttWorker(ingestionService);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[mqtt-worker] Received ${signal}, shutting down.`);
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
  .catch(async (error: unknown) => {
    console.error("[mqtt-worker] Startup failed", error);
    await shutdown("startup-error");
    process.exitCode = 1;
  });
