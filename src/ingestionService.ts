import {
  decodeJsonMessage,
  isCommandAckMessage,
  isDeviceStatusMessage,
  isTelemetryMessage,
  parseMqttTopic,
} from '@spff/contracts';
import type { IngestionRepository } from './repository.js';

export class IngestionService {
  constructor(private readonly repository: IngestionRepository) {}

  async process(topic: string, payload: Uint8Array) {
    const topicParts = parseMqttTopic(topic);
    if (!topicParts) throw new Error(`Unsupported MQTT topic: ${topic}`);

    const message = decodeJsonMessage(payload);
    const matchesTopic = (value: { siteId: string; deviceId: string }) =>
      value.siteId === topicParts.siteId && value.deviceId === topicParts.deviceId;

    if (topicParts.channel === 'telemetry' && isTelemetryMessage(message) && matchesTopic(message)) {
      await this.repository.saveTelemetry(message);
      return;
    }

    if (topicParts.channel === 'ack' && isCommandAckMessage(message) && matchesTopic(message)) {
      await this.repository.saveAcknowledgement(message);
      return;
    }

    if (topicParts.channel === 'status' && isDeviceStatusMessage(message) && matchesTopic(message)) {
      await this.repository.saveDeviceStatus(message);
      return;
    }

    throw new Error(`Payload does not match channel ${topicParts.channel}.`);
  }
}
