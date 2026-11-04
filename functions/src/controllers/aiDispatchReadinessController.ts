import type { Request, Response } from 'express';
import { unifiedAiDashboardSchema } from '@spff/contracts';
import { assessAiDispatchReadiness } from '../services/aiDispatchReadiness.js';
import { localAiPort } from '../services/localAiEndpoint.js';

// Loopback source only. The optional port comes from trusted server configuration,
// never from HTTP input. No POST handler, persistence, queue insertion, or MQTT.
export function createAiDispatchReadinessController(pythonPort: number) {
  const localAiSummaryUrl = `http://127.0.0.1:${pythonPort}/dashboard/summary`;
  return async function getReadiness(_req: Request, res: Response): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  res.set('Cache-Control', 'no-store');
  try {
    const response = await fetch(localAiSummaryUrl, {
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
  };
}

// Authenticated operational API connects to the production AI loopback port.
export const getAiDispatchReadiness = createAiDispatchReadinessController(localAiPort());
