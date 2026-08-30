import type { NextFunction, Request, Response } from 'express';
import type { HistoryBucket, ScheduleRepeatRule } from '@spff/contracts';
import { isAutomaticControlConfig, selectedCropInputSchema } from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import {
  ActuatorBusyError,
  AutomaticModeConflictError,
  CommandIdConflictError,
  configuredSiteId,
  repository,
  type SiteSettingsInput,
} from '../services/postgresRepository.js';
import {
  subscribeRealtimeEvents,
} from '../services/realtimeEventHub.js';

type AsyncController = (req: Request, res: Response) => Promise<Response | void>;

const run = (controller: AsyncController) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await controller(req, res);
    } catch (error) {
      next(error);
    }
  };

const ok = <T>(res: Response, data: T, message: string) =>
  res.json({ success: true, data, message });

const isTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

const historyBucketMinutes: Record<HistoryBucket, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '6h': 360,
};

const isHistoryBucket = (value: string): value is HistoryBucket =>
  Object.hasOwn(historyBucketMinutes, value);

const optionalQueryDate = (value: unknown) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const asNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
};

export const readiness = run(async (_req, res) => {
  const status = await repository.readiness();
  return res.status(status.ready ? 200 : 503).json({
    success: status.ready,
    data: status,
    message: status.ready ? 'API dan PostgreSQL siap.' : 'PostgreSQL terhubung, tetapi schema belum lengkap.',
    errors: status.ready ? [] : ['database-schema'],
  });
});

export const bootstrap = run(async (_req, res) => {
  return ok(res, await repository.bootstrap(), 'Data awal fertigasi berhasil dimuat.');
});

export const getLatestTelemetry = run(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return ok(
    res,
    await repository.telemetrySnapshot(),
    'Snapshot telemetry terbaru berhasil dimuat dari PostgreSQL.',
  );
});

export const streamEvents = run(async (_req, res) => {
  res.status(200);
  res.set({
    'Cache-Control': 'private, no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  res.write(`event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);

  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (
      event.siteId !== configuredSiteId
      || res.writableEnded
      || res.destroyed
    ) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
  }, 15_000);
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  res.once('close', cleanup);
  res.once('error', cleanup);
});

export const dashboard = run(async (_req, res) => {
  return ok(res, await repository.dashboard(), 'Ringkasan dashboard berhasil dimuat.');
});

export const getSensors = run(async (_req, res) => {
  return ok(res, await repository.sensors(), 'Data sensor berhasil dimuat.');
});

export const getHistory = run(async (req, res) => {
  const type = String(req.query.type ?? 'soil_1_moisture');
  const bucket = String(req.query.bucket ?? '5m');
  if (!isHistoryBucket(bucket)) {
    return res.status(400).json({
      success: false,
      message: 'Bucket history tidak didukung.',
      errors: ['bucket'],
    });
  }

  const requestedHours = Number(req.query.hours ?? 6);
  const hours = Number.isInteger(requestedHours) ? requestedHours : Number.NaN;
  const requestedTo = optionalQueryDate(req.query.to);
  const requestedFrom = optionalQueryDate(req.query.from);
  if (
    requestedTo === null ||
    requestedFrom === null ||
    !Number.isFinite(hours) ||
    hours < 1 ||
    hours > 168 ||
    (requestedFrom !== undefined && requestedTo === undefined)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Filter tanggal, jam, atau durasi history tidak valid.',
      errors: ['from', 'to', 'hours'],
    });
  }

  const to = requestedTo;
  const from = requestedFrom
    ?? (to ? new Date(to.getTime() - (hours * 60 * 60 * 1000)) : undefined);
  const bucketMinutes = historyBucketMinutes[bucket];
  const rangeMs = from && to
    ? to.getTime() - from.getTime()
    : hours * 60 * 60 * 1000;
  const pointCount = rangeMs / (bucketMinutes * 60 * 1000);

  if (
    !Number.isFinite(rangeMs) ||
    rangeMs <= 0 ||
    rangeMs > 31 * 24 * 60 * 60 * 1000 ||
    pointCount > 500
  ) {
    return res.status(400).json({
      success: false,
      message: 'Range history tidak valid atau menghasilkan terlalu banyak titik.',
      errors: ['from', 'to', 'bucket'],
    });
  }

  const data = await repository.history(type, {
    from,
    to,
    hours,
    bucket,
    bucketMinutes,
  });
  if (!data) {
    return res.status(400).json({
      success: false,
      message: 'Tipe sensor tidak didukung.',
      errors: ['type'],
    });
  }
  return ok(res, data, `Riwayat sensor ${type} berhasil dimuat.`);
});

export const getPumps = run(async (_req, res) => {
  return ok(res, await repository.pumps(), 'Data aktuator berhasil dimuat.');
});

export const getSmartSoil = run(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return ok(res, await repository.smartSoil(), 'Snapshot Smart Soil berhasil dimuat.');
});

export const updateSmartSoilSelection = run(async (req, res) => {
  const parsed = selectedCropInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Pilihan tanaman tidak valid.',
      errors: parsed.error.issues.map((issue) => issue.path.join('.') || issue.message),
    });
  }
  return ok(
    res,
    await repository.updateSmartSoilSelection(parsed.data, requestActor(req)),
    'Pilihan tanaman Smart Soil berhasil disimpan.',
  );
});

export const updatePump = run(async (req, res) => {
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'isActive harus berupa boolean.',
      errors: ['isActive'],
    });
  }
  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(commandId)) {
    return res.status(400).json({
      success: false,
      message: 'commandId wajib diisi untuk idempotency command.',
      errors: ['commandId'],
    });
  }
  try {
    const pump = await repository.updatePump(
      String(req.params.id),
      req.body.isActive,
      requestActor(req),
      commandId,
    );
    if (!pump) {
      return res.status(404).json({
        success: false,
        message: 'Aktuator tidak ditemukan.',
        errors: [],
      });
    }
    return ok(res, pump, `${pump.name} masuk antrean command dan menunggu ACK aktual.`);
  } catch (error) {
    if (error instanceof AutomaticModeConflictError) {
      return res.status(409).json({
        success: false,
        message: 'Command ON manual dikunci saat mode otomatis aktif. Command OFF darurat tetap diizinkan.',
        errors: ['automaticMode'],
      });
    }
    if (error instanceof ActuatorBusyError) {
      return res.status(409).json({
        success: false,
        message: 'Aktuator masih memiliki command yang belum selesai.',
        errors: [error.commandId],
      });
    }
    if (error instanceof CommandIdConflictError) {
      return res.status(409).json({
        success: false,
        message: 'commandId sudah dipakai untuk command yang berbeda.',
        errors: [error.commandId],
      });
    }
    throw error;
  }
});

export const getAlarms = run(async (req, res) => {
  const severity = req.query.severity as 'info' | 'warning' | 'critical' | undefined;
  if (severity && !['info', 'warning', 'critical'].includes(severity)) {
    return res.status(400).json({
      success: false,
      message: 'Severity tidak valid.',
      errors: ['severity'],
    });
  }
  const status = req.query.status as 'open' | 'acknowledged' | 'resolved' | undefined;
  if (status && !['open', 'acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Status alarm tidak valid.',
      errors: ['status'],
    });
  }
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 10);
  if (
    !Number.isInteger(page) || page < 1
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
  ) {
    return res.status(400).json({
      success: false,
      message: 'Pagination alarm tidak valid.',
      errors: ['page', 'pageSize'],
    });
  }
  const query = typeof req.query.query === 'string'
    ? req.query.query.trim().slice(0, 100)
    : undefined;
  return ok(
    res,
    await repository.alarmPage({ severity, status, query, page, pageSize }),
    'Data alarm berhasil dimuat.',
  );
});

export const getAlarmDetail = run(async (req, res) => {
  const alarm = await repository.alarmDetail(String(req.params.id));
  if (!alarm) {
    return res.status(404).json({ success: false, message: 'Alarm tidak ditemukan.', errors: [] });
  }
  return ok(res, alarm, 'Detail alarm berhasil dimuat.');
});

const alarmActionNote = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : null;

export const acknowledgeAlarm = run(async (req, res) => {
  const alarm = await repository.acknowledge(
    String(req.params.id),
    requestActor(req),
    alarmActionNote(req.body?.note),
  );
  if (!alarm) {
    return res.status(404).json({ success: false, message: 'Alarm aktif tidak ditemukan.', errors: [] });
  }
  return ok(res, alarm, 'Alarm sudah ditandai diketahui.');
});

export const resolveAlarm = run(async (req, res) => {
  const alarm = await repository.resolve(
    String(req.params.id),
    requestActor(req),
    alarmActionNote(req.body?.note),
  );
  if (!alarm) {
    return res.status(404).json({ success: false, message: 'Alarm belum selesai tidak ditemukan.', errors: [] });
  }
  return ok(res, alarm, 'Alarm sudah diselesaikan.');
});

export const getSchedules = run(async (_req, res) => {
  return ok(res, await repository.schedules(), 'Jadwal aktuator berhasil dimuat.');
});

export const createSchedule = run(async (req, res) => {
  const repeatRule = req.body?.repeatRule as ScheduleRepeatRule | undefined;
  const runDate = req.body?.runDate ?? null;
  if (
    typeof req.body?.deviceId !== 'string' ||
    typeof req.body?.actuatorKey !== 'string' ||
    !isTime(req.body?.onTime) ||
    !isTime(req.body?.offTime) ||
    !repeatRule ||
    !['daily', 'weekdays', 'weekends', 'once'].includes(repeatRule) ||
    (repeatRule === 'once' && !isDate(runDate)) ||
    (repeatRule !== 'once' && runDate !== null)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Payload jadwal tidak valid.',
      errors: ['deviceId', 'actuatorKey', 'onTime', 'offTime', 'repeatRule', 'runDate'],
    });
  }
  if (req.body.onTime >= req.body.offTime) {
    return res.status(400).json({
      success: false,
      message: 'Jam nonaktif harus setelah jam aktif pada hari yang sama.',
      errors: ['offTime'],
    });
  }
  const schedule = await repository.createSchedule({
    deviceId: req.body.deviceId,
    actuatorKey: req.body.actuatorKey,
    onTime: req.body.onTime,
    offTime: req.body.offTime,
    repeatRule,
    runDate: repeatRule === 'once' ? runDate : null,
    requestedBy: requestActor(req),
  });
  if (!schedule) {
    return res.status(404).json({ success: false, message: 'Aktuator jadwal tidak ditemukan.', errors: [] });
  }
  return res.status(201).json({ success: true, data: schedule, message: 'Jadwal tersimpan di PostgreSQL.' });
});

export const setScheduleEnabled = run(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled harus boolean.', errors: ['enabled'] });
  }
  const schedule = await repository.setScheduleEnabled(String(req.params.id), req.body.enabled);
  if (!schedule) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.', errors: [] });
  return ok(res, schedule, 'Status jadwal berhasil diperbarui.');
});

export const deleteSchedule = run(async (req, res) => {
  const deleted = await repository.deleteSchedule(String(req.params.id));
  if (!deleted) {
    return res.status(409).json({
      success: false,
      message: 'Jadwal tidak ditemukan atau sudah memiliki riwayat eksekusi; nonaktifkan jadwal untuk mempertahankan audit trail.',
      errors: [],
    });
  }
  return ok(res, { id: String(deleted.schedule_id) }, 'Jadwal berhasil dihapus.');
});

export const getDevices = run(async (_req, res) => {
  return ok(res, await repository.devices(), 'Data perangkat berhasil dimuat.');
});

export const getLogs = run(async (_req, res) => {
  return ok(res, await repository.logs(), 'Log sistem berhasil dimuat.');
});

export const getSettings = run(async (_req, res) => {
  return ok(res, await repository.settings(), 'Pengaturan site berhasil dimuat.');
});

export const updateSettings = run(async (req, res) => {
  const input: SiteSettingsInput = {
    greenhouseName: String(req.body?.greenhouseName ?? '').trim(),
    temperatureMin: asNullableNumber(req.body?.temperatureMin),
    temperatureMax: asNullableNumber(req.body?.temperatureMax),
    humidityMin: asNullableNumber(req.body?.humidityMin),
    humidityMax: asNullableNumber(req.body?.humidityMax),
    notifications: req.body?.notifications,
    sound: req.body?.sound,
    autoSchedule: req.body?.autoSchedule,
  };
  const numericValues = [input.temperatureMin, input.temperatureMax, input.humidityMin, input.humidityMax];
  if (
    !input.greenhouseName ||
    numericValues.some((value) => value !== null && !Number.isFinite(value)) ||
    typeof input.notifications !== 'boolean' ||
    typeof input.sound !== 'boolean' ||
    typeof input.autoSchedule !== 'boolean' ||
    (input.temperatureMin !== null && input.temperatureMax !== null && input.temperatureMin > input.temperatureMax) ||
    (input.humidityMin !== null && input.humidityMax !== null && input.humidityMin > input.humidityMax)
  ) {
    return res.status(400).json({ success: false, message: 'Payload pengaturan tidak valid.', errors: ['settings'] });
  }
  const settings = await repository.updateSettings(input);
  if (!settings) return res.status(404).json({ success: false, message: 'Site tidak ditemukan.', errors: [] });
  return ok(res, settings, 'Pengaturan tersimpan di PostgreSQL.');
});

export const getAutomaticControl = run(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return ok(
    res,
    await repository.automaticControl(),
    'Konfigurasi kontrol otomatis berhasil dimuat.',
  );
});

export const updateAutomaticControl = run(async (req, res) => {
  if (!isAutomaticControlConfig(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Konfigurasi kontrol otomatis tidak lengkap atau tidak valid.',
      errors: ['automaticControl'],
    });
  }
  const supportedConfig = {
    ...req.body,
    water: {
      ...req.body.water,
      minTankLevelPercent: null,
    },
    fertilizer: {
      ...req.body.fertilizer,
      minTankLevelPercent: null,
    },
  };
  const config = await repository.updateAutomaticControl(
    supportedConfig,
    requestActor(req),
  );
  if (!config) {
    return res.status(404).json({
      success: false,
      message: 'Tidak ada device aktif untuk menerima konfigurasi.',
      errors: [],
    });
  }
  return ok(
    res,
    config,
    'Konfigurasi tersimpan dan menunggu ACK penerapan dari ESP32.',
  );
});
