import type { Request,Response,NextFunction } from 'express';
import { z } from 'zod';
import { soilEcExecutionUpdateSchema } from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';
import { readSoilEcExecution,setSoilEcExecution } from '../services/soilEcPulseService.js';

function handle(e:unknown,res:Response,next:NextFunction) {
  if(e instanceof z.ZodError){res.status(400).json({success:false,data:null,message:'Pengaturan AI tidak valid.'});return;}
  if(e instanceof Error&&'status' in e&&e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}
  next(e);
}
export async function getSoilEcExecution(req:Request,res:Response,next:NextFunction) {
  try {
    const id=soilEcExecutionUpdateSchema.shape.deviceId.parse(req.query.deviceId);
    res.set('Cache-Control','no-store').json({success:true,data:await readSoilEcExecution(id),message:'Pengaturan AI fertigasi EC tanah.'});
  }catch(e){handle(e,res,next);}
}
export async function putSoilEcExecution(req:Request,res:Response,next:NextFunction) {
  try {
    res.json({success:true,data:await setSoilEcExecution(req.body,requestActor(req)),
      message:'Tersimpan. Mengaktifkan izin tidak memulai sesi; menonaktifkan meminta stop sesi aktif. Periksa ACK OFF.'});
  }catch(e){handle(e,res,next);}
}
