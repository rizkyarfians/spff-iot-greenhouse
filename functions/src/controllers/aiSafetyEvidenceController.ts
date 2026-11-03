import type { Request, Response } from 'express';
import { assessAiSafetyEvidence } from '../services/aiSafetyGates.js';
import { getAiSafetyDatabaseConfig, loadAiSafetyRows } from '../services/aiSafetyPgRepository.js';

/** No HTTP inputs, no SQL changes, no command queue calls. */
export async function getAiSafetyEvidence(_req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const config = getAiSafetyDatabaseConfig(process.env);
  if (!config.configured) {
    res.json({
      success: true,
      data: assessAiSafetyEvidence(config.siteId, config.deviceId, null, new Date(), 'NOT_CONFIGURED'),
      message: 'Sumber PostgreSQL safety belum dikonfigurasi; semua gate tetap tertutup.',
    });
    return;
  }
  try {
    const rows = await loadAiSafetyRows(config);
    res.json({
      success: true,
      data: assessAiSafetyEvidence(config.siteId, config.deviceId, rows, new Date(), 'POSTGRES_READ_ONLY'),
      message: 'Observasi keselamatan PostgreSQL read-only, bukan izin kontrol.',
    });
  } catch {
    res.json({
      success: true,
      data: assessAiSafetyEvidence(config.siteId, config.deviceId, null, new Date(), 'UNAVAILABLE'),
      message: 'PostgreSQL safety tidak dapat dibaca; semua gate tetap tertutup.',
    });
  }
}
