import type { Request, Response } from 'express';
import { requestActor } from '../middleware/operatorAuth.js';

const AI_URL = 'http://127.0.0.1:5011';
const OBLIGATION_ID = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.proposals) || data.can_dispatch !== false) {
      res.status(503).json({ success: false, data: null, message: 'Format HST AI tidak valid.' });
      return;
    }
    res.json({ success: true, data, message: 'Usulan HST SHADOW.' });
  } catch {
    res.status(503).json({ success: false, data: null, message: 'HST AI tidak terjangkau.' });
  }
}

export async function postHstApproval(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const body: unknown = req.body;
  if (!isRecord(body) ||
      typeof body.obligationId !== 'string' || !OBLIGATION_ID.test(body.obligationId) ||
      typeof body.approvalId !== 'string' || !UUID.test(body.approvalId) ||
      typeof body.expectedRemainingG !== 'number' ||
      !Number.isFinite(body.expectedRemainingG) || body.expectedRemainingG <= 0 ||
      body.confirmation !== 'REVIEW_HST_SHADOW_SESSION') {
    res.status(400).json({ success: false, data: null, message: 'ACC HST tidak valid.' });
    return;
  }
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
    const data: unknown = await response.json();
    if (!isRecord(data) || data.can_dispatch !== false ||
        data.command_created !== false || data.status !== 'SHADOW_REVIEW_BLOCKED') {
      res.status(503).json({ success: false, data: null,
        message: 'Konfirmasi SHADOW dari AI tidak valid.' });
      return;
    }
    res.json({ success: true, data,
      message: 'ACC sesi dicatat sebagai review SHADOW. Tidak ada perintah pompa.' });
  } catch {
    res.status(503).json({ success: false, data: null,
      message: 'Pemeriksaan sensor setelah ACC gagal; status eksekusi tetap BLOCKED.' });
  }
}
