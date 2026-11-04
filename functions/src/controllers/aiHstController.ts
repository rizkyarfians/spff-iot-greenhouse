import type { Request, Response } from 'express';
import {
  aiHstApprovalRequestSchema,
  aiHstApprovalResultSchema,
  aiHstProposalsSchema,
} from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';

const AI_URL = 'http://127.0.0.1:5011';

export async function getHstProposals(_req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const response = await fetch(`${AI_URL}/hst/proposals`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      res.status(503).json({ success: false, data: null, message: 'HST AI belum tersedia.' });
      return;
    }
    const parsed = aiHstProposalsSchema.safeParse(await response.json() as unknown);
    if (!parsed.success) {
      res.status(503).json({ success: false, data: null, message: 'Format HST AI tidak valid.' });
      return;
    }
    res.json({ success: true, data: parsed.data, message: 'Usulan HST SHADOW.' });
  } catch {
    res.status(503).json({ success: false, data: null, message: 'HST AI tidak terjangkau.' });
  }
}

export async function postHstApproval(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const parsedRequest = aiHstApprovalRequestSchema.safeParse(req.body as unknown);
  if (!parsedRequest.success) {
    res.status(400).json({ success: false, data: null, message: 'ACC HST tidak valid.' });
    return;
  }
  const body = parsedRequest.data;
  const key = process.env.AI_HST_BRIDGE_KEY;
  // A public browser must never have access to this backend-to-AI secret.
  if (!key || key.length < 32) {
    res.status(503).json({ success: false, data: null,
      message: 'Jembatan ACC HST belum dikonfigurasi; belum ada persetujuan dicatat.' });
    return;
  }
  try {
    const response = await fetch(`${AI_URL}/hst/approvals`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-SPFF-Bridge-Key': key,
      },
      body: JSON.stringify({
        obligation_id: body.obligationId,
        approval_id: body.approvalId,
        expected_remaining_g: body.expectedRemainingG,
        actor: requestActor(req),
        confirmation: 'REVIEW_HST_SHADOW_SESSION',
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      res.status(response.status === 409 ? 409 : 503).json({
        success: false, data: null,
        message: response.status === 409
          ? 'Usulan berubah atau tidak bisa disetujui. Refresh sebelum ACC ulang.'
          : 'Pemeriksaan ACC HST tidak tersedia.',
      });
      return;
    }
    const parsedResult = aiHstApprovalResultSchema.safeParse(await response.json() as unknown);
    if (!parsedResult.success) {
      res.status(503).json({ success: false, data: null,
        message: 'Konfirmasi SHADOW dari AI tidak valid.' });
      return;
    }
    res.json({ success: true, data: parsedResult.data,
      message: 'ACC sesi dicatat sebagai review SHADOW. Tidak ada perintah pompa.' });
  } catch {
    res.status(503).json({ success: false, data: null,
      message: 'Pemeriksaan sensor setelah ACC gagal; status eksekusi tetap BLOCKED.' });
  }
}
