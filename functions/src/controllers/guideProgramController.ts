import {guideEcProfileSchema} from '@spff/contracts';
import {readGuideEcConversions,saveGuideEcProfile} from '../services/guideEcConversionService.js';
import type {Request,Response,NextFunction} from 'express';
import {guideProgramConfigSchema,guideProgramCreateSchema,guideProgramUpdateSchema,guideProgramCompleteSchema} from '@spff/contracts';
import {requestActor} from '../middleware/operatorAuth.js';
import {listGuidePrograms,previewGuideProgram,saveGuideProgram,completeGuideActivity,readGuideProgramHistory} from '../services/guideProgramService.js';
async function handle(res:Response,next:NextFunction,action:()=>Promise<unknown>){
 try{res.set('Cache-Control','no-store').json({success:true,data:await action(),message:'Program Panduan berhasil diproses.'});}
 catch(e){
  if(e instanceof Error&&'status'in e){res.status(Number(e.status)).json({success:false,message:e.message});return;}
  if(e instanceof Error&&'code'in e&&['42P01','42703','42501'].includes(String(e.code))){console.error('[guide-program]',e);res.status(503).json({success:false,message:'Penyimpanan program belum siap. Periksa migration 033/034/035 dan izin database.'});return;}
  next(e);
 }
}
function id(req:Request){const value=String(req.params.id);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw Object.assign(new Error('ID program tidak valid.'),{status:400});return value;}
function parse<T>(result:{success:boolean;data?:T}){if(!result.success)throw Object.assign(new Error('Data program tidak valid. Periksa tanggal, luas/jumlah tanaman, dan revisi.'),{status:400});return result.data as T;}
export async function getGuidePrograms(_req:Request,res:Response,next:NextFunction){await handle(res,next,listGuidePrograms);}
export async function postGuideProgramPreview(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>previewGuideProgram(parse(guideProgramConfigSchema.safeParse(req.body))));}
export async function postGuideProgram(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>saveGuideProgram(parse(guideProgramCreateSchema.safeParse(req.body)),requestActor(req)));}
export async function putGuideProgram(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>{const data=parse(guideProgramUpdateSchema.safeParse(req.body));return saveGuideProgram(data,requestActor(req),id(req),data.expectedRevision);});}
export async function postGuideProgramCompletion(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>{const data=parse(guideProgramCompleteSchema.safeParse(req.body));return completeGuideActivity(id(req),data.expectedRevision,data.activityId,data.note,requestActor(req));});}

export async function getGuideProgramHistory(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>readGuideProgramHistory(id(req)));}

export async function getGuideEcConversions(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>readGuideEcConversions(id(req)));}
export async function putGuideEcProfile(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>{const result=guideEcProfileSchema.safeParse(req.body);if(!result.success)throw Object.assign(new Error(result.error.issues.map(i=>i.message).join(" ")),{status:400});return saveGuideEcProfile(id(req),result.data,requestActor(req));});}
