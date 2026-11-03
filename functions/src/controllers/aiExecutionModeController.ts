import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { aiExecutionModeUpdateSchema } from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import { AiAccWaterTrialBlocked } from '../services/aiAccWaterTrialPolicy.js';
import { AiExecutionModeBlocked, changeAiExecutionMode, readAiExecutionMode } from '../services/aiExecutionModeService.js';

const deviceQuerySchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);

export async function getAiExecutionMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const parsed = deviceQuerySchema.safeParse(req.query.deviceId);
  if (!parsed.success) {
    res.status(400).json({ success:false,data:null,message:'deviceId tidak valid.' });
    return;
  }
  try {
    const state = await readAiExecutionMode(parsed.data);
    res.json({ success:true,data:state,message:'Mode AI yang disimpan di PostgreSQL; LIVE bukan bukti pompa aktif.' });
  } catch (error) { next(error); }
}

export async function putAiExecutionMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const parsed = aiExecutionModeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success:false,data:null,message:'Payload mode AI tidak valid.' });
    return;
  }
  try {
    const state = await changeAiExecutionMode(parsed.data, requestActor(req));
    res.json({
      success:true,data:state,
      message: state.mode === 'live'
        ? 'LIVE supervised disimpan; command tetap memerlukan ACC operator, safety Worker, dan ACK ESP32.'
        : 'Mode AI disimpan. Ini tidak membatalkan command yang sudah dikirim; gunakan STOP fisik jika perlu.',
    });
  } catch(error) {
    if (error instanceof AiExecutionModeBlocked || error instanceof AiAccWaterTrialBlocked) {
      res.status(409).json({ success:false,data:null,message:error.message });
      return;
    }
    next(error);
  }
}
