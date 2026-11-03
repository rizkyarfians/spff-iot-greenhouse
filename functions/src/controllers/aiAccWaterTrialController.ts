import type { Request, Response, NextFunction } from 'express';
import { aiAccWaterTrialRequestSchema, unifiedAiDashboardSchema } from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import { AiAccWaterTrialBlocked } from '../services/aiAccWaterTrialPolicy.js';
import { queueAiAccWaterTrial } from '../services/aiAccWaterTrialService.js';

const LOCAL_SHADOW_AI = 'http://127.0.0.1:5011/dashboard/summary';

export async function postAiAccWaterTrial(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const parsed = aiAccWaterTrialRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({success:false,data:null,message:'ACC trial tidak valid.'});
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 8000);
  try {
    const response = await fetch(LOCAL_SHADOW_AI, {
      method:'GET',headers:{Accept:'application/json'},
      signal:controller.signal,redirect:'error',cache:'no-store',
    });
    if (!response.ok) {
      res.status(503).json({success:false,data:null,message:'Python AI tidak tersedia.'});
      return;
    }
    const summary = unifiedAiDashboardSchema.safeParse(await response.json() as unknown);
    if (!summary.success) {
      res.status(503).json({success:false,data:null,message:'Schema sumber AI tidak valid.'});
      return;
    }
    const result = await queueAiAccWaterTrial(parsed.data,requestActor(req),summary.data);
    res.status(result.idempotent ? 200 : 202).json({
      success:true,data:result,
      message:'ACC masuk antrean; tunggu ACK dan actual OFF dari ESP32. Bukan bukti pompa ON.',
    });
  }catch(error){
    if (error instanceof AiAccWaterTrialBlocked) {
      res.status(409).json({success:false,data:null,message:error.message});
    } else if (error instanceof Error && error.name === 'AbortError') {
      res.status(503).json({success:false,data:null,message:'Python AI timeout.'});
    } else {
      next(error);
    }
  } finally { clearTimeout(timeout); }
}
