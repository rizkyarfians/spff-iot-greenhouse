import {
  decodeJsonMessage,
  isActuatorStateMessage,
  isCommandAckMessage,
  isDeviceStatusMessage,
  isTelemetryMessage,
  type CommandAckMessage,
  type PumpCommandMessage,
} from '@spff/contracts';
import { config } from './config.js';
import { MqttBridge } from './mqttBridge.js';
import { DurableOutbox, type OutboxRecord } from './outbox.js';
import { SerialGateway } from './serialGateway.js';

const mqttBridge = new MqttBridge(config);
const outbox = new DurableOutbox(config.outbox.directory, config.outbox.maxItems);
let flushTimer: NodeJS.Timeout | null = null;

const belongsToConfiguredDevice = (message: { siteId: string; deviceId: string }) =>
  message.siteId === config.siteId && message.deviceId === config.deviceId;

let shuttingDown = false;

const publishOutboxRecord = async (record: OutboxRecord) => {
  if (record.kind === 'telemetry') return mqttBridge.publishTelemetry(record.payload);
  if (record.kind === 'state') return mqttBridge.publishState(record.payload);
  if (record.kind === 'ack') return mqttBridge.publishAcknowledgement(record.payload);
  return mqttBridge.publishStatus(record.payload);
};

const flushOutbox = async () => {
  if (!mqttBridge.isConnected) return;
  try {
    await outbox.flush(publishOutboxRecord);
  } catch (error) {
    console.warn('[edge-outbox] flush paused', error instanceof Error ? error.message : error);
  }
};

const queue = async (record: OutboxRecord) => {
  await outbox.enqueue(record);
  await flushOutbox();
};

const serialGateway = new SerialGateway(
  config.serial,
  async (line) => {
    const message = decodeJsonMessage(line);
    if (isTelemetryMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'telemetry', payload: message });
      return;
    }
    if (isActuatorStateMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'state', payload: message });
      return;
    }
    if (isCommandAckMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'ack', payload: message });
      return;
    }
    if (isDeviceStatusMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'status', payload: message });
      return;
    }
    throw new Error('Unsupported serial payload.');
  },
  async (available) => {
    if (!shuttingDown) await mqttBridge.setDeviceAvailable(available);
  },
);


mqttBridge.onTelemetryPersisted(async (acknowledgement) => {
  const removed = await outbox.acknowledgeTelemetry(
    acknowledgement.messageId,
  );

  console.log('[edge] Telemetry persisted', {
    messageId: acknowledgement.messageId,
    sequence: acknowledgement.sequence,
    edgeOutboxRemoved: removed,
  });

  try {
    await serialGateway.send(acknowledgement);
  } catch (error) {
    console.warn(
      '[serial] Persistence ACK could not be forwarded to ESP32',
      error instanceof Error ? error.message : error,
    );
  }
});
mqttBridge.onConnected(flushOutbox);

mqttBridge.onCommand(async (command: PumpCommandMessage) => {
  const expiresAt = Date.parse(command.expiresAt);
  const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  if (expired) {
    const acknowledgement: CommandAckMessage = {
      kind: 'command_ack',
      schemaVersion: 1,
      siteId: command.siteId,
      deviceId: command.deviceId,
      commandId: command.commandId,
      acknowledgedAt: new Date().toISOString(),
      status: 'timed_out',
      targetId: command.targetId,
      reason: 'Command expiry is invalid or elapsed before reaching the controller.',
    };
    await queue({ kind: 'ack', payload: acknowledgement });
    return;
  }

  try {
    await serialGateway.send(command);

    console.log('[edge] Command forwarded to ESP32', {
      commandId: command.commandId,
      targetId: command.targetId,
      isActive: command.params.isActive,
    });
  } catch (error) {
    const acknowledgement: CommandAckMessage = {
      kind: 'command_ack',
      schemaVersion: 1,
      siteId: command.siteId,
      deviceId: command.deviceId,
      commandId: command.commandId,
      acknowledgedAt: new Date().toISOString(),
      status: 'rejected',
      targetId: command.targetId,
      reason: error instanceof Error ? error.message : 'Serial transport failed.',
    };
    await queue({ kind: 'ack', payload: acknowledgement });
  }
});

async function start() {
  await outbox.start();
  await mqttBridge.start();
  await serialGateway.start();
  flushTimer = setInterval(() => void flushOutbox(), config.outbox.flushIntervalMs);
  console.log(`[edge] Gateway ready for ${config.siteId}/${config.deviceId}.`);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (flushTimer) clearInterval(flushTimer);
  console.log(`[edge] Received ${signal}, shutting down.`);
  await serialGateway.stop();
  await flushOutbox();
  await mqttBridge.stop();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

void start().catch(async (error: unknown) => {
  console.error('[edge] Startup failed', error);
  shuttingDown = true;
  if (flushTimer) clearInterval(flushTimer);
  await Promise.allSettled([serialGateway.stop(), mqttBridge.stop()]);
  process.exitCode = 1;
});
