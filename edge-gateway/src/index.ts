import {ControllerTimeSync} from './controllerTimeSync.js';
import {adaptiveEventPayloadSchema} from '@spff/contracts';
import {adaptiveEnvelope,AdaptiveDispatchGuard} from './adaptiveDispatch.js';
import path from 'node:path';
import { waterInterlockAckSchema } from '@spff/contracts';
import { isFertigationPulseAck } from '@spff/contracts';
import {
  decodeJsonMessage,
  isFertigationSessionEvent,
  isAutomaticControlAckMessage,
  isActuatorStateMessage,
  isCommandAckMessage,
  isDeviceStatusMessage,
  isScheduleSyncAckMessage,
  isTelemetryMessage,
  type CommandAckMessage,
  type AutomaticControlAckMessage,
  type AutomaticControlSyncMessage,
  type PumpCommandMessage,
  type ScheduleSyncAckMessage,
  type ScheduleSyncMessage,
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
  if(record.kind==='adaptive_event')return mqttBridge.publishAdaptiveEvent(record.payload);
  if(record.kind==='water_interlock_ack')return mqttBridge.publishWaterInterlockAck(record.payload);
  if (record.kind === 'pulse_ack') return mqttBridge.publishPulseAck(record.payload);
  if (record.kind === 'telemetry') return mqttBridge.publishTelemetry(record.payload);
  if (record.kind === 'session') return mqttBridge.publishSession(record.payload);
  if (record.kind === 'state') return mqttBridge.publishState(record.payload);
  if (record.kind === 'ack') return mqttBridge.publishAcknowledgement(record.payload);
  if (record.kind === 'schedule_ack') {
    return mqttBridge.publishScheduleAcknowledgement(record.payload);
  }
  if (record.kind === 'automatic_control_ack') {
    return mqttBridge.publishAutomaticControlAcknowledgement(record.payload);
  }
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
    if(controllerTimeSync.receive(message))return;
    const adaptive=adaptiveEventPayloadSchema.safeParse(message);
    if(adaptive.success&&belongsToConfiguredDevice(adaptive.data)){await queue({kind:'adaptive_event',payload:adaptiveEnvelope(adaptive.data)});return;}
    const waterAck=waterInterlockAckSchema.safeParse(message);
    if(waterAck.success&&belongsToConfiguredDevice(waterAck.data)){await queue({kind:'water_interlock_ack',payload:waterAck.data});return;}
    if (isFertigationPulseAck(message) && belongsToConfiguredDevice(message)) {
      await queue({kind:'pulse_ack',payload:message});return;
    }
    if (isFertigationSessionEvent(message) && belongsToConfiguredDevice(message)) {
      await queue({kind:'session',payload:message});
      return;
    }
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
    if (isScheduleSyncAckMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'schedule_ack', payload: message });
      return;
    }
    if (isAutomaticControlAckMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'automatic_control_ack', payload: message });
      return;
    }
    if (isDeviceStatusMessage(message) && belongsToConfiguredDevice(message)) {
      await queue({ kind: 'status', payload: message });
      return;
    }
    throw new Error('Unsupported serial payload.');
  },
  async (available) => {
    if(available&&!shuttingDown)controllerTimeSync.reconnected();
    if (!shuttingDown) await mqttBridge.setDeviceAvailable(available);
  },
);


const controllerTimeSync=new ControllerTimeSync({siteId:config.siteId,deviceId:config.deviceId,isAvailable:()=>!shuttingDown&&serialGateway.isAvailable,send:message=>serialGateway.send(message)});

mqttBridge.onSessionPersisted(async (acknowledgement) => {
  const removed = await outbox.acknowledgeSession(acknowledgement.messageId);
  console.log('[edge] Session persisted', {sessionId:acknowledgement.sessionId,messageId:acknowledgement.messageId,edgeOutboxRemoved:removed});
  try { await serialGateway.send(acknowledgement); }
  catch(error) { console.warn('[serial] Session persistence ACK forward failed',error); }
});

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
const adaptiveGuard=new AdaptiveDispatchGuard(path.join(config.outbox.directory,'adaptive-command-ledger'),message=>serialGateway.send(message),event=>queue({kind:'adaptive_event',payload:event}));
mqttBridge.onAdaptive(message=>adaptiveGuard.forward(message));
mqttBridge.onAdaptivePersisted(async message=>{await outbox.acknowledgeAdaptive(message.messageId);});
mqttBridge.onConnected(flushOutbox);
mqttBridge.onWaterInterlock(async message=>{await serialGateway.send(message);});
mqttBridge.onPulse(async message => {
  if (Date.parse(message.expiresAt) <= Date.now()) throw new Error('Expired pulse command');
  await serialGateway.send(message);
});

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

mqttBridge.onSchedule(async (message: ScheduleSyncMessage) => {
  try {
    await serialGateway.send(message);

    console.log('[edge] Schedule snapshot forwarded to ESP32', {
      revision: message.revision,
      authority: message.executionAuthority,
      schedules: message.schedules.length,
    });
  } catch (error) {
    const acknowledgement: ScheduleSyncAckMessage = {
      kind: 'schedule_sync_ack',
      schemaVersion: 1,
      siteId: message.siteId,
      deviceId: message.deviceId,
      revision: message.revision,
      acknowledgedAt: new Date().toISOString(),
      status: 'rejected',
      storedScheduleCount: 0,
      reason: error instanceof Error
        ? error.message
        : 'Serial transport failed.',
    };

    await queue({
      kind: 'schedule_ack',
      payload: acknowledgement,
    });
  }
});

mqttBridge.onAutomaticControl(async (message: AutomaticControlSyncMessage) => {
  try {
    await serialGateway.send(message);
    console.log('[edge] Automatic-control config forwarded to ESP32', {
      revision: message.revision,
      desiredMode: message.config.desiredMode,
      waterEnabled: message.config.water.enabled,
      fertilizerEnabled: message.config.fertilizer.enabled,
    });
  } catch (error) {
    const acknowledgement: AutomaticControlAckMessage = {
      kind: 'automatic_control_ack',
      schemaVersion: 1,
      siteId: message.siteId,
      deviceId: message.deviceId,
      revision: message.revision,
      acknowledgedAt: new Date().toISOString(),
      status: 'rejected',
      appliedMode: mqttBridge.lastDeviceMode,
      reason: error instanceof Error
        ? error.message
        : 'Serial transport failed.',
    };
    await queue({
      kind: 'automatic_control_ack',
      payload: acknowledgement,
    });
  }
});

async function start() {
  await outbox.start();
  await serialGateway.start();
  controllerTimeSync.start();
  await mqttBridge.start();
  flushTimer = setInterval(() => void flushOutbox(), config.outbox.flushIntervalMs);
  console.log(`[edge] Gateway ready for ${config.siteId}/${config.deviceId}.`);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (flushTimer) clearInterval(flushTimer);
  controllerTimeSync.stop();
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
  controllerTimeSync.stop();
  await Promise.allSettled([serialGateway.stop(), mqttBridge.stop()]);
  process.exitCode = 1;
});
