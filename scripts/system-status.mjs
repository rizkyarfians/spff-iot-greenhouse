import pg from "pg";

const { Pool } = pg;

const args = process.argv.slice(2);
const requestedMode =
  args.find((argument) => !argument.startsWith("--")) ?? "all";
const modeAliases = new Map([
  ["all", "all"],
  ["summary", "all"],
  ["esp", "esp"],
  ["device", "esp"],
  ["devices", "esp"],
  ["data", "telemetry"],
  ["telemetry", "telemetry"],
  ["actuator", "actuators"],
  ["actuators", "actuators"],
  ["schedule", "schedules"],
  ["schedules", "schedules"],
]);
const mode = modeAliases.get(requestedMode);
const watch = args.includes("--watch");
const help = args.includes("--help") || args.includes("-h");
const intervalArgument = args.find((argument) =>
  argument.startsWith("--interval="),
);
const requestedInterval = Number(
  intervalArgument?.split("=", 2)[1] ??
    process.env.STATUS_LOG_INTERVAL_SECONDS ??
    5,
);
const intervalSeconds =
  Number.isFinite(requestedInterval) && requestedInterval >= 1
    ? requestedInterval
    : 5;

const usage = `
Smart Fertigasi operational status

Usage:
  npm run logs
  npm run logs:esp
  npm run logs:telemetry
  npm run logs:actuators
  npm run logs:schedules
  npm run logs:watch

Direct options:
  node --env-file=functions/.env scripts/system-status.mjs [all|esp|telemetry|actuators|schedules] [--watch] [--interval=5]
`;

if (help) {
  console.log(usage.trim());
  process.exit(0);
}

if (!mode) {
  console.error(`Mode tidak dikenal: ${requestedMode}`);
  console.error(usage.trim());
  process.exit(1);
}

const positiveSecondsFromEnvironment = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const siteId = process.env.SPFF_SITE_ID ?? "greenhouse-01";
const deviceStaleAfterSeconds = positiveSecondsFromEnvironment(
  "DEVICE_STALE_AFTER_SECONDS",
  90,
);
const deviceOfflineAfterSeconds = positiveSecondsFromEnvironment(
  "DEVICE_OFFLINE_AFTER_SECONDS",
  300,
);
const telemetryStaleAfterSeconds = positiveSecondsFromEnvironment(
  "TELEMETRY_STALE_AFTER_SECONDS",
  120,
);
const telemetryOfflineAfterSeconds = positiveSecondsFromEnvironment(
  "TELEMETRY_OFFLINE_AFTER_SECONDS",
  600,
);

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "spff",
  user: process.env.PGUSER ?? "spff_app",
  password: process.env.PGPASSWORD,
  application_name: "spff-system-status",
  max: 4,
});

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatAge = (value) => {
  const totalSeconds = toNumberOrNull(value);
  if (totalSeconds === null) return "-";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
};

const formatLatency = (value) => {
  const seconds = toNumberOrNull(value);
  if (seconds === null) return "-";
  return `${seconds.toFixed(Math.abs(seconds) < 10 ? 2 : 1)}s`;
};

const formatTimestamp = (value, timezone) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const deviceConnection = (row) => {
  if (!row.enabled) return "DISABLED";
  const age = toNumberOrNull(row.age_seconds);
  if (age === null) return "NO HEARTBEAT";
  if (row.online !== true || age >= deviceOfflineAfterSeconds) return "OFFLINE";
  if (age >= deviceStaleAfterSeconds) return "STALE";
  return "ONLINE";
};

const telemetryFlow = (row) => {
  if (!row.enabled) return "DISABLED";
  const age = toNumberOrNull(row.age_seconds);
  if (age === null) return "NO DATA";
  if (age >= telemetryOfflineAfterSeconds) return "STOPPED";
  if (age >= telemetryStaleAfterSeconds) return "STALE";
  return "FLOWING";
};

const inFlightCommandStatuses = new Set(["pending", "published", "accepted"]);

const actuatorStatus = (row) => {
  if (!row.enabled) return "DISABLED";
  if (row.command_expired && inFlightCommandStatuses.has(row.command_status))
    return "CMD EXPIRED";
  if (inFlightCommandStatuses.has(row.command_status)) return "PROCESSING";
  if (!row.state) return "UNKNOWN";
  return String(row.state).toUpperCase();
};

const shortId = (value) => {
  if (!value) return "-";
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 11)}...` : text;
};

const printTable = (title, rows, emptyMessage) => {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log(`  ${emptyMessage}`);
    return;
  }
  console.table(rows);
};

async function queryIdentityAndSite() {
  const result = await pool.query(
    `SELECT current_database() AS database,
            current_user AS role,
            site.name,
            site.timezone
     FROM (SELECT 1) identity
     LEFT JOIN spff.sites site ON site.site_id = $1`,
    [siteId],
  );
  return result.rows[0];
}

async function queryDevices() {
  const result = await pool.query(
    `SELECT device.device_id,
            device.display_name,
            device.hardware_model,
            device.firmware_version AS configured_firmware,
            device.enabled,
            status.online,
            status.mode,
            status.firmware_version AS reported_firmware,
            status.system_state,
            status.sensor_valid,
            status.recorded_at,
            status.received_at,
            extract(epoch FROM (clock_timestamp() - status.received_at)) AS age_seconds
     FROM spff.devices device
     LEFT JOIN spff.latest_device_status status
       ON status.site_id = device.site_id
      AND status.device_id = device.device_id
     WHERE device.site_id = $1
     ORDER BY device.device_id`,
    [siteId],
  );
  return result.rows;
}

async function queryTelemetry() {
  const result = await pool.query(
    `SELECT device.device_id,
            device.display_name,
            device.enabled,
            telemetry.message_id,
            telemetry.sequence,
            telemetry.recorded_at,
            telemetry.received_at,
            telemetry.sensor_valid,
            extract(epoch FROM (clock_timestamp() - telemetry.received_at)) AS age_seconds,
            extract(epoch FROM (telemetry.received_at - telemetry.recorded_at)) AS latency_seconds,
            coalesce(recent.samples_10m, 0)::integer AS samples_10m,
            (
              SELECT count(*)::integer
              FROM spff.sensor_definitions definition
              WHERE definition.enabled = true
                AND to_jsonb(telemetry) ->> definition.sensor_key IS NOT NULL
            ) AS sensor_values
     FROM spff.devices device
     LEFT JOIN LATERAL (
       SELECT sample.*
       FROM spff.telemetry_samples sample
       WHERE sample.site_id = device.site_id
         AND sample.device_id = device.device_id
       ORDER BY sample.received_at DESC, sample.telemetry_id DESC
       LIMIT 1
     ) telemetry ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS samples_10m
       FROM spff.telemetry_samples sample
       WHERE sample.site_id = device.site_id
         AND sample.device_id = device.device_id
         AND sample.received_at >= clock_timestamp() - interval '10 minutes'
     ) recent ON true
     WHERE device.site_id = $1
     ORDER BY device.device_id`,
    [siteId],
  );
  return result.rows;
}

async function queryActuators() {
  const result = await pool.query(
    `SELECT actuator.device_id,
            actuator.actuator_key,
            actuator.display_name,
            actuator.enabled,
            state.state,
            state.is_active,
            state.source,
            state.reason AS state_reason,
            state.received_at AS state_received_at,
            extract(epoch FROM (clock_timestamp() - state.received_at)) AS state_age_seconds,
            command.command_id,
            command.status AS command_status,
            command.requested_is_active,
            command.issued_at,
            command.expires_at < clock_timestamp() AS command_expired,
            extract(epoch FROM (clock_timestamp() - command.issued_at)) AS command_age_seconds,
            acknowledgement.status AS ack_status,
            acknowledgement.reason AS ack_reason
     FROM spff.actuators actuator
     LEFT JOIN spff.latest_actuator_states state
       ON state.site_id = actuator.site_id
      AND state.device_id = actuator.device_id
      AND state.actuator_key = actuator.actuator_key
     LEFT JOIN LATERAL (
       SELECT command_id, status, requested_is_active, issued_at, expires_at
       FROM spff.control_commands
       WHERE site_id = actuator.site_id
         AND device_id = actuator.device_id
         AND actuator_key = actuator.actuator_key
       ORDER BY issued_at DESC
       LIMIT 1
     ) command ON true
     LEFT JOIN LATERAL (
       SELECT status, reason
       FROM spff.command_ack_events
       WHERE command_id = command.command_id
       ORDER BY acknowledged_at DESC, ack_event_id DESC
       LIMIT 1
     ) acknowledgement ON true
     WHERE actuator.site_id = $1
     ORDER BY actuator.device_id, actuator.actuator_key`,
    [siteId],
  );
  return result.rows;
}

async function queryScheduleSync() {
  const result = await pool.query(
    `SELECT device.device_id,
            device.display_name,
            sync.revision,
            sync.published_revision,
            sync.published_authority,
            sync.published_at,
            sync.acknowledged_revision,
            sync.acknowledgement_status,
            sync.acknowledged_at,
            sync.acknowledgement_reason,
            sync.stored_schedule_count,
            count(schedule.schedule_id)
              FILTER (WHERE schedule.enabled = true)::integer AS desired_schedule_count
     FROM spff.devices device
     LEFT JOIN spff.device_schedule_sync_state sync
       ON sync.site_id = device.site_id
      AND sync.device_id = device.device_id
     LEFT JOIN spff.actuator_schedules schedule
       ON schedule.site_id = device.site_id
      AND schedule.device_id = device.device_id
     WHERE device.site_id = $1
     GROUP BY
       device.device_id,
       device.display_name,
       sync.site_id,
       sync.device_id
     ORDER BY device.device_id`,
    [siteId],
  );
  return result.rows;
}

const printDevices = (rows, timezone) => {
  printTable(
    "ESP / heartbeat",
    rows.map((row) => ({
      device: row.device_id,
      name: row.display_name,
      connection: deviceConnection(row),
      last_seen: formatAge(row.age_seconds),
      received_at: formatTimestamp(row.received_at, timezone),
      reported: row.online === null ? "-" : row.online ? "online" : "offline",
      mode: row.mode ?? "-",
      firmware: row.reported_firmware ?? row.configured_firmware ?? "-",
      sensors:
        row.sensor_valid === null
          ? "-"
          : row.sensor_valid
            ? "valid"
            : "invalid",
    })),
    `Belum ada device untuk site ${siteId}.`,
  );
};

const printTelemetry = (rows, timezone) => {
  printTable(
    "Pengiriman telemetry ke PostgreSQL",
    rows.map((row) => ({
      device: row.device_id,
      flow: telemetryFlow(row),
      last_data: formatAge(row.age_seconds),
      received_at: formatTimestamp(row.received_at, timezone),
      samples_10m: Number(row.samples_10m ?? 0),
      sequence: row.sequence ?? "-",
      values: row.sensor_values ?? 0,
      quality:
        row.sensor_valid === null
          ? "-"
          : row.sensor_valid
            ? "valid"
            : "invalid",
      latency: formatLatency(row.latency_seconds),
      message_id: shortId(row.message_id),
    })),
    `Belum ada device/telemetry untuk site ${siteId}.`,
  );
};

const printActuators = (rows) => {
  printTable(
    "Aktuator dan command terakhir",
    rows.map((row) => ({
      device: row.device_id,
      actuator: row.actuator_key,
      name: row.display_name,
      status: actuatorStatus(row),
      actual: row.is_active === null ? "-" : row.is_active ? "ON" : "OFF",
      state_age: formatAge(row.state_age_seconds),
      source: row.source ?? "-",
      command: row.command_status ?? "-",
      target:
        row.requested_is_active === null
          ? "-"
          : row.requested_is_active
            ? "ON"
            : "OFF",
      command_age: formatAge(row.command_age_seconds),
      ack: row.ack_status ?? "-",
      command_id: shortId(row.command_id),
    })),
    `Belum ada actuator untuk site ${siteId}.`,
  );
};

const printScheduleSync = (rows, timezone) => {
  printTable(
    "Sinkronisasi jadwal ke ESP32",
    rows.map((row) => {
      const revision = toNumberOrNull(row.revision);
      const publishedRevision = toNumberOrNull(row.published_revision);
      const acknowledgedRevision = toNumberOrNull(row.acknowledged_revision);
      const status =
        revision === null
          ? "NOT INITIALIZED"
          : acknowledgedRevision === revision &&
              row.acknowledgement_status === "applied"
            ? "SYNCED"
            : acknowledgedRevision === revision &&
                row.acknowledgement_status === "rejected"
              ? "REJECTED"
              : publishedRevision === revision
                ? "WAITING ACK"
                : "PENDING PUBLISH";

      return {
        device: row.device_id,
        status,
        revision: revision ?? "-",
        authority: row.published_authority ?? "-",
        desired: Number(row.desired_schedule_count ?? 0),
        stored: row.stored_schedule_count ?? "-",
        published_at: formatTimestamp(row.published_at, timezone),
        acknowledged_at: formatTimestamp(row.acknowledged_at, timezone),
        reason: row.acknowledgement_reason ?? "-",
      };
    }),
    `Belum ada device untuk site ${siteId}.`,
  );
};

const printOverview = (devices, telemetry, actuators) => {
  const onlineDevices = devices.filter(
    (row) => deviceConnection(row) === "ONLINE",
  ).length;
  const flowingDevices = telemetry.filter(
    (row) => telemetryFlow(row) === "FLOWING",
  ).length;
  const knownActuators = actuators.filter(
    (row) => !["UNKNOWN", "DISABLED"].includes(actuatorStatus(row)),
  ).length;
  const commandsInFlight = actuators.filter((row) =>
    inFlightCommandStatuses.has(row.command_status),
  ).length;

  console.log("\nRingkasan");
  console.log(
    `  ESP online       : ${onlineDevices}/${devices.filter((row) => row.enabled).length}`,
  );
  console.log(
    `  Telemetry flowing: ${flowingDevices}/${telemetry.filter((row) => row.enabled).length}`,
  );
  console.log(
    `  Actuator known   : ${knownActuators}/${actuators.filter((row) => row.enabled).length}`,
  );
  console.log(`  Command in-flight: ${commandsInFlight}`);
};

async function render() {
  const [identity, devices, telemetry, actuators, schedules] = await Promise.all([
    queryIdentityAndSite(),
    mode === "all" || mode === "esp" ? queryDevices() : Promise.resolve([]),
    mode === "all" || mode === "telemetry"
      ? queryTelemetry()
      : Promise.resolve([]),
    mode === "all" || mode === "actuators"
      ? queryActuators()
      : Promise.resolve([]),
    mode === "all" || mode === "schedules"
      ? queryScheduleSync()
      : Promise.resolve([]),
  ]);
  const timezone = identity.timezone ?? "Asia/Jakarta";

  console.log("Smart Fertigasi - operational status");
  console.log(
    `Site     : ${siteId}${identity.name ? ` (${identity.name})` : " (belum terdaftar)"}`,
  );
  console.log(`Database : ${identity.database} as ${identity.role}`);
  console.log(
    `Checked  : ${formatTimestamp(new Date(), timezone)} ${timezone}`,
  );

  if (mode === "all") printOverview(devices, telemetry, actuators);
  if (mode === "all" || mode === "esp") printDevices(devices, timezone);
  if (mode === "all" || mode === "telemetry")
    printTelemetry(telemetry, timezone);
  if (mode === "all" || mode === "actuators") printActuators(actuators);
  if (mode === "all" || mode === "schedules")
    printScheduleSync(schedules, timezone);
}

let stopping = false;
const requestStop = () => {
  stopping = true;
};
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

try {
  do {
    if (watch && process.stdout.isTTY) process.stdout.write("\x1Bc");
    await render();
    if (!watch) break;
    console.log(
      `\nRefresh tiap ${intervalSeconds}s. Tekan Ctrl+C untuk berhenti.`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  } while (!stopping);
} catch (error) {
  const relationHint =
    error?.code === "42P01"
      ? "\nHint: jalankan seluruh migration PostgreSQL terbaru terlebih dahulu."
      : "";
  console.error(
    `Gagal membaca status PostgreSQL: ${error instanceof Error ? error.message : String(error)}${relationHint}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
