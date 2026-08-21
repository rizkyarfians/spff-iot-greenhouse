import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { FirebaseSink } from './firebaseSink.js';
import { OutboxRepository } from './repository.js';

let stopping = false;

async function main() {
  if (!config.enabled) {
    console.log(JSON.stringify({ level: 'info', component: 'sync-worker', message: 'Firebase sync disabled; local-first path remains active.' }));
    return;
  }

  const repository = new OutboxRepository();
  const sink = new FirebaseSink();
  let nextPruneAt = 0;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: 'info', component: 'sync-worker', signal, message: 'Graceful shutdown requested.' }));
    await repository.close();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  while (!stopping) {
    try {
      if (Date.now() >= nextPruneAt) {
        await repository.pruneSynced();
        nextPruneAt = Date.now() + 60 * 60 * 1000;
      }
      const batch = await repository.claimBatch();
      if (batch.length === 0) {
        await sleep(config.sync.pollIntervalMs);
        continue;
      }
      for (const event of batch) {
        if (stopping) break;
        try {
          await sink.write(event);
          await repository.markSynced(event.outboxId);
        } catch (error) {
          await repository.markFailed(event, error);
          console.error(JSON.stringify({
            level: 'error',
            component: 'sync-worker',
            outboxId: event.outboxId,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        component: 'sync-worker',
        message: 'Outbox polling failed.',
        error: error instanceof Error ? error.message : String(error),
      }));
      await sleep(config.sync.pollIntervalMs);
    }
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ level: 'fatal', component: 'sync-worker', error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
