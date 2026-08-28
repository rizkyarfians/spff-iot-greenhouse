export const telemetrySensorKeys = [
  'soil_1_moisture',
  'soil_1_temp',
  'soil_1_ec_us_cm',
  'soil_1_ph',
  'soil_1_n',
  'soil_1_p',
  'soil_1_k',
  'soil_2_moisture',
  'soil_2_temp',
  'soil_2_ec_us_cm',
  'soil_2_ph',
  'soil_2_n',
  'soil_2_p',
  'soil_2_k',
  'liquid_ph',
  'liquid_ec_us_cm',
  'liquid_temp',
  'air_temp',
  'air_humidity',
  'tank_water_distance_cm',
  'tank_water_level_pct',
  'tank_fert_distance_cm',
  'tank_fert_level_pct',
  'flow_water_lpm',
  'flow_water_total_l',
  'flow_fert_lpm',
  'flow_fert_total_l',
  'battery_voltage',
] as const;
export type TelemetrySensorKey = (typeof telemetrySensorKeys)[number];

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  errors?: string[];
}

export interface MessageIdentity {
  schemaVersion: 1;
  siteId: string;
  deviceId: string;
}

export interface TelemetryMessage extends MessageIdentity {
  kind: 'telemetry';
  messageId: string;
  sequence: number;
  recordedAt: string;
  sensors: Partial<Record<TelemetrySensorKey, number>>;
}

export interface TelemetryPersistedAckMessage extends MessageIdentity {
  kind: 'telemetry_persisted_ack';
  messageId: string;
  sequence: number;
  persistedAt: string;
}

export interface PumpCommandMessage extends MessageIdentity {
  kind: 'command';
  commandId: string;
  issuedAt: string;
  expiresAt: string;
  requestedBy: string;
  type: 'set_pump';
  targetId: string;
  params: {
    isActive: boolean;
  };
}

export type CommandAckStatus = 'accepted' | 'completed' | 'rejected' | 'timed_out';

export interface CommandAckMessage extends MessageIdentity {
  kind: 'command_ack';
  commandId: string;
  acknowledgedAt: string;
  status: CommandAckStatus;
  targetId: string;
  actualState?: {
    isActive: boolean;
  };
  reason?: string;
}

export type ActuatorReportedState = 'active' | 'inactive' | 'offline' | 'fault';

export interface ActuatorStateMessage extends MessageIdentity {
  kind: 'actuator_state';
  messageId: string;
  commandId?: string;
  recordedAt: string;
  targetId: string;
  state: ActuatorReportedState;
  isActive: boolean | null;
  reason?: string;
}

export interface DeviceStatusMessage extends MessageIdentity {
  kind: 'device_status';
  messageId?: string;
  recordedAt: string;
  online: boolean;
  mode: 'manual' | 'automatic';
  firmwareVersion?: string;
  systemState?: string;
  growthPhase?: string;
  sensorValid?: boolean;
}

export type DeviceUplinkMessage = TelemetryMessage | ActuatorStateMessage | CommandAckMessage | DeviceStatusMessage;

const topicPrefix = 'spff/v1';
const assertTopicPart = (value: string, field: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${field} contains unsupported MQTT topic characters.`);
  return value;
};

export const mqttTopics = {
  telemetry: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/telemetry`,
  state: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/state`,
  commands: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/commands`,
  acknowledgements: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/ack`,
  status: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/status`,
  allTelemetry: `${topicPrefix}/+/+/telemetry`,
  allStates: `${topicPrefix}/+/+/state`,
  allAcknowledgements: `${topicPrefix}/+/+/ack`,
  allStatuses: `${topicPrefix}/+/+/status`,
} as const;

export interface ParsedMqttTopic {
  siteId: string;
  deviceId: string;
  channel: 'telemetry' | 'state' | 'commands' | 'ack' | 'status';
}

export function parseMqttTopic(topic: string): ParsedMqttTopic | null {
  const [namespace, version, siteId, deviceId, channel, extra] = topic.split('/');
  if (namespace !== 'spff' || version !== 'v1' || !siteId || !deviceId || extra) return null;
  if (!['telemetry', 'state', 'commands', 'ack', 'status'].includes(channel)) return null;
  return { siteId, deviceId, channel: channel as ParsedMqttTopic['channel'] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasIdentity = (value: Record<string, unknown>) =>
  value.schemaVersion === 1 && typeof value.siteId === 'string' && typeof value.deviceId === 'string';

const isIsoDate = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));

export function decodeJsonMessage(payload: Uint8Array | string): unknown {
  const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  return JSON.parse(text) as unknown;
}

export function isTelemetryMessage(value: unknown): value is TelemetryMessage {
  if (!isRecord(value) || !hasIdentity(value) || value.kind !== 'telemetry' || !isRecord(value.sensors)) return false;
  return (
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    isIsoDate(value.recordedAt) &&
    Object.entries(value.sensors).every(
      ([key, sensorValue]) => telemetrySensorKeys.includes(key as TelemetrySensorKey) && typeof sensorValue === 'number' && Number.isFinite(sensorValue),
    )
  );
}

export function isTelemetryPersistedAckMessage(
  value: unknown,
): value is TelemetryPersistedAckMessage {
  if (
    !isRecord(value) ||
    !hasIdentity(value) ||
    value.kind !== 'telemetry_persisted_ack'
  ) {
    return false;
  }

  return (
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    isIsoDate(value.persistedAt)
  );
}

export function isPumpCommandMessage(value: unknown): value is PumpCommandMessage {
  if (!isRecord(value) || !hasIdentity(value) || value.kind !== 'command' || !isRecord(value.params)) return false;
  return (
    value.type === 'set_pump' &&
    typeof value.commandId === 'string' &&
    value.commandId.length > 0 &&
    isIsoDate(value.issuedAt) &&
    isIsoDate(value.expiresAt) &&
    Date.parse(value.expiresAt as string) > Date.parse(value.issuedAt as string) &&
    typeof value.requestedBy === 'string' &&
    typeof value.targetId === 'string' &&
    typeof value.params.isActive === 'boolean'
  );
}


export function isActuatorStateMessage(value: unknown): value is ActuatorStateMessage {
  if (!isRecord(value) || !hasIdentity(value) || value.kind !== 'actuator_state') return false;
  const state = String(value.state);
  const isActive = value.isActive;
  const consistent =
    (state === 'active' && isActive === true) ||
    (state === 'inactive' && isActive === false) ||
    ((state === 'offline' || state === 'fault') && (isActive === null || typeof isActive === 'boolean'));
  return (
    typeof value.messageId === 'string' && value.messageId.length > 0 &&
    (value.commandId === undefined || (typeof value.commandId === 'string' && value.commandId.length > 0)) &&
    isIsoDate(value.recordedAt) &&
    typeof value.targetId === 'string' && value.targetId.length > 0 &&
    ['active', 'inactive', 'offline', 'fault'].includes(state) &&
    consistent &&
    (value.reason === undefined || typeof value.reason === 'string')
  );
}

export function isCommandAckMessage(value: unknown): value is CommandAckMessage {
  if (!isRecord(value) || !hasIdentity(value) || value.kind !== 'command_ack') return false;
  const actualStateValid = value.actualState === undefined || (
    isRecord(value.actualState) && typeof value.actualState.isActive === 'boolean'
  );
  return (
    typeof value.commandId === 'string' &&
    value.commandId.length > 0 &&
    isIsoDate(value.acknowledgedAt) &&
    typeof value.targetId === 'string' &&
    ['accepted', 'completed', 'rejected', 'timed_out'].includes(String(value.status)) &&
    actualStateValid &&
    (value.reason === undefined || typeof value.reason === 'string')
  );
}

export function isDeviceStatusMessage(value: unknown): value is DeviceStatusMessage {
  if (!isRecord(value) || !hasIdentity(value) || value.kind !== 'device_status') return false;
  return (
    isIsoDate(value.recordedAt) &&
    typeof value.online === 'boolean' &&
    (value.mode === 'manual' || value.mode === 'automatic') &&
    (value.messageId === undefined || typeof value.messageId === 'string') &&
    (value.firmwareVersion === undefined || typeof value.firmwareVersion === 'string') &&
    (value.systemState === undefined || typeof value.systemState === 'string') &&
    (value.growthPhase === undefined || typeof value.growthPhase === 'string') &&
    (value.sensorValid === undefined || typeof value.sensorValid === 'boolean')
  );
}

export type ApiSensorStatus = 'good' | 'warning' | 'critical' | 'offline';
export type DeviceConnectionStatus = 'online' | 'stale' | 'offline';
export type ScheduleRepeatRule = 'daily' | 'weekdays' | 'weekends' | 'once';

export interface ApiSensor {
  id: string;
  type: string;
  name: string;
  groupName: string;
  value: number | null;
  unit: string;
  status: ApiSensorStatus;
  updatedAt: string | null;
}

export interface ApiSensorDefinition {
  sensorKey: string;
  groupName: string;
  displayName: string;
  valueType: 'float' | 'integer';
  unit: string;
  sortOrder: number;
  enabled: boolean;
}

export type HistoryBucket =
  | '1m'
  | '5m'
  | '15m'
  | '1h'
  | '6h';

export interface ApiHistoryPoint {
  time: string;
  value: number;
  average: number;
  min: number;
  max: number;
  samples: number;
  recordedAt: string;
}

export interface ApiHistorySeries {
  sensorKey: string;
  unit: string;
  from: string;
  to: string;
  bucket: HistoryBucket;
  bucketMinutes: number;
  aggregate: 'avg';
  points: ApiHistoryPoint[];
}

export interface ApiActuator {
  id: string;
  deviceId: string;
  name: string;
  actuatorType: string;
  isActive: boolean;
  state: 'active' | 'inactive' | 'processing' | 'offline' | 'fault';
  commandId: string | null;
  commandStatus: string | null;
  requestedIsActive: boolean | null;
  activeDuration: string;
  maxRuntimeSeconds: number | null;
  updatedAt: string | null;
}

export interface ApiAlarm {
  id: string;
  deviceId: string;
  sourceType: 'sensor' | 'actuator' | 'system';
  sourceKey: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  acknowledged: boolean;
  createdAt: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ApiDevice {
  siteId: string;
  deviceId: string;
  displayName: string;
  hardwareModel: string | null;
  firmwareVersion: string | null;
  enabled: boolean;
  online: boolean;
  connectionStatus: DeviceConnectionStatus;
  mode: 'manual' | 'automatic' | null;
  systemState: string | null;
  growthPhase: string | null;
  sensorValid: boolean | null;
  recordedAt: string | null;
  lastSeenSecondsAgo: number | null;
}

export interface ApiSystemLog {
  logId: string;
  siteId: string | null;
  deviceId: string | null;
  component: string;
  level: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  eventCode: string | null;
  message: string;
  occurredAt: string;
  context: Record<string, unknown> | null;
}

export interface ApiTelemetryLog {
  recordedAt: string;
  sensorKey: string;
  displayName: string;
  unit: string;
  value: number | null;
}

export interface ApiSchedule {
  id: string;
  siteId: string;
  deviceId: string;
  actuatorKey: string;
  actuatorName: string;
  onTime: string;
  offTime: string;
  repeatRule: ScheduleRepeatRule;
  runDate: string | null;
  timezone: string;
  enabled: boolean;
  requestedBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ApiSettings {
  greenhouseName: string;
  temperatureMin: number | null;
  temperatureMax: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  notifications: boolean;
  sound: boolean;
  autoSchedule: boolean;
}

export interface ApiActuatorLog {
  actuatorStateId: string;
  recordedAt: string;
  receivedAt: string;
  deviceId: string;
  actuatorKey: string;
  displayName: string;
  state: ApiActuator['state'];
  isActive: boolean | null;
  source: 'telemetry' | 'command_ack' | 'manual' | 'system';
  reason: string | null;
  commandId: string | null;
}

export interface ApiLatestTelemetry {
  deviceId: string;
  recordedAt: string;
  receivedAt: string;
  values: Record<string, number | null>;
}

export interface ApiTelemetrySnapshot {
  sensors: ApiSensor[];
  latestTelemetry: ApiLatestTelemetry | null;
  devices: ApiDevice[];
  telemetryLog: ApiTelemetryLog[];
  actuators: ApiActuator[];
  actuatorLog: ApiActuatorLog[];
}

export interface BootstrapData {
  database: { database: string; schema: string };
  site: { siteId: string; name: string; timezone: string } | null;
  sensors: ApiSensor[];
  sensorDefinitions: ApiSensorDefinition[];
  latestTelemetry: ApiLatestTelemetry | null;
  actuators: ApiActuator[];
  alarms: ApiAlarm[];
  devices: ApiDevice[];
  logs: ApiSystemLog[];
  telemetryLog: ApiTelemetryLog[];
  actuatorLog: ApiActuatorLog[];
  schedules: ApiSchedule[];
  settings: ApiSettings | null;
}

export interface ApiPumpCommandRequest {
  commandId: string;
  isActive: boolean;
}

export interface ApiScheduleCreateRequest {
  deviceId: string;
  actuatorKey: string;
  onTime: string;
  offTime: string;
  repeatRule: ScheduleRepeatRule;
  runDate: string | null;
}

export interface ApiScheduleEnabledRequest {
  enabled: boolean;
}

export interface ApiAlarmActionResult {
  alarm_id: string;
  status: string;
}

export type AppRole =
  | 'admin'
  | 'operator';

export interface AuthUser {
  userId: string;
  username: string;
  displayName: string;
  role: AppRole;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ManagedUser extends AuthUser {
  enabled: boolean;

  lastLoginAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  username: string;
  displayName: string;
  password: string;
  role: AppRole;
}

export interface UpdateUserRequest {
  displayName?: string;
  password?: string;
  role?: AppRole;
  enabled?: boolean;
}

export interface AuditLogEntry {
  auditId: string;

  username: string;
  role: AppRole | null;

  action: string;

  resourceType: string;
  resourceId: string | null;

  success: boolean;

  method: string | null;
  path: string | null;
  status: number | null;

  ipAddress: string | null;

  occurredAt: string;

  metadata: Record<string, unknown> | null;
}

export * from './registration.js'
