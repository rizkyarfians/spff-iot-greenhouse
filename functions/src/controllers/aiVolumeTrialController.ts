import type { Request, Response } from 'express';
import { aiVolumeTrialPreviewInputSchema, unifiedAiDashboardSchema } from '@spff/contracts';
import {
  AiVolumeTrialPreviewBlocked,
  convertAiFuzzyToSoftwareTrial,
} from '../services/aiVolumeTrialConversion.js';

// STAGING, loopback-only source. Never accept a remote AI URL from a client.
// This endpoint writes nothing and is intentionally not a pump start endpoint.
const LOCAL_AI = 'http://127.0.0.1:5011/dashboard/summary';

export async function postAiVolumeTrialPreview(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const input = aiVolumeTrialPreviewInputSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      success: false, data: null, message: 'Batas volume, durasi, atau deviceId trial tidak valid.',
    });
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const aiResponse = await fetch(LOCAL_AI, {
      method: 'GET',
      signal: abort.signal,
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
    });
    if (!aiResponse.ok) {
      res.status(503).json({ success: false, data: null, message: 'Standalone AI staging tidak tersedia.' });
      return;
    }
    const raw: unknown = await aiResponse.json();
    const checked = unifiedAiDashboardSchema.safeParse(raw);
    if (!checked.success) {
      res.status(503).json({ success: false, data: null, message: 'Kontrak Standalone AI tidak kompatibel.' });
      return;
    }
    const candidate = convertAiFuzzyToSoftwareTrial(checked.data, input.data);
    res.json({
      success: true,
      data: candidate,
      message: 'Hanya kandidat simulasi; tidak membuat command, tidak menggerakkan pompa.',
    });
  } catch (error) {
    if (error instanceof AiVolumeTrialPreviewBlocked) {
      res.status(409).json({ success: false, data: null, message: error.message });
    } else {
      res.status(503).json({ success: false, data: null, message: 'Gagal membaca Standalone AI staging.' });
    }
  } finally {
    clearTimeout(timeout);
  }
}
