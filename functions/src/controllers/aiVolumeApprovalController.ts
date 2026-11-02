import type { NextFunction, Request, Response } from 'express';
import {
  aiVolumeApprovalRequestSchema,
  aiVolumeApprovalQueueRequestSchema,
  unifiedAiDashboardSchema,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import {
  approveAiVolumeTrial,
  getAiVolumeApproval,
  queueApprovedAiVolumeTrial,
} from '../services/aiVolumeApprovalService.js';
import { AiVolumeApprovalBlocked } from '../services/aiVolumeApprovalPlanning.js';
import { WaterTrialBlockedError } from '../services/waterTrialService.js';
import { AiVolumeTrialPreviewBlocked } from '../services/aiVolumeTrialConversion.js';

// Fixed staging loopback; never accept an AI service URL from the browser.
const LOCAL_AI = 'http://127.0.0.1:5011/dashboard/summary';
const approvalIdValid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

class AiSourceUnavailable extends Error {}

async function currentAiSummary(): Promise<UnifiedAiDashboard> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(LOCAL_AI, {
      method:'GET',
      headers:{Accept:'application/json'},
      redirect:'error',
      cache:'no-store',
      signal:controller.signal,
    });
    if (!response.ok) throw new AiSourceUnavailable('Service Python AI belum tersedia.');
    const body: unknown = await response.json();
    const parsed = unifiedAiDashboardSchema.safeParse(body);
    if (!parsed.success) throw new AiSourceUnavailable('Kontrak laporan Python AI tidak valid.');
    return parsed.data;
  } catch (error) {
    if (error instanceof AiSourceUnavailable) throw error;
    throw new AiSourceUnavailable('Gagal mengambil laporan Python AI lokal.');
  } finally {
    clearTimeout(timeout);
  }
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AiSourceUnavailable) {
    res.status(503).json({success:false,data:null,message:error.message});
    return;
  }
  if (error instanceof AiVolumeApprovalBlocked || error instanceof AiVolumeTrialPreviewBlocked || error instanceof WaterTrialBlockedError) {
    res.status(409).json({success:false,data:null,message:error.message});
    return;
  }
  next(error);
}

export async function postAiVolumeApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control','no-store');
  const body = aiVolumeApprovalRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({success:false,data:null,message:'Data approval tidak valid.'});
    return;
  }
  try {
    const result = await approveAiVolumeTrial(
      body.data, requestActor(req), await currentAiSummary(),
    );
    res.status(result.idempotent ? 200 : 201).json({
      success:true,
      data:result,
      message:'Draft AI tercatat. Persetujuan ini TIDAK menjalankan pompa.',
    });
  } catch (error) { handleError(error,res,next); }
}

export async function readAiVolumeApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control','no-store');
  if (!approvalIdValid(req.params.approvalId)) {
    res.status(400).json({success:false,data:null,message:'approvalId tidak valid.'});
    return;
  }
  try {
    const result = await getAiVolumeApproval(req.params.approvalId);
    if (!result) {
      res.status(404).json({success:false,data:null,message:'Approval tidak ditemukan.'});
      return;
    }
    res.json({success:true,data:result,message:'Status approval; bukan bukti pompa aktif.'});
  } catch(error) { next(error); }
}

export async function queueAiVolumeApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control','no-store');
  if (!approvalIdValid(req.params.approvalId)) {
    res.status(400).json({success:false,data:null,message:'approvalId tidak valid.'});
    return;
  }
  const body = aiVolumeApprovalQueueRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({success:false,data:null,message:'Konfirmasi pengantrean tidak valid.'});
    return;
  }
  // Fail closed BEFORE touching AI or the command DB.
  if (process.env.SPFF_AI_FUZZY_TRIAL_DISPATCH_ENABLED !== 'true' ||
      process.env.SPFF_WATER_TRIAL_DISPATCH_ENABLED !== 'true') {
    res.status(409).json({
      success:false,data:null,
      message:'Dispatch AI trial nonaktif; tidak ada command dibuat.',
    });
    return;
  }
  try {
    const result = await queueApprovedAiVolumeTrial(
      req.params.approvalId, body.data, requestActor(req), await currentAiSummary(),
    );
    res.status(result.idempotent ? 200 : 202).json({
      success:true,data:result,
      message:'Command pending di DB. Tunggu ACK aktual ESP32 sebelum menganggap berhasil.',
    });
  } catch (error) { handleError(error,res,next); }
}
