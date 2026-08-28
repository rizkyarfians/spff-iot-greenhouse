import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect } from "mqtt";

const required = (name) => {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name}. Run npm run mqtt:configure first.`);
  return value;
};

const mqttUrl = required("MQTT_URL");
const siteId = required("SPFF_SITE_ID");
const deviceId = required("SPFF_DEVICE_ID");
const topics = {
  telemetry: `spff/v1/${siteId}/${deviceId}/telemetry`,
  commands: `spff/v1/${siteId}/${deviceId}/commands`,
  acknowledgements: `spff/v1/${siteId}/${deviceId}/ack`,
  schedules: `spff/v1/${siteId}/${deviceId}/schedules`,
  status: `spff/v1/${siteId}/${deviceId}/status`,
};

const connectClient = (role, username, password) =>
  new Promise((resolve, reject) => {
    const client = connect(mqttUrl, {
      clientId: `smoke-${role}-${randomUUID()}`,
      username,
      password,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 5_000,
    });
    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error(`${role} client connection timed out.`));
    }, 7_000);
    const onError = (error) => {
      clearTimeout(timeout);
      client.end(true);
      reject(error);
    };
    client.once("connect", () => {
      clearTimeout(timeout);
      client.off("error", onError);
      client.on("error", (error) =>
        console.error(`[mqtt-smoke] ${role} client error: ${error.message}`),
      );
      resolve(client);
    });
    client.once("error", onError);
  });

const subscribe = (client, topic) =>
  new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error, grants) => {
      if (error) {
        reject(error);
        return;
      }
      if (!grants.some((grant) => grant.qos === 1)) {
        reject(new Error(`Subscription was not granted for ${topic}.`));
        return;
      }
      resolve();
    });
  });

const publish = (client, topic, payload, retain = false) =>
  new Promise((resolve, reject) => {
    client.publish(
      topic,
      JSON.stringify(payload),
      { qos: 1, retain },
      (error) => (error ? reject(error) : resolve()),
    );
  });

const waitForMessage = (client, topic, predicate, label) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, 7_000);
    const onMessage = (receivedTopic, buffer, packet) => {
      if (receivedTopic !== topic) return;
      try {
        const payload = JSON.parse(buffer.toString("utf8"));
        if (!predicate(payload)) return;
        clearTimeout(timeout);
        client.off("message", onMessage);
        resolve({ payload, packet });
      } catch {
        // Ignore unrelated malformed traffic during the smoke test.
      }
    };
    client.on("message", onMessage);
  });

const endClient = (client) =>
  new Promise((resolve) => {
    if (!client) {
      resolve();
      return;
    }
    client.end(true, {}, resolve);
  });

let edgeClient;
let workerClient;
let commandClient;
let retainedObserver;
let retainedScheduleObserver;

try {
  [edgeClient, workerClient, commandClient] = await Promise.all([
    connectClient(
      "edge",
      required("MQTT_EDGE_USERNAME"),
      required("MQTT_EDGE_PASSWORD"),
    ),
    connectClient(
      "worker",
      required("MQTT_WORKER_USERNAME"),
      required("MQTT_WORKER_PASSWORD"),
    ),
    connectClient(
      "command",
      required("MQTT_COMMAND_USERNAME"),
      required("MQTT_COMMAND_PASSWORD"),
    ),
  ]);

  await Promise.all([
    subscribe(edgeClient, topics.commands),
    subscribe(edgeClient, topics.schedules),
    subscribe(workerClient, topics.telemetry),
    subscribe(workerClient, topics.status),
    subscribe(commandClient, topics.acknowledgements),
  ]);

  const messageId = randomUUID();
  const commandId = randomUUID();
  const scheduleId = randomUUID();
  const telemetryReceived = waitForMessage(
    workerClient,
    topics.telemetry,
    (payload) => payload.messageId === messageId,
    "worker telemetry",
  );
  const commandReceived = waitForMessage(
    edgeClient,
    topics.commands,
    (payload) => payload.commandId === commandId,
    "edge command",
  );
  const acknowledgementReceived = waitForMessage(
    commandClient,
    topics.acknowledgements,
    (payload) => payload.commandId === commandId,
    "command acknowledgement",
  );
  const scheduleReceived = waitForMessage(
    edgeClient,
    topics.schedules,
    (payload) => payload.schedules?.[0]?.scheduleId === scheduleId,
    "edge schedule snapshot",
  );

  const now = new Date();
  await publish(edgeClient, topics.telemetry, {
    kind: "telemetry",
    schemaVersion: 1,
    siteId,
    deviceId,
    messageId,
    sequence: 1,
    recordedAt: now.toISOString(),
    sensors: { ph: 6.2, temperature: 27.4 },
  });
  await publish(commandClient, topics.commands, {
    kind: "command",
    schemaVersion: 1,
    siteId,
    deviceId,
    commandId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    requestedBy: "mqtt-smoke-test",
    type: "set_pump",
    targetId: "pump-01",
    params: { isActive: true },
  });
  await publish(edgeClient, topics.acknowledgements, {
    kind: "command_ack",
    schemaVersion: 1,
    siteId,
    deviceId,
    commandId,
    acknowledgedAt: new Date().toISOString(),
    status: "completed",
    targetId: "pump-01",
    actualState: { isActive: true },
  });
  await publish(
    workerClient,
    topics.schedules,
    {
      kind: "schedule_sync",
      schemaVersion: 1,
      siteId,
      deviceId,
      revision: 1,
      generatedAt: new Date().toISOString(),
      executionAuthority: "server",
      schedules: [
        {
          scheduleId,
          targetId: "pump_water",
          onTime: "07:00:00",
          offTime: "07:10:00",
          repeatRule: "daily",
          runDate: null,
          timezone: "Asia/Jakarta",
          enabled: true,
        },
      ],
    },
    true,
  );

  await Promise.all([
    telemetryReceived,
    commandReceived,
    acknowledgementReceived,
    scheduleReceived,
  ]);

  await publish(
    edgeClient,
    topics.status,
    {
      kind: "device_status",
      schemaVersion: 1,
      siteId,
      deviceId,
      recordedAt: new Date().toISOString(),
      online: true,
      mode: "automatic",
    },
    true,
  );

  retainedObserver = await connectClient(
    "retained-observer",
    required("MQTT_WORKER_USERNAME"),
    required("MQTT_WORKER_PASSWORD"),
  );
  const retainedStatus = waitForMessage(
    retainedObserver,
    topics.status,
    (payload) => payload.online === true,
    "retained device status",
  );
  await subscribe(retainedObserver, topics.status);
  const retainedResult = await retainedStatus;
  assert.equal(
    retainedResult.packet.retain,
    true,
    "Status must be retained by the broker.",
  );

  retainedScheduleObserver = await connectClient(
    "retained-schedule-observer",
    required("MQTT_EDGE_USERNAME"),
    required("MQTT_EDGE_PASSWORD"),
  );
  const retainedSchedule = waitForMessage(
    retainedScheduleObserver,
    topics.schedules,
    (payload) => payload.schedules?.[0]?.scheduleId === scheduleId,
    "retained schedule snapshot",
  );
  await subscribe(retainedScheduleObserver, topics.schedules);
  const retainedScheduleResult = await retainedSchedule;
  assert.equal(
    retainedScheduleResult.packet.retain,
    true,
    "Schedule snapshot must be retained by the broker.",
  );

  console.log(
    "[mqtt-smoke] PASS: authenticated QoS 1 telemetry, command, ACK, retained status, and retained schedule paths work.",
  );
} finally {
  await Promise.all([
    endClient(edgeClient),
    endClient(workerClient),
    endClient(commandClient),
    endClient(retainedObserver),
    endClient(retainedScheduleObserver),
  ]);
}
