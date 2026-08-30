import {
  mqttTopics,
  type AutomaticControlSyncMessage,
  type PumpCommandMessage,
  type ScheduleSyncMessage,
  type TelemetryPersistedAckMessage,
} from '@spff/contracts';
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import { config } from "./config.js";
import type { IngestionService } from "./ingestionService.js";

export class MqttWorker {
  private client: MqttClient | null = null;
  private readonly connectedHandlers = new Set<() => Promise<void>>();

  constructor(private readonly ingestionService: IngestionService) {}

  onConnected(handler: () => Promise<void>) {
    this.connectedHandlers.add(handler);
  }

  async start() {
    const options: IClientOptions = {
      clientId: config.mqtt.clientId,
      username: config.mqtt.username,
      password: config.mqtt.password,
      clean: false,
      connectTimeout: config.mqtt.connectTimeoutMs,
      reconnectPeriod: config.mqtt.reconnectPeriodMs,
      keepalive: config.mqtt.keepaliveSeconds,
      rejectUnauthorized: config.mqtt.rejectUnauthorized,
    };

    let initialSessionSettled = false;
    let resolveInitialSession: (() => void) | null = null;
    let rejectInitialSession: ((error: Error) => void) | null = null;
    const initialSession = new Promise<void>((resolve, reject) => {
      resolveInitialSession = resolve;
      rejectInitialSession = reject;
    });

    this.client = connect(config.mqtt.url, options);
    this.client.on("error", (error) =>
      console.error("[mqtt-worker] Connection error", error),
    );
    this.client.on("reconnect", () =>
      console.warn("[mqtt-worker] Reconnecting..."),
    );
this.client.on('message', (topic, payload) => {
  void this.ingestionService
    .process(topic, payload)
    .then((acknowledgement) => {
      if (!acknowledgement) return;
      return this.publishTelemetryPersistedAck(acknowledgement);
    })
    .catch((error: unknown) =>
      console.error('[mqtt-worker] Message rejected', { topic, error }),
    );
});
    this.client.on("connect", () => {
      void this.restoreSubscriptions()
        .then(() => {
          return Promise.all(
            [...this.connectedHandlers].map((handler) => handler()),
          );
        })
        .then(() => {
          if (!initialSessionSettled) {
            initialSessionSettled = true;
            resolveInitialSession?.();
          }
        })
        .catch((error: unknown) => {
          const sessionError =
            error instanceof Error
              ? error
              : new Error("MQTT subscription restore failed.");
          if (!initialSessionSettled) {
            initialSessionSettled = true;
            rejectInitialSession?.(sessionError);
          } else {
            console.error(
              "[mqtt-worker] Subscription restore failed",
              sessionError,
            );
          }
        });
    });

    const timeout = setTimeout(() => {
      if (initialSessionSettled) return;
      initialSessionSettled = true;
      rejectInitialSession?.(
        new Error(
          `MQTT connection timed out after ${config.mqtt.connectTimeoutMs} ms.`,
        ),
      );
    }, config.mqtt.connectTimeoutMs);

    try {
      await initialSession;
    } finally {
      clearTimeout(timeout);
    }
  }

  async publishCommand(message: PumpCommandMessage): Promise<void> {
    const client = this.client;
    if (!client?.connected) {
      throw new Error("MQTT client is not connected.");
    }

    const topic = mqttTopics.commands(message.siteId, message.deviceId);
    await new Promise<void>((resolve, reject) => {
      client.publish(
        topic,
        JSON.stringify(message),
        { qos: 1, retain: false },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async publishScheduleSync(message: ScheduleSyncMessage): Promise<void> {
    const client = this.client;
    if (!client?.connected) {
      throw new Error("MQTT client is not connected.");
    }

    const topic = mqttTopics.schedules(message.siteId, message.deviceId);
    await new Promise<void>((resolve, reject) => {
      client.publish(
        topic,
        JSON.stringify(message),
        {
          qos: 1,
          retain: true,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async publishAutomaticControlSync(
    message: AutomaticControlSyncMessage,
  ): Promise<void> {
    const client = this.client;
    if (!client?.connected) {
      throw new Error("MQTT client is not connected.");
    }
    const topic = mqttTopics.automaticControl(message.siteId, message.deviceId);
    await new Promise<void>((resolve, reject) => {
      client.publish(
        topic,
        JSON.stringify(message),
        { qos: 1, retain: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

private async publishTelemetryPersistedAck(
  message: TelemetryPersistedAckMessage,
): Promise<void> {
  const client = this.client;

  if (!client?.connected) {
    throw new Error('MQTT client is not connected.');
  }

  const topic = mqttTopics.acknowledgements(
    message.siteId,
    message.deviceId,
  );

  await new Promise<void>((resolve, reject) => {
    client.publish(
      topic,
      JSON.stringify(message),
      { qos: 1, retain: false },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
  async stop() {
    if (!this.client) return;
    const force = !this.client.connected;
    await new Promise<void>((resolve) =>
      this.client?.end(force, {}, () => resolve()),
    );
  }

  private subscribe(topics: string[]) {
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topics, { qos: 1 }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  private async restoreSubscriptions() {
    await this.subscribe([
      mqttTopics.allTelemetry,
      mqttTopics.allStates,
      mqttTopics.allAcknowledgements,
      mqttTopics.allStatuses,
    ]);
    console.log(`[mqtt-worker] Connected as ${config.mqtt.clientId}.`);
  }
}
