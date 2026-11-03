import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { unifiedAiDashboardSchema } from '@spff/contracts';
import { prepareAiCommandPreview } from '../services/aiCommandPreparation.js';

// Trusted, numeric server configuration only; never accept arbitrary remote URLs.
export function createAiCommandPreparationController(pythonPort: number) {
  if (!Number.isInteger(pythonPort) || pythonPort < 1024 || pythonPort > 65535) {
    throw new Error('Invalid local Python AI port');
  }
  const url = `http://127.0.0.1:${pythonPort}/dashboard/summary`;

  return async function getAiCommandPreparation(_req: Request, res: Response): Promise<void> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    res.set('Cache-Control', 'no-store');
    try {
      const response = await fetch(url, {
        method: 'GET', headers: { Accept: 'application/json' },
        signal: abort.signal, redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) {
        res.status(503).json({
          success: false, data: null, message: 'Sumber AI lokal tidak tersedia.',
        });
        return;
      }
      const source: unknown = await response.json();
      const parsed = unifiedAiDashboardSchema.safeParse(source);
      if (!parsed.success) {
        res.status(503).json({
          success: false, data: null, message: 'Kontrak sumber AI tidak valid.',
        });
        return;
      }
      res.json({
        success: true,
        data: prepareAiCommandPreview(parsed.data, randomUUID(), new Date()),
        message: 'Hanya draft tampilan; tidak ada command atau approval.',
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

// Operational API uses authentication/role middleware in routes/index.ts.
export const getAiCommandPreparation = createAiCommandPreparationController(5011);
