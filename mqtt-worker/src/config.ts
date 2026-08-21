import "dotenv/config";

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
};

const booleanFromEnvironment = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

const numberFromEnvironment = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
};

const optional = (name: string) => process.env[name]?.trim() || undefined;

const mqttCredentials = () => {
  const username = optional("MQTT_USERNAME");
  const password = optional("MQTT_PASSWORD");
  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      "MQTT_USERNAME and MQTT_PASSWORD must be configured together.",
    );
  }
  return { username, password };
};

const mqttUrl = () => {
  const value = required("MQTT_URL", "mqtt://localhost:1883");
  const protocol = new URL(value).protocol;
  if (!["mqtt:", "mqtts:", "ws:", "wss:"].includes(protocol)) {
    throw new Error("MQTT_URL must use mqtt, mqtts, ws, or wss.");
  }
  return value;
};

const databaseUrl = () => {
  const value = required("DATABASE_URL");
  const protocol = new URL(value).protocol;
  if (!["postgres:", "postgresql:"].includes(protocol)) {
    throw new Error("DATABASE_URL must use postgres or postgresql.");
  }
  return value;
};

const credentials = mqttCredentials();

export const config = {
  mqtt: {
    url: mqttUrl(),
    clientId: required("MQTT_CLIENT_ID", "spff-local-ingestion-01"),
    username: credentials.username,
    password: credentials.password,
    rejectUnauthorized: booleanFromEnvironment(
      "MQTT_TLS_REJECT_UNAUTHORIZED",
      true,
    ),
    connectTimeoutMs: numberFromEnvironment("MQTT_CONNECT_TIMEOUT_MS", 30_000),
    reconnectPeriodMs: numberFromEnvironment("MQTT_RECONNECT_PERIOD_MS", 3_000),
    keepaliveSeconds: numberFromEnvironment("MQTT_KEEPALIVE_SECONDS", 30),
  },
  command: {
    pollIntervalMs: numberFromEnvironment("COMMAND_POLL_INTERVAL_MS", 1_000),
    batchSize: numberFromEnvironment("COMMAND_BATCH_SIZE", 20),
  },
  schedule: {
    pollIntervalMs: numberFromEnvironment("SCHEDULE_POLL_INTERVAL_MS", 1_000),
    lookbackSeconds: numberFromEnvironment("SCHEDULE_LOOKBACK_SECONDS", 120),
    commandExpirySeconds: numberFromEnvironment("COMMAND_EXPIRY_SECONDS", 30),
  },
  database: {
    url: databaseUrl(),
    maxConnections: numberFromEnvironment("DATABASE_POOL_MAX", 10),
    connectionTimeoutMs: numberFromEnvironment(
      "DATABASE_CONNECT_TIMEOUT_MS",
      10_000,
    ),
    idleTimeoutMs: numberFromEnvironment("DATABASE_IDLE_TIMEOUT_MS", 30_000),
  },
} as const;
