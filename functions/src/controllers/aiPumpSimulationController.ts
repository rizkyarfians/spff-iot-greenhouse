import type { Request, Response } from 'express';
import { unifiedAiDashboardSchema } from '@spff/contracts';
import { prepareAiPumpSimulation } from '../services/aiPumpSimulation.js';

// Loopback Python staging only. No URL override, database, queue or MQTT client.
const LOCAL_AI = 'http://127.0.0.1:5011/dashboard/summary';

export async function getAiPumpSimulation(_req: Request, res: Response): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  res.set('Cache-Control', 'no-store');
  try {
    const response = await fetch(LOCAL_AI, {
      method: 'GET', signal: controller.signal,
      headers: { Accept: 'application/json' },
      redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) {
      res.status(503).json({
        success: false, data: null, message: 'Standalone AI staging tidak tersedia.',
      });
      return;
    }
    const parsed = unifiedAiDashboardSchema.safeParse(await response.json() as unknown);
    if (!parsed.success) {
      res.status(503).json({
        success: false, data: null, message: 'Kontrak SHADOW AI tidak valid.',
      });
      return;
    }
    res.json({
      success: true, data: prepareAiPumpSimulation(parsed.data),
      message: 'Simulasi konversi Fuzzy ke protokol trial saja; tidak mengirim command.',
    });
  } catch {
    res.status(503).json({
      success: false, data: null, message: 'Gagal membaca Standalone AI lokal.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
