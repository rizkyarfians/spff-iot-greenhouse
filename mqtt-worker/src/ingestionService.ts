import {
  decodeJsonMessage,
  isActuatorStateMessage,
  isCommandAckMessage,
  isDeviceStatusMessage,
  isScheduleSyncAckMessage,
  isTelemetryMessage,
  isTelemetryPersistedAckMessage,
  parseMqttTopic,
  type TelemetryPersistedAckMessage,
} from '@spff/contracts';
import type { IngestionRepository } from './repository.js';
import type { AlarmIngestionObserver } from './alarmEvaluator.js';

export class IngestionService {
  constructor(
    private readonly repository: IngestionRepository,
    private readonly alarmObserver?: AlarmIngestionObserver,
  ) {}

  async process(
    topic: string,
    payload: Uint8Array,
  ): Promise<TelemetryPersistedAckMessage | null> {
    const topicParts = parseMqttTopic(topic);
    if (!topicParts) throw new Error(`Unsupported MQTT topic: ${topic}`);

    const message = decodeJsonMessage(payload);
    const matchesTopic = (value: { siteId: string; deviceId: string }) =>
      value.siteId === topicParts.siteId &&
      value.deviceId === topicParts.deviceId;

    if (
      topicParts.channel === 'telemetry' &&
      isTelemetryMessage(message) &&
      matchesTopic(message)
    ) {
      await this.repository.saveTelemetry(message);
      await this.observeAlarm(
        'telemetry',
        () => this.alarmObserver?.evaluateTelemetry(message),
      );

      return {
        kind: 'telemetry_persisted_ack',
        schemaVersion: 1,
        siteId: message.siteId,
        deviceId: message.deviceId,
        messageId: message.messageId,
        sequence: message.sequence,
        persistedAt: new Date().toISOString(),
      };
    }

    if (
      topicParts.channel === 'state' &&
      isActuatorStateMessage(message) &&
      matchesTopic(message)
    ) {
      await this.repository.saveActuatorState(message);
      await this.observeAlarm(
        'actuator_state',
        () => this.alarmObserver?.evaluateActuatorState(message),
      );
      return null;
    }

    if (
      topicParts.channel === 'ack' &&
      isCommandAckMessage(message) &&
      matchesTopic(message)
    ) {
      await this.repository.saveAcknowledgement(message);
      await this.observeAlarm(
        'command_ack',
        () => this.alarmObserver?.evaluateAcknowledgement(message),
      );
      return null;
    }

    if (
      topicParts.channel === 'ack' &&
      isScheduleSyncAckMessage(message) &&
      matchesTopic(message)
    ) {
      await this.repository.saveScheduleSyncAck(message);
      return null;
    }

    // Worker may receive its own persistence ACK because both directions
    // share the /ack MQTT topic. It has already served its purpose.
    if (
      topicParts.channel === 'ack' &&
      isTelemetryPersistedAckMessage(message) &&
      matchesTopic(message)
    ) {
      return null;
    }

    if (
      topicParts.channel === 'status' &&
      isDeviceStatusMessage(message) &&
      matchesTopic(message)
    ) {
      await this.repository.saveDeviceStatus(message);
      await this.observeAlarm(
        'device_status',
        () => this.alarmObserver?.evaluateDeviceStatus(message),
      );
      return null;
    }

    throw new Error(`Payload does not match channel ${topicParts.channel}.`);
  }

  private async observeAlarm(
    source: string,
    operation: () => Promise<void> | undefined,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      console.error('[alarm-evaluator] Ingestion observation failed', {
        source,
        error,
      });
    }
  }
}
