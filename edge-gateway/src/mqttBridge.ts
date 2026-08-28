import {
  decodeJsonMessage,
  isPumpCommandMessage,
  mqttTopics,
  type ActuatorStateMessage,
  type CommandAckMessage,
  type DeviceStatusMessage,
  type PumpCommandMessage,
  type TelemetryMessage,isTelemetryPersistedAckMessage,
type TelemetryPersistedAckMessage,
} from '@spff/contracts';
import { connect, type IClientOptions, type MqttClient } from 'mqtt';
import type { EdgeConfig } from './config.js';

export class MqttBridge {
  private client: MqttClient | null = null;
  private commandHandler: ((command: PumpCommandMessage) => Promise<void>) | null = null;
  private connectedHandler: (() => Promise<void>) | null = null;
  private deviceAvailable = false;
  private lastStatus: DeviceStatusMessage | null = null;
private telemetryPersistedHandler:
  ((message: TelemetryPersistedAckMessage) => Promise<void>) | null = null;
  constructor(private readonly config: EdgeConfig) {}

  get isConnected() {
    return this.client?.connected === true;
  }

  onCommand(handler: (command: PumpCommandMessage) => Promise<void>) {
    this.commandHandler = handler;
  }

  onConnected(handler: () => Promise<void>) {
    this.connectedHandler = handler;
  }

onTelemetryPersisted(
  handler: (message: TelemetryPersistedAckMessage) => Promise<void>,
) {
  this.telemetryPersistedHandler = handler;
}

  async start() {
    const offlineStatus = this.createStatus(false);
    const options: IClientOptions = {
      clientId: this.config.mqtt.clientId,
      username: this.config.mqtt.username,
      password: this.config.mqtt.password,
      clean: false,
      connectTimeout: this.config.mqtt.connectTimeoutMs,
      reconnectPeriod: this.config.mqtt.reconnectPeriodMs,
      keepalive: this.config.mqtt.keepaliveSeconds,
      rejectUnauthorized: this.config.mqtt.rejectUnauthorized,
      will: {
        topic: mqttTopics.status(this.config.siteId, this.config.deviceId),
        payload: JSON.stringify(offlineStatus),
        qos: 1,
        retain: true,
      },
    };

    this.client = connect(this.config.mqtt.url, options);
    this.client.on('error', (error) => console.error('[mqtt] Connection error', error.message));
    this.client.on('reconnect', () => console.warn('[mqtt] Reconnecting...'));
    this.client.on('message', (topic, payload) => void this.handleMessage(topic, payload));
    this.client.on('connect', () => {
      void this.restoreSession().then(async () => {
        if (this.connectedHandler) await this.connectedHandler();
      }).catch((error: unknown) => console.error('[mqtt] Session restore failed', error));
    });
  }

  async setDeviceAvailable(available: boolean) {
    this.deviceAvailable = available;
    if (this.client?.connected) await this.publishStatus(this.createStatus(available));
  }

  publishTelemetry(message: TelemetryMessage) {
    return this.publish(mqttTopics.telemetry(this.config.siteId, this.config.deviceId), message);
  }

  publishState(message: ActuatorStateMessage) {
    return this.publish(mqttTopics.state(this.config.siteId, this.config.deviceId), message, true);
  }

  publishAcknowledgement(message: CommandAckMessage) {
    return this.publish(mqttTopics.acknowledgements(this.config.siteId, this.config.deviceId), message);
  }

  publishStatus(message: DeviceStatusMessage) {
    this.lastStatus = message;
    return this.publish(mqttTopics.status(this.config.siteId, this.config.deviceId), message, true);
  }

  async stop() {
    if (!this.client) return;
    if (this.client.connected) {
      await this.publishStatus({
        ...this.createStatus(false),
        mode: this.lastStatus?.mode ?? 'automatic',
        firmwareVersion: this.lastStatus?.firmwareVersion,
      }).catch((error: unknown) => console.error('[mqtt] Failed to publish offline state', error));
    }
    const force = !this.client.connected;
    await new Promise<void>((resolve) => this.client?.end(force, {}, () => resolve()));
  }

  private createStatus(online: boolean): DeviceStatusMessage {
    return {
      kind: 'device_status',
      schemaVersion: 1,
      siteId: this.config.siteId,
      deviceId: this.config.deviceId,
      messageId: `edge-status-${Date.now()}`,
      recordedAt: new Date().toISOString(),
      online,
      mode: this.lastStatus?.mode ?? 'automatic',
      firmwareVersion: this.lastStatus?.firmwareVersion,
      systemState: this.lastStatus?.systemState,
      growthPhase: this.lastStatus?.growthPhase,
      sensorValid: this.lastStatus?.sensorValid,
    };
  }

  private async restoreSession() {
    await Promise.all([
      this.subscribe(
        mqttTopics.commands(
          this.config.siteId,
          this.config.deviceId,
        ),
      ),
      this.subscribe(
        mqttTopics.acknowledgements(
          this.config.siteId,
          this.config.deviceId,
        ),
      ),
    ]);

    await this.publishStatus(this.createStatus(this.deviceAvailable));

    console.log(`[mqtt] Connected as ${this.config.mqtt.clientId}.`);
    console.log('[mqtt] Subscribed to command and persistence ACK topics.');
  }

private async handleMessage(topic: string, payload: Buffer) {
  try {
    const message = decodeJsonMessage(payload);

    if (
      topic === mqttTopics.commands(
        this.config.siteId,
        this.config.deviceId,
      )
    ) {
      if (!this.commandHandler) return;

      if (!isPumpCommandMessage(message)) {
        throw new Error(
          'Command payload does not match the shared contract.',
        );
      }

      if (
        message.siteId !== this.config.siteId ||
        message.deviceId !== this.config.deviceId
      ) {
        return;
      }

      await this.commandHandler(message);
      return;
    }

    if (
      topic === mqttTopics.acknowledgements(
        this.config.siteId,
        this.config.deviceId,
      )
    ) {
      // Ignore command_ack messages that Edge itself may receive
      // from the shared /ack topic.
      if (!isTelemetryPersistedAckMessage(message)) return;

      if (
        message.siteId !== this.config.siteId ||
        message.deviceId !== this.config.deviceId
      ) {
        return;
      }

      await this.telemetryPersistedHandler?.(message);
    }
  } catch (error) {
    console.error('[mqtt] Message rejected', error);
  }
}
  private subscribe(topic: string) {
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topic, { qos: 1 }, (error) => error ? reject(error) : resolve());
    });
  }

  private publish(topic: string, message: unknown, retain = false) {
    if (!this.client?.connected) return Promise.reject(new Error('MQTT client is not connected.'));
    return new Promise<void>((resolve, reject) => {
      this.client?.publish(topic, JSON.stringify(message), { qos: 1, retain }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }
}
