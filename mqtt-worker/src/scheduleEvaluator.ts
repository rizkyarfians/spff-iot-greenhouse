import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type {
  ActuatorSchedule,
  ScheduleAction,
  ScheduleRepository,
  ScheduledCommandRequest,
} from "./repository.js";

type LocalDate = {
  year: number;
  month: number;
  day: number;
};

type LocalDateTime = LocalDate & {
  hour: number;
  minute: number;
  second: number;
};

type DueOccurrence = {
  schedule: ActuatorSchedule;
  action: ScheduleAction;
  requestedIsActive: boolean;
  scheduledFor: Date;
};

type ScheduleEvaluatorOptions = {
  pollIntervalMs: number;
  lookbackSeconds: number;
  commandExpirySeconds: number;
};

const defaultOptions: ScheduleEvaluatorOptions = {
  pollIntervalMs: config.schedule.pollIntervalMs,
  lookbackSeconds: config.schedule.lookbackSeconds,
  commandExpirySeconds: config.schedule.commandExpirySeconds,
};

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

const localParts = (date: Date, timeZone: string): LocalDateTime => {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const read = (key: Intl.DateTimeFormatPartTypes) => {
    const value = Number(values.get(key));
    if (!Number.isInteger(value)) {
      throw new Error(`Unable to resolve ${key} in timezone ${timeZone}.`);
    }
    return value;
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
};

const localDateToKey = ({ year, month, day }: LocalDate) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const addCalendarDays = (date: LocalDate, days: number): LocalDate => {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

const weekday = (date: LocalDate) =>
  new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

const recurrenceMatches = (schedule: ActuatorSchedule, date: LocalDate) => {
  if (schedule.repeatRule === "once") {
    return schedule.onceDate === localDateToKey(date);
  }

  const day = weekday(date);
  if (schedule.repeatRule === "weekdays") return day >= 1 && day <= 5;
  if (schedule.repeatRule === "weekends") return day === 0 || day === 6;
  return true;
};

const timeParts = (time: string) => {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) throw new Error(`Unsupported schedule time: ${time}.`);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? 0),
  };
};

const secondsOfDay = (time: string) => {
  const parts = timeParts(time);
  return parts.hour * 3600 + parts.minute * 60 + parts.second;
};

/**
 * Converts a wall-clock date/time in an IANA timezone to an absolute Date.
 * The iterative correction keeps this dependency-free while still handling
 * timezone offsets (and ordinary DST transitions) correctly.
 */
const zonedDateTimeToDate = (date: LocalDate, time: string, timeZone: string) => {
  const clock = timeParts(time);
  const targetUtcLike = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  let guess = targetUtcLike;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const rendered = localParts(new Date(guess), timeZone);
    const renderedUtcLike = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    const correction = targetUtcLike - renderedUtcLike;
    if (correction === 0) break;
    guess += correction;
  }

  const result = new Date(guess);
  const rendered = localParts(result, timeZone);
  if (
    rendered.year !== date.year ||
    rendered.month !== date.month ||
    rendered.day !== date.day ||
    rendered.hour !== clock.hour ||
    rendered.minute !== clock.minute ||
    rendered.second !== clock.second
  ) {
    throw new Error(
      `Local schedule time ${localDateToKey(date)} ${time} is invalid or ambiguous in timezone ${timeZone}.`,
    );
  }

  return result;
};

const candidateStartDates = (
  now: Date,
  timeZone: string,
  lookbackSeconds: number,
) => {
  const current = localParts(now, timeZone);
  const today: LocalDate = {
    year: current.year,
    month: current.month,
    day: current.day,
  };
  const daysBack = Math.ceil(lookbackSeconds / 86_400) + 2;
  const dates: LocalDate[] = [];
  for (let offset = 0; offset <= daysBack; offset += 1) {
    dates.push(addCalendarDays(today, -offset));
  }
  return dates;
};

const occurrencesForSchedule = (
  schedule: ActuatorSchedule,
  now: Date,
  lookbackSeconds: number,
): DueOccurrence[] => {
  const windowStart = now.getTime() - lookbackSeconds * 1000;
  const due: DueOccurrence[] = [];

  for (const startDate of candidateStartDates(
    now,
    schedule.timezone,
    lookbackSeconds,
  )) {
    if (!recurrenceMatches(schedule, startDate)) continue;

    const onAt = zonedDateTimeToDate(
      startDate,
      schedule.onTime,
      schedule.timezone,
    );
    if (onAt.getTime() >= windowStart && onAt.getTime() <= now.getTime()) {
      due.push({
        schedule,
        action: "on",
        requestedIsActive: true,
        scheduledFor: onAt,
      });
    }

    let offAt: Date | null = null;
    if (schedule.offTime) {
      const offDate =
        secondsOfDay(schedule.offTime) <= secondsOfDay(schedule.onTime)
          ? addCalendarDays(startDate, 1)
          : startDate;
      offAt = zonedDateTimeToDate(
        offDate,
        schedule.offTime,
        schedule.timezone,
      );
    } else if (schedule.durationSeconds !== null) {
      offAt = new Date(onAt.getTime() + schedule.durationSeconds * 1000);
    }

    if (
      offAt &&
      offAt.getTime() >= windowStart &&
      offAt.getTime() <= now.getTime()
    ) {
      due.push({
        schedule,
        action: "off",
        requestedIsActive: false,
        scheduledFor: offAt,
      });
    }
  }

  return due;
};

export class ScheduleEvaluator {
  private timer: NodeJS.Timeout | null = null;
  private tickRunning = false;
  private stopped = true;

  constructor(
    private readonly repository: ScheduleRepository,
    private readonly options: ScheduleEvaluatorOptions = defaultOptions,
    private readonly commandIdFactory: () => string = randomUUID,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      this.options.pollIntervalMs,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(now = new Date()): Promise<void> {
    const schedules = await this.repository.enabledSchedules();

    for (const schedule of schedules) {
      try {
        const occurrences = occurrencesForSchedule(
          schedule,
          now,
          this.options.lookbackSeconds,
        );
        if (occurrences.length === 0) continue;

        // If the worker was offline long enough to miss both ON and OFF, only
        // apply the newest desired state. Turning a pump ON just to immediately
        // turn it OFF during catch-up is unsafe and unnecessary.
        const occurrence = occurrences.reduce((latest, candidate) =>
          candidate.scheduledFor.getTime() > latest.scheduledFor.getTime()
            ? candidate
            : latest,
        );

        const issuedAt = now.toISOString();
        const request: ScheduledCommandRequest = {
          commandId: this.commandIdFactory(),
          scheduleId: schedule.scheduleId,
          siteId: schedule.siteId,
          deviceId: schedule.deviceId,
          actuatorKey: schedule.actuatorKey,
          action: occurrence.action,
          requestedIsActive: occurrence.requestedIsActive,
          scheduledFor: occurrence.scheduledFor.toISOString(),
          issuedAt,
          expiresAt: new Date(
            now.getTime() + this.options.commandExpirySeconds * 1000,
          ).toISOString(),
          repeatRule: schedule.repeatRule,
          timezone: schedule.timezone,
        };

        const created = await this.repository.createScheduledCommand(request);
        if (created) {
          console.log("[schedule-evaluator] command created", {
            scheduleId: schedule.scheduleId,
            commandId: request.commandId,
            siteId: schedule.siteId,
            deviceId: schedule.deviceId,
            targetId: schedule.actuatorKey,
            action: occurrence.action,
            scheduledFor: request.scheduledFor,
          });
        }
      } catch (error) {
        console.error("[schedule-evaluator] schedule evaluation failed", {
          scheduleId: schedule.scheduleId,
          error,
        });
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.tickRunning || this.stopped) return;
    this.tickRunning = true;
    try {
      await this.runOnce();
    } catch (error) {
      console.error("[schedule-evaluator] Tick failed", error);
    } finally {
      this.tickRunning = false;
    }
  }
}
