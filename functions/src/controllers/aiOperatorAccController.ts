import type { Request, Response } from 'express';
import { aiOperatorAccRequestSchema, unifiedAiDashboardSchema } from '@spff/contracts';
import { checkOperatorAccDryRun } from '../services/aiOperatorAcc.js';

// Auth + requireOperator + CSRF are enforced by the operational API router.
// The unauthenticated localhost AI preview deliberately does NOT mount this POST.
export async function postAiOperatorAccDryRun(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const parsedRequest = aiOperatorAccRequestSchema.safeParse(req.body);
  if (!parsedRequest.success) {
    res.status(400).json({
      success: false, data: null, message: 'Konfirmasi ACC dry-run tidak valid.',
    });
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch('http://127.0.0.1:5011/dashboard/summary', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: abort.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      res.status(503).json({
        success: false, data: null, message: 'Sumber AI tidak tersedia; ACC tidak diproses.',
      });
      return;
    }
    const source = unifiedAiDashboardSchema.safeParse(await response.json());
    if (!source.success) {
      res.status(503).json({
        success: false, data: null, message: 'Snapshot AI tidak valid; ACC tidak diproses.',
      });
      return;
    }
    const result = checkOperatorAccDryRun(source.data, parsedRequest.data, new Date());
    res.status(200).json({
      success: true, data: result,
      message: 'Pemeriksaan ACC selesai: BLOCKED. Tidak ada command atau MQTT publish.',
    });
  } catch {
    res.status(503).json({
      success: false, data: null, message: 'AI tidak terjangkau; ACC tidak diproses.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
