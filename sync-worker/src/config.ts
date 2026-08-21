import 'dotenv/config';

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} harus integer ${min}..${max}`);
  }
  return value;
}

export const config = {
  enabled: (process.env.FIREBASE_SYNC_ENABLED ?? 'false').toLowerCase() === 'true',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || undefined,
  postgres: {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: integer('PGPORT', 5432, 1, 65535),
    database: process.env.PGDATABASE ?? 'spff',
    user: process.env.PGUSER ?? 'spff_sync',
    password: process.env.PGPASSWORD,
    max: 4,
  },
  sync: {
    pollIntervalMs: integer('SYNC_POLL_INTERVAL_MS', 5000, 500, 60000),
    batchSize: integer('SYNC_BATCH_SIZE', 50, 1, 500),
    lockTimeoutSeconds: integer('SYNC_LOCK_TIMEOUT_SECONDS', 120, 10, 3600),
    maxAttempts: integer('SYNC_MAX_ATTEMPTS', 12, 1, 100),
    backoffBaseMs: integer('SYNC_BACKOFF_BASE_MS', 2000, 100, 60000),
    backoffMaxMs: integer('SYNC_BACKOFF_MAX_MS', 900000, 1000, 86400000),
    retentionDays: integer('SYNC_RETENTION_DAYS', 14, 1, 3650),
  },
} as const;
