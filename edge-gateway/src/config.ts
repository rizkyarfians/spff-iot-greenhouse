import 'dotenv/config';

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
};

const numberFromEnvironment = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
};

const booleanFromEnvironment = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new Error(`${name} must be true or false.`);
};

const optional = (name: string) => process.env[name]?.trim() || undefined;

const mqttCredentials = () => {
  const username = optional('MQTT_USERNAME');
  const password = optional('MQTT_PASSWORD');
  if (Boolean(username) !== Boolean(password)) {
    throw new Error('MQTT_USERNAME and MQTT_PASSWORD must be configured together.');
  }
  return { username, password };
};

const mqttUrl = () => {
  const value = required('MQTT_URL', 'mqtt://127.0.0.1:1883');
  const protocol = new URL(value).protocol;
  if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(protocol)) {
    throw new Error('MQTT_URL must use mqtt, mqtts, ws, or wss.');
  }
  return value;
};

const credentials = mqttCredentials();

export const config = {
  siteId: required('SITE_ID', 'greenhouse-01'),
  deviceId: required('DEVICE_ID', 'esp32-s3-01'),
  serial: {
    enabled: booleanFromEnvironment('SERIAL_ENABLED', false),
    path: required('SERIAL_PORT', process.platform === 'win32' ? 'COM3' : '/dev/ttyACM0'),
    baudRate: numberFromEnvironment('SERIAL_BAUD_RATE', 115200),
    maxLineBytes: numberFromEnvironment('SERIAL_MAX_LINE_BYTES', 16_384),
    reconnectMinMs: numberFromEnvironment('SERIAL_RECONNECT_MIN_MS', 1_000),
    reconnectMaxMs: numberFromEnvironment('SERIAL_RECONNECT_MAX_MS', 30_000),
  },
  mqtt: {
    url: mqttUrl(),
    clientId: required('MQTT_CLIENT_ID', 'edge-greenhouse-01'),
    username: credentials.username,
    password: credentials.password,
    rejectUnauthorized: booleanFromEnvironment('MQTT_TLS_REJECT_UNAUTHORIZED', true),
    connectTimeoutMs: numberFromEnvironment('MQTT_CONNECT_TIMEOUT_MS', 30_000),
    reconnectPeriodMs: numberFromEnvironment('MQTT_RECONNECT_PERIOD_MS', 3_000),
    keepaliveSeconds: numberFromEnvironment('MQTT_KEEPALIVE_SECONDS', 30),
  },
  outbox: {
    directory: required('EDGE_OUTBOX_DIR', './data/edge-outbox'),
    maxItems: numberFromEnvironment('EDGE_OUTBOX_MAX_ITEMS', 50_000),
    flushIntervalMs: numberFromEnvironment('EDGE_OUTBOX_FLUSH_INTERVAL_MS', 2_000),
  },
} as const;

if (config.serial.reconnectMaxMs < config.serial.reconnectMinMs) {
  throw new Error('SERIAL_RECONNECT_MAX_MS must be greater than or equal to SERIAL_RECONNECT_MIN_MS.');
}

export type EdgeConfig = typeof config;
