import { randomBytes } from "node:crypto";
import { access, chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const argumentsList = process.argv.slice(2);
const supportedArguments = new Set(["site", "device", "serial-port"]);

for (const argument of argumentsList) {
  const match = /^--([a-z-]+)=(.+)$/.exec(argument);
  if (!match || !supportedArguments.has(match[1])) {
    throw new Error(
      `Unsupported argument ${argument}. Use --site=, --device=, or --serial-port=.`,
    );
  }
}

const option = (name, fallback) => {
  const prefix = `--${name}=`;
  return (
    argumentsList
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
};

const siteId = option("site", "greenhouse-01");
const deviceId = option("device", "esp32-s3-01");
const serialPort = option("serial-port", "/dev/ttyACM0");

for (const [name, value] of [
  ["site", siteId],
  ["device", deviceId],
]) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      `${name} may only contain letters, numbers, underscore, and hyphen.`,
    );
  }
}

if (/\r|\n/.test(serialPort))
  throw new Error("serial-port may not contain a newline.");

const outputPaths = {
  broker: path.join(workspaceRoot, "infrastructure", "mqtt", ".env"),
  edge: path.join(workspaceRoot, "edge-gateway", ".env"),
  worker: path.join(workspaceRoot, "mqtt-worker", ".env"),
};

const pathExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const existingFiles = [];
for (const filePath of Object.values(outputPaths)) {
  if (await pathExists(filePath))
    existingFiles.push(path.relative(workspaceRoot, filePath));
}
if (existingFiles.length > 0) {
  throw new Error(
    `Refusing to overwrite existing configuration: ${existingFiles.join(", ")}`,
  );
}

const password = () => randomBytes(24).toString("base64url");
const values = {
  edgeUsername: `edge_${siteId.replaceAll("-", "_")}`,
  edgePassword: password(),
  workerUsername: `worker_${siteId.replaceAll("-", "_")}`,
  workerPassword: password(),
  commandUsername: `command_api_${siteId.replaceAll("-", "_")}`,
  commandPassword: password(),
  healthUsername: `healthcheck_${siteId.replaceAll("-", "_")}`,
  healthPassword: password(),
};

const brokerEnvironment = `SPFF_SITE_ID=${siteId}
SPFF_DEVICE_ID=${deviceId}

MQTT_URL=mqtt://127.0.0.1:1883
MQTT_BIND_ADDRESS=127.0.0.1
MQTT_PORT=1883

MQTT_EDGE_USERNAME=${values.edgeUsername}
MQTT_EDGE_PASSWORD=${values.edgePassword}
MQTT_WORKER_USERNAME=${values.workerUsername}
MQTT_WORKER_PASSWORD=${values.workerPassword}
MQTT_COMMAND_USERNAME=${values.commandUsername}
MQTT_COMMAND_PASSWORD=${values.commandPassword}
MQTT_HEALTH_USERNAME=${values.healthUsername}
MQTT_HEALTH_PASSWORD=${values.healthPassword}
`;

const edgeEnvironment = `SITE_ID=${siteId}
DEVICE_ID=${deviceId}

SERIAL_ENABLED=false
SERIAL_PORT=${serialPort}
SERIAL_BAUD_RATE=115200
SERIAL_MAX_LINE_BYTES=16384

MQTT_URL=mqtt://127.0.0.1:1883
MQTT_CLIENT_ID=edge-${siteId}-${deviceId}
MQTT_USERNAME=${values.edgeUsername}
MQTT_PASSWORD=${values.edgePassword}
MQTT_TLS_REJECT_UNAUTHORIZED=true
MQTT_CONNECT_TIMEOUT_MS=30000
MQTT_RECONNECT_PERIOD_MS=3000
MQTT_KEEPALIVE_SECONDS=30

EDGE_OUTBOX_DIR=/var/lib/spff/edge-outbox
EDGE_OUTBOX_MAX_ITEMS=50000
EDGE_OUTBOX_FLUSH_INTERVAL_MS=2000
`;

const workerEnvironment = `MQTT_URL=mqtt://127.0.0.1:1883
MQTT_CLIENT_ID=worker-${siteId}-01
MQTT_USERNAME=${values.workerUsername}
MQTT_PASSWORD=${values.workerPassword}
MQTT_TLS_REJECT_UNAUTHORIZED=true
MQTT_CONNECT_TIMEOUT_MS=30000
MQTT_RECONNECT_PERIOD_MS=3000
MQTT_KEEPALIVE_SECONDS=30

MQTT_COMMAND_CLIENT_ID=command-${siteId}-01
MQTT_COMMAND_USERNAME=${values.commandUsername}
MQTT_COMMAND_PASSWORD=${values.commandPassword}

DATABASE_URL=postgresql://spff_worker:replace-after-creating-spff-worker-role@127.0.0.1:5432/spff
DATABASE_POOL_MAX=6
DATABASE_CONNECT_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000

COMMAND_POLL_INTERVAL_MS=1000
COMMAND_BATCH_SIZE=20
COMMAND_EXPIRY_SECONDS=30
SCHEDULE_EXECUTION_MODE=server
SCHEDULE_POLL_INTERVAL_MS=1000
SCHEDULE_SYNC_POLL_INTERVAL_MS=1000
SCHEDULE_LOOKBACK_SECONDS=120
`;

const writePrivateFile = async (filePath, content) => {
  await writeFile(filePath, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(filePath, 0o600);
};

await writePrivateFile(outputPaths.broker, brokerEnvironment);
await writePrivateFile(outputPaths.edge, edgeEnvironment);
await writePrivateFile(outputPaths.worker, workerEnvironment);

console.log("[mqtt-config] Created private local configuration:");
for (const filePath of Object.values(outputPaths)) {
  console.log(`- ${path.relative(workspaceRoot, filePath)}`);
}
console.log(
  "[mqtt-config] Serial remains disabled until the ESP32 port and framing are verified.",
);
