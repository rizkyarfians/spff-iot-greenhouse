import type { NextFunction, Request, Response } from 'express';
import type { ScheduleRepeatRule } from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import {
  ActuatorBusyError,
  CommandIdConflictError,
  repository,
  type SiteSettingsInput,
} from '../services/postgresRepository.js';

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
  return ok(res, await repository.bootstrap(), 'Data awal greenhouse berhasil dimuat.');
});

export const dashboard = run(async (_req, res) => {
  return ok(res, await repository.dashboard(), 'Ringkasan dashboard berhasil dimuat.');
});

export const getSensors = run(async (_req, res) => {
  return ok(res, await repository.sensors(), 'Data sensor berhasil dimuat.');
});

export const getHistory = run(async (req, res) => {
  const type = String(req.query.type ?? 'soil_1_moisture');
  const data = await repository.history(type);
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
  const acknowledged = req.query.acknowledged === undefined ? undefined : req.query.acknowledged === 'true';
  const requestedLimit = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 100;
  return ok(res, await repository.alarms({ severity, acknowledged, limit }), 'Data alarm berhasil dimuat.');
});

export const acknowledgeAlarm = run(async (req, res) => {
  const alarm = await repository.acknowledge(String(req.params.id), requestActor(req));
  if (!alarm) {
    return res.status(404).json({ success: false, message: 'Alarm aktif tidak ditemukan.', errors: [] });
  }
  return ok(res, alarm, 'Alarm sudah ditandai diketahui.');
});

export const resolveAlarm = run(async (req, res) => {
  const alarm = await repository.resolve(String(req.params.id));
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
