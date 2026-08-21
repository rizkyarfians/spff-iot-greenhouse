import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export type OutboxEvent = {
  outboxId: string;
  siteId: string | null;
  aggregateType: string;
  aggregateId: string;
  operation: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  attemptCount: number;
};

type OutboxRow = {
  outbox_id: string;
  site_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  operation: OutboxEvent['operation'];
  payload: Record<string, unknown>;
  attempt_count: number;
};

export class OutboxRepository {
  private readonly pool = new Pool(config.postgres);
  readonly workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  async claimBatch(): Promise<OutboxEvent[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT outbox_id
           FROM spff.cloud_outbox
           WHERE (
             status = 'pending'
             OR (status = 'processing' AND locked_at < now() - ($2::text || ' seconds')::interval)
           )
             AND available_at <= now()
           ORDER BY outbox_id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE spff.cloud_outbox o
         SET status = 'processing',
             locked_at = now(),
             locked_by = $3
         FROM candidates c
         WHERE o.outbox_id = c.outbox_id
         RETURNING o.outbox_id, o.site_id, o.aggregate_type, o.aggregate_id,
                   o.operation, o.payload, o.attempt_count`,
        [config.sync.batchSize, config.sync.lockTimeoutSeconds, this.workerId],
      );
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        outboxId: String(row.outbox_id),
        siteId: row.site_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        operation: row.operation,
        payload: row.payload,
        attemptCount: row.attempt_count,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markSynced(outboxId: string) {
    await this.pool.query(
      `UPDATE spff.cloud_outbox
       SET status = 'synced', synced_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
       WHERE outbox_id = $1 AND locked_by = $2`,
      [outboxId, this.workerId],
    );
  }

  async markFailed(event: OutboxEvent, error: unknown) {
    const nextAttempt = event.attemptCount + 1;
    const deadLetter = nextAttempt >= config.sync.maxAttempts;
    const delayMs = Math.min(
      config.sync.backoffBaseMs * (2 ** Math.max(0, nextAttempt - 1)),
      config.sync.backoffMaxMs,
    );
    const nextAt = new Date(Date.now() + delayMs);
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `UPDATE spff.cloud_outbox
       SET status = $2,
           attempt_count = $3,
           available_at = $4,
           locked_at = NULL,
           locked_by = NULL,
           last_error = left($5, 4000)
       WHERE outbox_id = $1 AND locked_by = $6`,
      [outboxId(event), deadLetter ? 'dead_letter' : 'pending', nextAttempt, nextAt, message, this.workerId],
    );
  }

  async pruneSynced() {
    await this.pool.query(
      `DELETE FROM spff.cloud_outbox
       WHERE status = 'synced'
         AND synced_at < now() - ($1::text || ' days')::interval`,
      [config.sync.retentionDays],
    );
  }

  async close() {
    await this.pool.end();
  }
}

function outboxId(event: OutboxEvent) {
  return event.outboxId;
}
