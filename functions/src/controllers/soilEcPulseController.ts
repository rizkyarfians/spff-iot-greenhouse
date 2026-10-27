import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requestActor } from '../middleware/operatorAuth.js';
import { startSoilEcSession, listSoilEcSessions, cancelSoilEcSession, soilEcPulsesEnabled, soilEcPulseStorageReady, releaseSoilEcOwnership,readSoilEcExecution, readSoilEcAutomaticProfile, saveSoilEcAutomaticProfile } from '../services/soilEcPulseService.js';
export async function getSoilEcPulseSessions(req:Request,res:Response,next:NextFunction){
  try{const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).parse(req.query.deviceId);
    res.set('Cache-Control','no-store').json({success:true,data:{enabled:soilEcPulsesEnabled(),executionEnabled:(await readSoilEcExecution(id)).enabled,automatic:await readSoilEcAutomaticProfile(id),sessions:await soilEcPulseStorageReady()?await listSoilEcSessions(id):[]},message:'Sesi pulse EC tanah.'});
  }catch(e){if(e instanceof Error && 'status' in e && e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}next(e);}
}
export async function postSoilEcPulseSession(req:Request,res:Response,next:NextFunction){
  try{res.status(201).json({success:true,data:await startSoilEcSession(req.body,requestActor(req)),message:'Sesi dicatat; menunggu evaluasi sensor dan ACK perangkat.'});}
  catch(e){if(e instanceof z.ZodError){res.status(400).json({success:false,data:null,message:'Parameter kalibrasi tidak valid.',errors:e.issues.map(i=>i.path.join('.'))});return;}if(e instanceof Error && 'status' in e && e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}next(e);}
}
export async function stopSoilEcPulseSession(req:Request,res:Response,next:NextFunction){
  try{await cancelSoilEcSession(z.string().uuid().parse(req.params.id));res.json({success:true,data:null,message:'Perintah stop dicatat; periksa ACK OFF perangkat.'});}catch(e){if(e instanceof Error && 'status' in e && e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}next(e);}
}

export async function releaseSoilEcPulseSession(req:Request,res:Response,next:NextFunction){
  try{await releaseSoilEcOwnership(z.string().uuid().parse(req.params.id));res.json({success:true,data:null,message:'Pelepasan strategi diminta; tunggu ACK perangkat.'});}
  catch(e){if(e instanceof Error && 'status' in e && e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}next(e);}
}

export async function putSoilEcAutomaticProfile(req:Request,res:Response,next:NextFunction){
 try{res.json({success:true,data:await saveSoilEcAutomaticProfile(req.body,requestActor(req)),message:'Kalibrasi otomatis disimpan.'});}
 catch(e){if(e instanceof z.ZodError){res.status(400).json({success:false,data:null,message:'Parameter kalibrasi tidak valid.'});return;}
 if(e instanceof Error && 'status' in e && e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}next(e);}
}
