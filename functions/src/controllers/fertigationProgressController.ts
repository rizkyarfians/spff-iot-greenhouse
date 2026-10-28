import type {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {readFertigationProgress} from '../services/fertigationProgressService.js';
export async function getFertigationProgress(req:Request,res:Response,next:NextFunction){
 const query=z.object({deviceId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),recipeId:z.string().uuid().optional()}).safeParse(req.query);
 if(!query.success){res.status(400).json({success:false,data:null,message:'Perangkat atau program tidak valid.'});return;}
 try{
  res.set('Cache-Control','no-store').json({success:true,data:await readFertigationProgress(query.data.deviceId,query.data.recipeId),message:'Rekomendasi dan progres EC terkini.'});
 }catch(e){
  if(e instanceof Error&&'status' in e&&e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}
  const code=e instanceof Error&&'code' in e?String(e.code):null;
  if(code==='42P01'||code==='42703'||code==='42501'||e instanceof z.ZodError){
   console.error('[fertigation-progress]',e);
   const message=code==='42501'?'Izin database untuk rekomendasi belum lengkap. Periksa log API dan izin role server.':
    e instanceof z.ZodError?'Data aturan tanaman belum valid. Periksa dan simpan ulang Program Fertigasi.':
    'Struktur data rekomendasi belum lengkap. Periksa migration server, termasuk migration 032.';
   res.status(e instanceof z.ZodError?409:503).json({success:false,data:null,message});return;
  }
  next(e);
 }
}
