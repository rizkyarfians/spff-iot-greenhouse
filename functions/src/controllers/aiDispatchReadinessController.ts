import type { Request, Response } from 'express';
import { unifiedAiDashboardSchema } from '@spff/contracts';
import { assessAiDispatchReadiness } from '../services/aiDispatchReadiness.js';

// Fixed loopback STAGING source only. Never accept a URL supplied by a browser.
// No POST handler, persistence, command queue insertion, or MQTT publish.
const LOCAL_AI_SUMMARY_URL = 'http://127.0.0.1:5011/dashboard/summary';

export async function getAiDispatchReadiness(_req: Request, res: Response): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  res.set('Cache-Control', 'no-store');
  try {
    const response = await fetch(LOCAL_AI_SUMMARY_URL, {
      method: 'GET',
      signal: abort.signal,
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      res.status(503).json({
        success: false, data: null, message: 'Standalone AI staging tidak tersedia.',
      });
      return;
    }
    const data: unknown = await response.json();
    const result = unifiedAiDashboardSchema.safeParse(data);
    if (!result.success) {
      res.status(503).json({
        success: false, data: null, message: 'Kontrak laporan Standalone AI tidak valid.',
      });
      return;
    }
    res.json({
      success: true,
      data: assessAiDispatchReadiness(result.data),
      message: 'Preflight AI read-only; tidak ada command yang dibuat.',
    });
  } catch {
    res.status(503).json({
      success: false, data: null, message: 'Tidak dapat membaca Standalone AI lokal.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
