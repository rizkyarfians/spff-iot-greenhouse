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
export type ScheduleRepeatRule = 'daily' | 'weekdays' | 'weekends' | 'once';
export type ScheduleExecutionAuthority = 'server' | 'device';
export type OperatingMode = 'manual' | 'automatic';
export type MoistureSensorKey = 'soil_1_moisture' | 'soil_2_moisture';

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
  mode: OperatingMode;
  firmwareVersion?: string;
  systemState?: string;
  growthPhase?: string;
  sensorValid?: boolean;
}

export interface WaterAutomaticControl {
  enabled: boolean;
  sensorKey: MoistureSensorKey;
  moistureLowPercent: number | null;
  moistureTargetPercent: number | null;
  maxRuntimeSeconds: number | null;
  cooldownSeconds: number | null;
  minTankLevelPercent: number | null;
  minFlowLpm: number | null;
  triggerSampleCount: number;
  sensorStaleSeconds: number;
}

export interface FertilizerAutomaticControl {
  enabled: boolean;
  sensorKey: 'liquid_ec_us_cm';
  ecLowUsCm: number | null;
  ecTargetUsCm: number | null;
  ecHighUsCm: number | null;
  dosePulseSeconds: number | null;
  mixingDelaySeconds: number | null;
  cooldownSeconds: number | null;
  maxDoseVolumeL: number | null;
  maxDailyVolumeL: number | null;
  minTankLevelPercent: number | null;
  minFlowLpm: number | null;
  triggerSampleCount: number;
  sensorStaleSeconds: number;
}

export interface AutomaticControlConfig {
  desiredMode: OperatingMode;
  water: WaterAutomaticControl;
  fertilizer: FertilizerAutomaticControl;
}

export interface AutomaticControlSyncMessage extends MessageIdentity {
  kind: 'automatic_control_sync';
  revision: number;
  generatedAt: string;
  config: AutomaticControlConfig;
}

export interface AutomaticControlAckMessage extends MessageIdentity {
  kind: 'automatic_control_ack';
  revision: number;
  acknowledgedAt: string;
  status: 'applied' | 'rejected';
  appliedMode: OperatingMode;
  reason?: string;
}

export interface DeviceSchedule {
  scheduleId: string;
  targetId: string;
  onTime: string;
  offTime: string;
  repeatRule: ScheduleRepeatRule;
  runDate: string | null;
  timezone: string;
  enabled: boolean;
}

export interface ScheduleSyncMessage extends MessageIdentity {
  kind: 'schedule_sync';
  revision: number;
  generatedAt: string;
  executionAuthority: ScheduleExecutionAuthority;
  schedules: DeviceSchedule[];
}

export interface ScheduleSyncAckMessage extends MessageIdentity {
  kind: 'schedule_sync_ack';
  revision: number;
  acknowledgedAt: string;
  status: 'applied' | 'rejected';
  storedScheduleCount: number;
  reason?: string;
}

export type DeviceUplinkMessage =
  | TelemetryMessage
  | ActuatorStateMessage
  | CommandAckMessage
  | ScheduleSyncAckMessage
  | AutomaticControlAckMessage
  | DeviceStatusMessage;

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
  schedules: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/schedules`,
  automaticControl: (siteId: string, deviceId: string) =>
    `${topicPrefix}/${assertTopicPart(siteId, 'siteId')}/${assertTopicPart(deviceId, 'deviceId')}/automatic-control`,
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
  channel: 'telemetry' | 'state' | 'commands' | 'schedules' | 'automatic-control' | 'ack' | 'status';
}

export function parseMqttTopic(topic: string): ParsedMqttTopic | null {
  const [namespace, version, siteId, deviceId, channel, extra] = topic.split('/');
  if (namespace !== 'spff' || version !== 'v1' || !siteId || !deviceId || extra) return null;
  if (!['telemetry', 'state', 'commands', 'schedules', 'automatic-control', 'ack', 'status'].includes(channel)) return null;
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

const scheduleTimePattern = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const isDeviceSchedule = (value: unknown): value is DeviceSchedule => {
  if (!isRecord(value)) return false;
  const repeatRule = String(value.repeatRule);
  const runDateValid =
    repeatRule === 'once'
      ? typeof value.runDate === 'string' &&
        dateOnlyPattern.test(value.runDate) &&
        Number.isFinite(Date.parse(`${value.runDate}T00:00:00.000Z`))
      : value.runDate === null;
  return (
    typeof value.scheduleId === 'string' &&
    value.scheduleId.length > 0 &&
    typeof value.targetId === 'string' &&
    value.targetId.length > 0 &&
    typeof value.onTime === 'string' &&
    scheduleTimePattern.test(value.onTime) &&
    typeof value.offTime === 'string' &&
    scheduleTimePattern.test(value.offTime) &&
    value.offTime > value.onTime &&
    ['daily', 'weekdays', 'weekends', 'once'].includes(repeatRule) &&
    runDateValid &&
    typeof value.timezone === 'string' &&
    value.timezone.length > 0 &&
    typeof value.enabled === 'boolean'
  );
};

export function isScheduleSyncMessage(value: unknown): value is ScheduleSyncMessage {
  if (
    !isRecord(value) ||
    !hasIdentity(value) ||
    value.kind !== 'schedule_sync' ||
    !Array.isArray(value.schedules) ||
    value.schedules.length > 64
  ) {
    return false;
  }
  const scheduleIds = new Set<string>();
  return (
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    isIsoDate(value.generatedAt) &&
    (value.executionAuthority === 'server' || value.executionAuthority === 'device') &&
    value.schedules.every((schedule) => {
      if (!isDeviceSchedule(schedule) || scheduleIds.has(schedule.scheduleId)) return false;
      scheduleIds.add(schedule.scheduleId);
      return true;
    })
  );
}

export function isScheduleSyncAckMessage(value: unknown): value is ScheduleSyncAckMessage {
  if (!isRecord(value) || !hasIdentity(value) || value.kind !== 'schedule_sync_ack') return false;
  return (
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    isIsoDate(value.acknowledgedAt) &&
    (value.status === 'applied' || value.status === 'rejected') &&
    Number.isSafeInteger(value.storedScheduleCount) &&
    (value.storedScheduleCount as number) >= 0 &&
    (value.reason === undefined || typeof value.reason === 'string')
  );
}

const isNullableFiniteNumber = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isNumberInRange = (value: unknown, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const isNullableNumberInRange = (value: unknown, minimum: number, maximum: number) =>
  value === null || isNumberInRange(value, minimum, maximum);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number) =>
  Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;

export function isAutomaticControlConfig(value: unknown): value is AutomaticControlConfig {
  if (!isRecord(value) || !isRecord(value.water) || !isRecord(value.fertilizer)) return false;
  const water = value.water;
  const fertilizer = value.fertilizer;
  const waterNumbers = [
    water.moistureLowPercent,
    water.moistureTargetPercent,
    water.maxRuntimeSeconds,
    water.cooldownSeconds,
    water.minTankLevelPercent,
    water.minFlowLpm,
  ];
  const fertilizerNumbers = [
    fertilizer.ecLowUsCm,
    fertilizer.ecTargetUsCm,
    fertilizer.ecHighUsCm,
    fertilizer.dosePulseSeconds,
    fertilizer.mixingDelaySeconds,
    fertilizer.cooldownSeconds,
    fertilizer.maxDoseVolumeL,
    fertilizer.maxDailyVolumeL,
    fertilizer.minTankLevelPercent,
    fertilizer.minFlowLpm,
  ];
  if (
    (value.desiredMode !== 'manual' && value.desiredMode !== 'automatic') ||
    typeof water.enabled !== 'boolean' ||
    !['soil_1_moisture', 'soil_2_moisture'].includes(String(water.sensorKey)) ||
    !waterNumbers.every(isNullableFiniteNumber) ||
    !isIntegerInRange(water.triggerSampleCount, 1, 20) ||
    !isIntegerInRange(water.sensorStaleSeconds, 10, 3600) ||
    typeof fertilizer.enabled !== 'boolean' ||
    fertilizer.sensorKey !== 'liquid_ec_us_cm' ||
    !fertilizerNumbers.every(isNullableFiniteNumber) ||
    !isIntegerInRange(fertilizer.triggerSampleCount, 1, 20) ||
    !isIntegerInRange(fertilizer.sensorStaleSeconds, 10, 3600)
  ) return false;

  if (
    !isNullableNumberInRange(water.moistureLowPercent, 0, 100) ||
    !isNullableNumberInRange(water.moistureTargetPercent, 0, 100) ||
    !isNullableNumberInRange(water.maxRuntimeSeconds, 1, 86400) ||
    !isNullableNumberInRange(water.cooldownSeconds, 0, 86400) ||
    !isNullableNumberInRange(water.minTankLevelPercent, 0, 100) ||
    !isNullableNumberInRange(water.minFlowLpm, 0, 10000) ||
    !isNullableNumberInRange(fertilizer.ecLowUsCm, 0, 100000) ||
    !isNullableNumberInRange(fertilizer.ecTargetUsCm, 0, 100000) ||
    !isNullableNumberInRange(fertilizer.ecHighUsCm, 0, 100000) ||
    !isNullableNumberInRange(fertilizer.dosePulseSeconds, 1, 3600) ||
    !isNullableNumberInRange(fertilizer.mixingDelaySeconds, 1, 86400) ||
    !isNullableNumberInRange(fertilizer.cooldownSeconds, 0, 86400) ||
    !isNullableNumberInRange(fertilizer.maxDoseVolumeL, 0.001, 100000) ||
    !isNullableNumberInRange(fertilizer.maxDailyVolumeL, 0.001, 1000000) ||
    !isNullableNumberInRange(fertilizer.minTankLevelPercent, 0, 100) ||
    !isNullableNumberInRange(fertilizer.minFlowLpm, 0, 10000)
  ) return false;

  const waterComplete =
    isNumberInRange(water.moistureLowPercent, 0, 100) &&
    isNumberInRange(water.moistureTargetPercent, 0, 100) &&
    (water.moistureLowPercent as number) < (water.moistureTargetPercent as number) &&
    isNumberInRange(water.maxRuntimeSeconds, 1, 86400) &&
    isNumberInRange(water.cooldownSeconds, 0, 86400) &&
    isNumberInRange(water.minFlowLpm, 0, 10000);
  const fertilizerComplete =
    isNumberInRange(fertilizer.ecLowUsCm, 0, 100000) &&
    isNumberInRange(fertilizer.ecTargetUsCm, 0, 100000) &&
    isNumberInRange(fertilizer.ecHighUsCm, 0, 100000) &&
    (fertilizer.ecLowUsCm as number) < (fertilizer.ecTargetUsCm as number) &&
    (fertilizer.ecTargetUsCm as number) < (fertilizer.ecHighUsCm as number) &&
    isNumberInRange(fertilizer.dosePulseSeconds, 1, 3600) &&
    isNumberInRange(fertilizer.mixingDelaySeconds, 1, 86400) &&
    isNumberInRange(fertilizer.cooldownSeconds, 0, 86400) &&
    isNumberInRange(fertilizer.maxDoseVolumeL, 0.001, 100000) &&
    isNumberInRange(fertilizer.maxDailyVolumeL, 0.001, 1000000) &&
    (fertilizer.maxDoseVolumeL as number) <= (fertilizer.maxDailyVolumeL as number) &&
    isNumberInRange(fertilizer.minFlowLpm, 0, 10000);

  if ((water.enabled && !waterComplete) || (fertilizer.enabled && !fertilizerComplete)) return false;
  return value.desiredMode !== 'automatic' || water.enabled || fertilizer.enabled;
}

export function isAutomaticControlSyncMessage(value: unknown): value is AutomaticControlSyncMessage {
  return isRecord(value) && hasIdentity(value) && value.kind === 'automatic_control_sync' &&
    Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
    isIsoDate(value.generatedAt) && isAutomaticControlConfig(value.config);
}

export function isAutomaticControlAckMessage(value: unknown): value is AutomaticControlAckMessage {
  return isRecord(value) && hasIdentity(value) && value.kind === 'automatic_control_ack' &&
    Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
    isIsoDate(value.acknowledgedAt) &&
    (value.status === 'applied' || value.status === 'rejected') &&
    (value.appliedMode === 'manual' || value.appliedMode === 'automatic') &&
    (value.reason === undefined || typeof value.reason === 'string');
}

export type ApiSensorStatus = 'good' | 'warning' | 'critical' | 'offline';
export type DeviceConnectionStatus = 'online' | 'stale' | 'offline';

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

export type DatalogKind = 'sensor' | 'actuator';

export interface ApiDatalogItem {
  id: string;
  kind: DatalogKind;
  recordedAt: string;
  parameterKey: string;
  displayName: string;
  value: number | null;
  unit: string;
  state: ApiActuator['state'] | null;
  source: ApiActuatorLog['source'] | null;
  reason: string | null;
}

export interface ApiDatalogPage {
  items: ApiDatalogItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
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
  ruleKey: string | null;
  incidentKey: string | null;
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
  resolvedBy: string | null;
  resolutionNote: string | null;
  resolutionType: 'automatic' | 'manual' | null;
  currentValue: number | null;
  thresholdText: string | null;
  unit: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  recommendation: string | null;
  metadata: Record<string, unknown> | null;
}

export type AlarmEventType =
  | 'detected'
  | 'acknowledged'
  | 'escalated'
  | 'recovered'
  | 'resolved'
  | 'note';

export interface ApiAlarmEvent {
  id: string;
  alarmId: string;
  eventType: AlarmEventType;
  fromStatus: ApiAlarm['status'] | null;
  toStatus: ApiAlarm['status'] | null;
  severity: ApiAlarm['severity'];
  value: number | null;
  thresholdText: string | null;
  actor: string | null;
  note: string | null;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ApiAlarmDetail extends ApiAlarm {
  events: ApiAlarmEvent[];
}

export interface ApiAlarmPage {
  items: ApiAlarm[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  counts: {
    open: number;
    acknowledged: number;
    resolved: number;
    criticalActive: number;
  };
}

export interface ApiAlarmActionRequest {
  note?: string;
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

export interface ApiAutomaticControl extends AutomaticControlConfig {
  siteId: string;
  deviceId: string;
  revision: number;
  actualMode: OperatingMode | null;
  publishedRevision: number | null;
  publishedAt: string | null;
  acknowledgedRevision: number | null;
  acknowledgementStatus: 'applied' | 'rejected' | null;
  acknowledgedAt: string | null;
  acknowledgementReason: string | null;
  appliedMode: OperatingMode | null;
  updatedBy: string;
  updatedAt: string;
}

export type ApiAutomaticControlUpdateRequest = AutomaticControlConfig;

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
  automaticControl: ApiAutomaticControl | null;
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

export interface DeleteUserResult {
  userId: string;
  username: string;
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
export * from './smartSoil.js'
