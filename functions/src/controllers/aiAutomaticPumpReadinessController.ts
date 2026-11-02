import type { Request, Response, NextFunction } from 'express';
import { aiVolumeTrialPreviewInputSchema, unifiedAiDashboardSchema } from '@spff/contracts';
import {
  assessAutomaticAiPumpReadiness,
  readAutomaticPumpEvidence,
} from '../services/aiAutomaticPumpReadiness.js';

const AI_SOURCE = 'http://127.0.0.1:5011/dashboard/summary';

/** Operator-only preflight. Never writes PostgreSQL or publishes to MQTT. */
export async function getAiAutomaticPumpReadiness(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  res.set('Cache-Control','no-store');
  const id = aiVolumeTrialPreviewInputSchema.shape.deviceId.safeParse(req.query.deviceId);
  if (!id.success) {
    res.status(400).json({success:false,data:null,message:'deviceId tidak valid.'});
    return;
  }
  const abort = new AbortController();
  const timeout = setTimeout(()=>abort.abort(),12000);
  try {
    const response = await fetch(AI_SOURCE,{
      method:'GET',signal:abort.signal,
      headers:{Accept:'application/json'},redirect:'error',cache:'no-store',
    });
    if (!response.ok) {
      res.status(503).json({success:false,data:null,message:'AI SHADOW lokal tidak tersedia.'});
      return;
    }
    const body: unknown = await response.json();
    const checked = unifiedAiDashboardSchema.safeParse(body);
    if (!checked.success) {
      res.status(503).json({success:false,data:null,message:'Schema AI SHADOW tidak valid.'});
      return;
    }
    const evidence = await readAutomaticPumpEvidence(id.data);
    const result = assessAutomaticAiPumpReadiness(checked.data,evidence,id.data);
    res.json({
      success:true,data:result,
      message:'Automatic-only preflight; AI belum boleh mengirim command set_pump.',
    });
  }catch(error){
    if (error instanceof Error && error.name === 'AbortError') {
      res.status(503).json({success:false,data:null,message:'AI SHADOW timeout.'});
    }else{
      next(error);
    }
  }finally{clearTimeout(timeout);}
}
