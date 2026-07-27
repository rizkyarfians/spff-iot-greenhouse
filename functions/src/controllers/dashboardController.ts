import type { Request, Response } from 'express';
import { repository } from '../services/mockRepository.js';

const ok = <T>(res: Response, data: T, message: string) => res.json({ success: true, data, message });
export const dashboard = (_req: Request, res: Response) => ok(res, repository.dashboard(), 'Ringkasan dashboard berhasil dimuat.');
export const getSensors = (_req: Request, res: Response) => ok(res, repository.sensors(), 'Data sensor berhasil dimuat.');
export const getHistory = (req: Request, res: Response) => {
  const types = ['ph','ec','temperature','soilMoisture','waterTank','nutrientTank'] as const;
  const type = String(req.query.type ?? 'ph');
  if (!types.includes(type as typeof types[number])) return res.status(400).json({ success: false, message: 'Tipe sensor tidak didukung.', errors: ['type'] });
  return ok(res, repository.history(type as typeof types[number]), `Riwayat sensor ${type} berhasil dimuat.`);
};
export const getPumps = (_req: Request, res: Response) => ok(res, repository.pumps(), 'Data pompa berhasil dimuat.');
export const updatePump = (req: Request, res: Response) => {
  if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ success: false, message: 'isActive harus berupa boolean.', errors: ['isActive'] });
  const pump = repository.updatePump(String(req.params.id), req.body.isActive);
  if (!pump) return res.status(404).json({ success: false, message: 'Pompa tidak ditemukan.', errors: [] });
  return ok(res, pump, `${pump.name} berhasil diperbarui.`);
};
export const getAlarms = (req: Request, res: Response) => {
  const severity = req.query.severity as 'info'|'warning'|'critical'|undefined;
  if (severity && !['info','warning','critical'].includes(severity)) return res.status(400).json({ success: false, message: 'Severity tidak valid.', errors: ['severity'] });
  const acknowledged = req.query.acknowledged === undefined ? undefined : req.query.acknowledged === 'true';
  const limit = req.query.limit ? Math.max(1, Math.min(Number(req.query.limit), 100)) : undefined;
  return ok(res, repository.alarms({ severity, acknowledged, limit }), 'Data alarm berhasil dimuat.');
};
export const acknowledgeAlarm = (req: Request, res: Response) => {
  const alarm = repository.acknowledge(String(req.params.id));
  if (!alarm) return res.status(404).json({ success: false, message: 'Alarm tidak ditemukan.', errors: [] });
  return ok(res, alarm, 'Alarm sudah ditandai diketahui.');
};
export const getSchedules = (_req: Request, res: Response) => ok(res, repository.schedules(), 'Data jadwal berhasil dimuat.');
