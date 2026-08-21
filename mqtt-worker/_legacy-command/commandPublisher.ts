import { mqttTopics, type PumpCommandMessage } from '@spff/contracts';
import { connect, type IClientOptions, type MqttClient } from 'mqtt';
import { config } from './config.js';

export class MqttCommandPublisher {
  private client: MqttClient | null = null;

  get isConnected() {
    return this.client?.connected === true;
  }

  async start() {
    const options: IClientOptions = {
      clientId: config.commandMqtt.clientId,
      username: config.commandMqtt.username,
      password: config.commandMqtt.password,
      clean: false,
      connectTimeout: config.mqtt.connectTimeoutMs,
      reconnectPeriod: config.mqtt.reconnectPeriodMs,
      keepalive: config.mqtt.keepaliveSeconds,
      rejectUnauthorized: config.mqtt.rejectUnauthorized,
    };

    this.client = connect(config.mqtt.url, options);
    this.client.on('error', (error) => console.error('[command-publisher] connection error', error.message));
    this.client.on('reconnect', () => console.warn('[command-publisher] reconnecting'));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`MQTT command publisher timed out after ${config.mqtt.connectTimeoutMs} ms.`));
      }, config.mqtt.connectTimeoutMs);
      this.client?.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log(`[command-publisher] Connected as ${config.commandMqtt.clientId}.`);
        resolve();
      });
    });
  }

  publish(command: PumpCommandMessage) {
    if (!this.client?.connected) return Promise.reject(new Error('MQTT command publisher is not connected.'));
    const topic = mqttTopics.commands(command.siteId, command.deviceId);
    return new Promise<void>((resolve, reject) => {
      this.client?.publish(topic, JSON.stringify(command), { qos: 1, retain: false }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  async stop() {
    if (!this.client) return;
    const force = !this.client.connected;
    await new Promise<void>((resolve) => this.client?.end(force, {}, () => resolve()));
  }
}
