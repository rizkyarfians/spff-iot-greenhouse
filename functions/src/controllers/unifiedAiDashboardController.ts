import type {Request, Response} from 'express';
import {unifiedAiDashboardSchema} from '@spff/contracts';

// The operational API reads the production AI on loopback only.
 // The independent DEV preview routes retain their own Python port (5011).
import { localAiUrl } from '../services/localAiEndpoint.js';
const LOCAL_AI = localAiUrl('/dashboard/summary');

export async function getUnifiedAiDashboard(
  _req: Request, res: Response,
): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(LOCAL_AI, {
      method: 'GET', signal: abort.signal,
      headers: {Accept: 'application/json'},
      redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) {
      res.set('Cache-Control', 'no-store').status(503).json({
        success: false, data: null,
        message: 'Unified AI belum tersedia. Periksa service Python dan polling data.',
      });
      return;
    }
    const payload: unknown = await response.json();
    const parsed = unifiedAiDashboardSchema.safeParse(payload);
    if (!parsed.success) {
      res.set('Cache-Control', 'no-store').status(503).json({
        success: false, data: null,
        message: 'Format laporan Unified AI belum kompatibel.',
      });
      return;
    }
    res.set('Cache-Control', 'no-store').json({
      success: true, data: parsed.data,
      message: 'Laporan SHADOW Unified AI dari PostgreSQL lokal.',
    });
  } catch {
    res.set('Cache-Control', 'no-store').status(503).json({
      success: false, data: null,
      message: 'Tidak dapat membaca service Unified AI lokal.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
