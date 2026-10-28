import type {Request,Response,NextFunction} from 'express';
import {protocolGuideSaveSchema} from '@spff/contracts';
import {requestActor} from '../middleware/operatorAuth.js';
import {readProtocolGuide,readProtocolGuideHistory,saveProtocolGuide} from '../services/protocolGuideService.js';
async function handle(res:Response,next:NextFunction,action:()=>Promise<unknown>){
 try{res.set('Cache-Control','no-store').json({success:true,data:await action(),message:'Panduan berhasil dimuat/disimpan.'});}
 catch(error){
  if(error instanceof Error&&'status'in error){res.status(Number(error.status)).json({success:false,message:error.message,errors:[]});return;}
  const code=error instanceof Error&&'code'in error?String(error.code):'';
  if(['42P01','42703','42501'].includes(code)){console.error('[protocol-guide]',error);res.status(503).json({success:false,message:'Penyimpanan panduan belum siap. Periksa migration 033 dan izin database.',errors:[]});return;}
  next(error);
 }
}
export async function getProtocolGuide(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>readProtocolGuide(String(req.params.cropId)));}
export async function getProtocolGuideHistory(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>readProtocolGuideHistory(String(req.params.cropId)));}
export async function putProtocolGuide(req:Request,res:Response,next:NextFunction){
 const parsed=protocolGuideSaveSchema.safeParse(req.body);
 if(!parsed.success){res.status(400).json({success:false,message:'Perubahan tabel tidak valid.',errors:parsed.error.issues.map(issue=>issue.message)});return;}
 await handle(res,next,()=>saveProtocolGuide(String(req.params.cropId),parsed.data,requestActor(req)));
}
