import { telemetrySensorKeys } from '@spff/contracts';
import type { ApiDatalogItem, DatalogKind, TelemetrySensorKey } from '@spff/contracts';
import type { Pool, PoolClient } from 'pg';

export interface DatalogExportFilter {
  kind: DatalogKind;
  parameter: string;
  from: Date;
  to: Date;
}

const sensorKeys = new Set<string>(telemetrySensorKeys);
const sampleBatchSize = 250;

export function parseDatalogExportFilter(query: Record<string, unknown>): DatalogExportFilter | null {
  const { kind = 'sensor', parameter = 'all', from, to } = query;
  if ((kind !== 'sensor' && kind !== 'actuator')
    || typeof parameter !== 'string'
    || !/^(all|[a-z0-9_]{1,64})$/.test(parameter)
    || (kind === 'sensor' && parameter !== 'all' && !sensorKeys.has(parameter))
    || typeof from !== 'string' || typeof to !== 'string') return null;
  const start = new Date(from);
  const end = new Date(to);
  const duration = end.getTime() - start.getTime();
  if (!Number.isFinite(duration) || duration < 0 || duration > 31 * 86_400_000) return null;
  return { kind, parameter, from: start, to: end };
}

interface SensorDefinition {
  sensor_key: TelemetrySensorKey;
  display_name: string;
  unit: string;
}

function connectForExport(pool: Pick<Pool, 'connect'>, signal: AbortSignal): Promise<PoolClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      settled = true;
      reject(signal.reason);
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    void pool.connect().then((client) => {
      signal.removeEventListener('abort', abort);
      // A cancelled request must not retain a connection acquired later.
      if (settled) { client.release(true); return; }
      settled = true;
      resolve(client);
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}

/**
 * One read-only snapshot/cursor, not a COUNT + OFFSET query for every batch.
 * Only projected numeric columns are read (never raw_payload/to_jsonb(sample)).
 * A batch is measured in telemetry samples, expanded into readings in Node.
 */
export async function* readDatalogExport(
  pool: Pick<Pool, 'connect'>,
  siteId: string,
  filter: DatalogExportFilter,
  signal: AbortSignal,
): AsyncGenerator<ApiDatalogItem[]> {
  signal.throwIfAborted();
  const client = await connectForExport(pool, signal);
  let released = false;
  let committed = false;
  let connectionError: Error | undefined;
  const discard = () => {
    if (!released) {
      released = true;
      // Cancels an in-flight FETCH and rolls back when the connection closes.
      client.release(true);
    }
  };
  const onClientError = (error: Error) => {
    connectionError = error;
    discard();
  };
  // Checked-out clients have no pool idle-error handler. In particular, a slow
  // consumer can hit idle_in_transaction_session_timeout while we're yielding.
  client.on('error', onClientError);
  signal.addEventListener('abort', discard, { once: true });

  try {
    signal.throwIfAborted();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    let definitions: SensorDefinition[] = [];
    const values = [siteId, filter.from.toISOString(), filter.to.toISOString()];

    if (filter.kind === 'sensor') {
      const catalog = await client.query<SensorDefinition>(
        `SELECT sensor_key, display_name, unit FROM spff.sensor_definitions
         WHERE enabled = true AND ($1::text = 'all' OR sensor_key = $1)
         ORDER BY sensor_key ASC`, [filter.parameter],
      );
      definitions = catalog.rows.filter((item) => sensorKeys.has(item.sensor_key));
      if (definitions.length === 0) {
        await client.query('COMMIT');
        committed = true;
        return;
      }
      // Identifiers come only from the shared allowlist, never directly from a request.
      const columns = definitions.map((item) => `sample."${item.sensor_key}"`);
      await client.query(
        `DECLARE datalog_export NO SCROLL CURSOR FOR
         SELECT sample.telemetry_id, sample.recorded_at, sample.sensor_health, ${columns.join(', ')}
         FROM spff.telemetry_samples sample
         WHERE sample.site_id = $1 AND sample.recorded_at >= $2::timestamptz
           AND sample.recorded_at <= $3::timestamptz
           AND (${columns.map((column) => `${column} IS NOT NULL`).join(' OR ')})
         ORDER BY sample.recorded_at DESC, sample.telemetry_id DESC`, values,
      );
    } else {
      await client.query(
        `DECLARE datalog_export NO SCROLL CURSOR FOR
         SELECT event.actuator_state_id, event.recorded_at, event.actuator_key,
           actuator.display_name, event.state, event.source, event.reason
         FROM spff.actuator_state_events event
         JOIN spff.actuators actuator ON actuator.site_id = event.site_id
           AND actuator.device_id = event.device_id AND actuator.actuator_key = event.actuator_key
         WHERE event.site_id = $1 AND event.recorded_at >= $2::timestamptz
           AND event.recorded_at <= $3::timestamptz
           AND ($4::text = 'all' OR event.actuator_key = $4)
         ORDER BY event.recorded_at DESC, event.actuator_state_id DESC`,
        [...values, filter.parameter],
      );
    }

    while (true) {
      signal.throwIfAborted();
      if (connectionError) throw connectionError;
      const result = await client.query(`FETCH FORWARD ${sampleBatchSize} FROM datalog_export`);
      signal.throwIfAborted();
      if (result.rows.length === 0) break;
      const items: ApiDatalogItem[] = [];
      for (const row of result.rows) {
        const recordedAt = new Date(row.recorded_at).toISOString();
        if (filter.kind === 'sensor') {
          for (const definition of definitions) {
            const value = row[definition.sensor_key];
            if (value === null || value === undefined) continue;
            const health = row.sensor_health?.[definition.sensor_key];
            items.push({
              id: `${row.telemetry_id}:${definition.sensor_key}`, kind: 'sensor', recordedAt,
              parameterKey: definition.sensor_key, displayName: definition.display_name,
              value: Number(value), unit: definition.unit,
              sensorValid: typeof health?.valid === 'boolean' ? health.valid : null,
              reason: health?.reason || null, state: null, source: null,
            });
          }
        } else {
          items.push({
            id: String(row.actuator_state_id), kind: 'actuator', recordedAt,
            parameterKey: row.actuator_key, displayName: row.display_name,
            state: row.state, source: row.source, reason: row.reason ?? null,
            value: null, unit: '', sensorValid: null,
          });
        }
      }
      yield items;
    }
    signal.throwIfAborted();
    await client.query('COMMIT');
    committed = true;
  } finally {
    signal.removeEventListener('abort', discard);
    if (!released) {
      if (!committed) {
        try { await client.query('ROLLBACK'); } catch { discard(); }
      }
      if (!released) client.release();
    }
    client.off('error', onClientError);
  }
}
