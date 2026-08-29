import type {
  ActuatorStateMessage,
  CommandAckMessage,
  DeviceStatusMessage,
  TelemetryMessage,
} from "@spff/contracts";

export type AlarmComparator =
  | "lt"
  | "gt"
  | "fault"
  | "offline"
  | "stale"
  | "failed";

export interface AlarmRule {
  siteId: string;
  ruleKey: string;
  sourceType: "sensor" | "actuator" | "system";
  sourceKey: string;
  comparator: AlarmComparator;
  thresholdValue: number | null;
  unit: string | null;
  enabled: boolean;
}

export interface AlarmObservation {
  siteId: string;
  deviceId: string;
  ruleKey: string;
  incidentKey: string;
  sourceKey: string;
  violating: boolean;
  observedAt: string;
  currentValue: number | null;
  thresholdText: string | null;
  metadata: Record<string, unknown>;
}

export interface AlarmHealthSubject {
  siteId: string;
  deviceId: string;
  deviceOnline: boolean | null;
  deviceAgeSeconds: number | null;
  telemetryAgeSeconds: number | null;
  latestRecordedAt: string | null;
  sensors: Partial<Record<string, number | null>>;
}

export interface AlarmCommandSubject {
  siteId: string;
  deviceId: string;
  targetId: string;
  commandId: string;
  status: "completed" | "rejected" | "timed_out" | "failed";
  reason: string | null;
  updatedAt: string;
}

export interface AlarmRepository {
  alarmRules(siteId: string): Promise<AlarmRule[]>;
  applyAlarmObservation(observation: AlarmObservation): Promise<void>;
  alarmHealthSubjects(): Promise<AlarmHealthSubject[]>;
  alarmCommandSubjects(): Promise<AlarmCommandSubject[]>;
}

export interface AlarmIngestionObserver {
  evaluateTelemetry(message: TelemetryMessage): Promise<void>;
  evaluateAcknowledgement(message: CommandAckMessage): Promise<void>;
  evaluateActuatorState(message: ActuatorStateMessage): Promise<void>;
  evaluateDeviceStatus(message: DeviceStatusMessage): Promise<void>;
}

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const alarmThresholdText = (rule: AlarmRule): string | null =>
  rule.thresholdValue === null
    ? null
    : [rule.comparator === "lt" ? "<" : ">", rule.thresholdValue, rule.unit]
        .filter((part) => part !== null && part !== "")
        .join(" ");

export function evaluateNumericAlarmRule(
  rule: AlarmRule,
  value: number | null,
): boolean | null {
  if (!rule.enabled || value === null || rule.thresholdValue === null) return null;
  if (rule.comparator === "lt") return value < rule.thresholdValue;
  if (rule.comparator === "gt") return value > rule.thresholdValue;
  return null;
}

const observation = (
  rule: AlarmRule,
  input: {
    deviceId: string;
    incidentKey?: string;
    sourceKey?: string;
    violating: boolean;
    observedAt: string;
    currentValue?: number | null;
    thresholdText?: string | null;
    metadata?: Record<string, unknown>;
  },
): AlarmObservation => ({
  siteId: rule.siteId,
  deviceId: input.deviceId,
  ruleKey: rule.ruleKey,
  incidentKey: input.incidentKey ?? rule.ruleKey,
  sourceKey: input.sourceKey ?? rule.sourceKey,
  violating: input.violating,
  observedAt: input.observedAt,
  currentValue: input.currentValue ?? null,
  thresholdText: input.thresholdText ?? alarmThresholdText(rule),
  metadata: input.metadata ?? {},
});

export class AlarmEvaluator implements AlarmIngestionObserver {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: AlarmRepository,
    private readonly pollIntervalMs = 15_000,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async evaluateTelemetry(message: TelemetryMessage): Promise<void> {
    const rules = await this.repository.alarmRules(message.siteId);
    const sensors = message.sensors as Partial<Record<string, number>>;
    const observedAt = message.recordedAt;

    for (const rule of rules) {
      if (rule.sourceType !== "sensor") continue;
      const value = finiteNumber(sensors[rule.sourceKey]);
      const violating = evaluateNumericAlarmRule(rule, value);
      if (violating === null) continue;
      await this.repository.applyAlarmObservation(
        observation(rule, {
          deviceId: message.deviceId,
          violating,
          observedAt,
          currentValue: value,
          metadata: {
            messageId: message.messageId,
            sequence: message.sequence,
          },
        }),
      );
    }

    const telemetryRule = rules.find((rule) => rule.ruleKey === "telemetry_stopped");
    if (telemetryRule) {
      await this.repository.applyAlarmObservation(
        observation(telemetryRule, {
          deviceId: message.deviceId,
          violating: false,
          observedAt,
          currentValue: 0,
          metadata: { messageId: message.messageId },
        }),
      );
    }
  }

  async evaluateAcknowledgement(message: CommandAckMessage): Promise<void> {
    if (message.status === "accepted") return;
    const rules = await this.repository.alarmRules(message.siteId);
    const rule = rules.find((candidate) => candidate.ruleKey === "command_failed");
    if (!rule) return;
    const violating =
      message.status === "rejected" || message.status === "timed_out";
    await this.repository.applyAlarmObservation(
      observation(rule, {
        deviceId: message.deviceId,
        incidentKey: ["command_failed", message.targetId].join(":"),
        sourceKey: message.targetId,
        violating,
        observedAt: message.acknowledgedAt,
        metadata: {
          commandId: message.commandId,
          commandStatus: message.status,
          reason: message.reason ?? null,
        },
      }),
    );
  }

  async evaluateActuatorState(message: ActuatorStateMessage): Promise<void> {
    const rules = await this.repository.alarmRules(message.siteId);
    const rule = rules.find((candidate) => candidate.ruleKey === "actuator_fault");
    if (!rule) return;
    await this.repository.applyAlarmObservation(
      observation(rule, {
        deviceId: message.deviceId,
        incidentKey: ["actuator_fault", message.targetId].join(":"),
        sourceKey: message.targetId,
        violating: message.state === "fault" || message.state === "offline",
        observedAt: message.recordedAt,
        metadata: {
          messageId: message.messageId,
          actuatorState: message.state,
          isActive: message.isActive,
          reason: message.reason ?? null,
        },
      }),
    );
  }

  async evaluateDeviceStatus(message: DeviceStatusMessage): Promise<void> {
    const rules = await this.repository.alarmRules(message.siteId);
    const rule = rules.find((candidate) => candidate.ruleKey === "device_offline");
    if (!rule) return;
    await this.repository.applyAlarmObservation(
      observation(rule, {
        deviceId: message.deviceId,
        violating: !message.online,
        observedAt: message.recordedAt,
        currentValue: message.online ? 0 : rule.thresholdValue,
        metadata: {
          firmwareVersion: message.firmwareVersion ?? null,
          systemState: message.systemState ?? null,
        },
      }),
    );
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const subjects = await this.repository.alarmHealthSubjects();
      for (const subject of subjects) {
        const rules = await this.repository.alarmRules(subject.siteId);
        const observedAt = new Date().toISOString();
        for (const rule of rules) {
          if (rule.sourceType === "sensor") {
            const value = finiteNumber(subject.sensors[rule.sourceKey]);
            const violating = evaluateNumericAlarmRule(rule, value);
            if (violating === null) continue;
            await this.repository.applyAlarmObservation(
              observation(rule, {
                deviceId: subject.deviceId,
                violating,
                observedAt: subject.latestRecordedAt ?? observedAt,
                currentValue: value,
                metadata: { source: "health-scan" },
              }),
            );
            continue;
          }

          if (rule.ruleKey === "device_offline" && rule.thresholdValue !== null) {
            const age = subject.deviceAgeSeconds;
            await this.repository.applyAlarmObservation(
              observation(rule, {
                deviceId: subject.deviceId,
                violating:
                  subject.deviceOnline !== true ||
                  age === null ||
                  age > rule.thresholdValue,
                observedAt,
                currentValue: age,
                metadata: { source: "health-scan" },
              }),
            );
          }

          if (rule.ruleKey === "telemetry_stopped" && rule.thresholdValue !== null) {
            const age = subject.telemetryAgeSeconds;
            await this.repository.applyAlarmObservation(
              observation(rule, {
                deviceId: subject.deviceId,
                violating: age === null || age > rule.thresholdValue,
                observedAt,
                currentValue: age,
                metadata: { source: "health-scan" },
              }),
            );
          }
        }
      }

      const commands = await this.repository.alarmCommandSubjects();
      for (const command of commands) {
        const rules = await this.repository.alarmRules(command.siteId);
        const rule = rules.find(
          (candidate) => candidate.ruleKey === "command_failed",
        );
        if (!rule) continue;
        await this.repository.applyAlarmObservation(
          observation(rule, {
            deviceId: command.deviceId,
            incidentKey: ["command_failed", command.targetId].join(":"),
            sourceKey: command.targetId,
            violating:
              command.status === "rejected" ||
              command.status === "timed_out" ||
              command.status === "failed",
            observedAt: command.updatedAt,
            metadata: {
              source: "health-scan",
              commandId: command.commandId,
              commandStatus: command.status,
              reason: command.reason,
            },
          }),
        );
      }
    } catch (error) {
      console.error("[alarm-evaluator] Health cycle failed", error);
    } finally {
      this.running = false;
    }
  }
}
