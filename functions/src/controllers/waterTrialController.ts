import type { Request, Response, NextFunction } from 'express';
import { waterTrialRequestSchema, waterTrialCalibrationSchema } from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import {
  createWaterTrial, getWaterTrial, stopWaterTrial, recordWaterTrialCalibration, WaterTrialBlockedError,
} from '../services/waterTrialService.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);

export async function startCalibrationTrial(req: Request, res: Response, next: NextFunction) {
  const parsed=waterTrialRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({success:false,data:null,message:'Parameter trial tidak valid.'});
    return;
  }
  try {
    const trial=await createWaterTrial(parsed.data,requestActor(req));
    res.status(trial.idempotent?200:202).json({
      success:true,data:trial,message:'Trial masuk antrean; tunggu ACK perangkat, bukan tanda pompa sudah ON.',
    });
  } catch (error) {
    if (error instanceof WaterTrialBlockedError) {
      res.status(409).json({success:false,data:null,message:error.message});
    } else next(error);
  }
}

export async function readCalibrationTrial(req: Request,res: Response,next: NextFunction) {
  if (!validId(req.params.commandId)) {
    res.status(400).json({success:false,data:null,message:'commandId tidak valid.'});
    return;
  }
  try {
    const result=await getWaterTrial(req.params.commandId);
    if (!result) {
      res.status(404).json({success:false,data:null,message:'Trial tidak ditemukan.'});
      return;
    }
    res.set('Cache-Control','no-store').json({success:true,data:result,message:'Bukti ACK perangkat untuk trial.'});
  } catch(error) { next(error); }
}

export async function stopCalibrationTrial(req: Request,res: Response,next: NextFunction) {
  if (!validId(req.params.commandId)) {
    res.status(400).json({success:false,data:null,message:'commandId tidak valid.'});
    return;
  }
  try {
    const result=await stopWaterTrial(req.params.commandId,requestActor(req));
    res.status(202).json({
      success:true,data:result,message:'STOP diantrekan; periksa actual OFF fisik dan ACK, bukan jaminan OFF.',
    });
  } catch(error) {
    if (error instanceof WaterTrialBlockedError) {
      res.status(409).json({success:false,data:null,message:error.message});
    } else next(error);
  }
}

export async function saveCalibrationMeasurement(req: Request,res: Response,next: NextFunction) {
  if (!validId(req.params.commandId)) {
    res.status(400).json({success:false,data:null,message:'commandId tidak valid.'});
    return;
  }
  const parsed=waterTrialCalibrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({success:false,data:null,message:'Volume fisik atau catatan tidak valid.'});
    return;
  }
  try {
    const result=await recordWaterTrialCalibration(
      req.params.commandId,parsed.data.physicalMeasuredL,
      parsed.data.note,requestActor(req),
    );
    res.status(result.idempotent?200:201).json({
      success:true,data:result,
      message:'Kalibrasi tercatat sebagai provisional; belum diterapkan ke kontrol otomatis.',
    });
  } catch(error) {
    if (error instanceof WaterTrialBlockedError) {
      res.status(409).json({success:false,data:null,message:error.message});
    } else next(error);
  }
}
