import type {
  Notification,
  PoolClient,
} from 'pg';

import {
  pool,
} from './postgresRepository.js';


const realtimeChannel =
  'spff_realtime';

const reconnectDelayMs =
  5_000;


export type RealtimeDatabaseEvent = {
  type:
    | 'telemetry.updated'
    | 'device_status.updated';
  siteId: string;
  deviceId: string;
  messageId: string | null;
  recordedAt: string;
  receivedAt: string;
};


type RealtimeListener = (
  event: RealtimeDatabaseEvent,
) => void;


const listeners =
  new Set<RealtimeListener>();

let listenerClient:
PoolClient | null = null;

let connectionAttempt:
Promise<void> | null = null;

let reconnectTimer:
NodeJS.Timeout | null = null;


const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value);


export function parseRealtimeEvent(
  payload: string | undefined,
): RealtimeDatabaseEvent | null {

  if (!payload) {
    return null;
  }

  let value:
  unknown;

  try {
    value =
      JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    !isRecord(value)
    || ![
      'telemetry.updated',
      'device_status.updated',
    ].includes(
      String(value.type),
    )
    || typeof value.siteId !== 'string'
    || typeof value.deviceId !== 'string'
    || (
      value.messageId !== null
      && typeof value.messageId !== 'string'
    )
    || typeof value.recordedAt !== 'string'
    || typeof value.receivedAt !== 'string'
    || !Number.isFinite(
      Date.parse(value.recordedAt),
    )
    || !Number.isFinite(
      Date.parse(value.receivedAt),
    )
  ) {
    return null;
  }

  return value as RealtimeDatabaseEvent;
}


function broadcast(
  notification: Notification,
) {

  if (
    notification.channel
    !== realtimeChannel
  ) {
    return;
  }

  const event =
    parseRealtimeEvent(
      notification.payload,
    );

  if (!event) {
    console.warn(
      '[realtime] Invalid PostgreSQL notification ignored.',
    );

    return;
  }

  for (
    const listener
    of listeners
  ) {
    try {
      listener(event);
    } catch (error) {
      console.error(
        '[realtime] Subscriber failed',
        error,
      );
    }
  }
}


function scheduleReconnect() {

  if (
    reconnectTimer
    || listeners.size === 0
  ) {
    return;
  }

  reconnectTimer =
    setTimeout(
      () => {
        reconnectTimer =
          null;

        void ensureRealtimeListener();
      },
      reconnectDelayMs,
    );

  reconnectTimer.unref();
}


function releaseListenerClient(
  client: PoolClient,
  error?: Error,
) {

  if (
    listenerClient
    !== client
  ) {
    return;
  }

  listenerClient =
    null;

  client.release(
    true,
  );

  if (error) {
    console.error(
      '[realtime] PostgreSQL listener disconnected',
      error.message,
    );
  } else {
    console.warn(
      '[realtime] PostgreSQL listener disconnected.',
    );
  }

  scheduleReconnect();
}


async function connectRealtimeListener() {

  const client =
    await pool.connect();

  listenerClient =
    client;

  client.on(
    'notification',
    broadcast,
  );

  client.once(
    'error',
    (
      error,
    ) =>
      releaseListenerClient(
        client,
        error,
      ),
  );

  client.once(
    'end',
    () =>
      releaseListenerClient(
        client,
      ),
  );

  try {
    await client.query(
      `LISTEN ${realtimeChannel}`,
    );

    console.log(
      `[realtime] Listening on PostgreSQL channel ${realtimeChannel}.`,
    );
  } catch (error) {
    releaseListenerClient(
      client,
      error instanceof Error
        ? error
        : new Error(
            'Unable to start PostgreSQL realtime listener.',
          ),
    );

    throw error;
  }
}


async function ensureRealtimeListener() {

  if (
    listenerClient
    || connectionAttempt
  ) {
    return;
  }

  connectionAttempt =
    connectRealtimeListener()
      .catch(
        (
          error,
        ) => {
          console.error(
            '[realtime] PostgreSQL LISTEN failed',
            error,
          );

          scheduleReconnect();
        },
      )
      .finally(
        () => {
          connectionAttempt =
            null;
        },
      );

  await connectionAttempt;
}


export function subscribeRealtimeEvents(
  listener: RealtimeListener,
) {

  listeners.add(
    listener,
  );

  void ensureRealtimeListener();

  return () => {
    listeners.delete(
      listener,
    );
  };
}
