import type {Request,Response} from 'express';
import {z} from 'zod';
import {doseVolumeStopSchema} from '@spff/contracts';
import {requestActor} from '../middleware/operatorAuth.js';
import {createDoseVolumePlan,approveDoseVolume,readDoseVolumeSession,stopDoseVolume,readDoseVolumeReadiness,reconcileDoseVolume} from '../services/doseVolumeService.js';

async function handle(res:Response,work:()=>Promise<unknown>){
 res.set('Cache-Control','no-store');
 try{res.json({success:true,data:await work(),message:'Mode dosis/volume; EC bukan penentu dosis.'});}
 catch(error){
  const status=error instanceof z.ZodError?400:(error as {status?:number})?.status??503;
  res.status(status).json({success:false,data:null,message:status===503?'Layanan dosis/volume belum tersedia.':
   error instanceof z.ZodError?'Permintaan dosis/volume tidak sesuai kontrak.':(error as Error).message});
 }
}
export async function postDoseVolumePlan(req:Request,res:Response){await handle(res,()=>createDoseVolumePlan(req.body,requestActor(req)));}
export async function getDoseVolumeReadiness(req:Request,res:Response){await handle(res,()=>readDoseVolumeReadiness(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).parse(req.query.deviceId)));}
export async function postDoseVolumeApproval(req:Request,res:Response){await handle(res,()=>approveDoseVolume(req.body,requestActor(req)));}
export async function postDoseVolumeReconcile(req:Request,res:Response){await handle(res,()=>reconcileDoseVolume(z.string().uuid().parse(req.params.id),req.body,requestActor(req)));}
export async function getDoseVolumeSession(req:Request,res:Response){await handle(res,()=>readDoseVolumeSession(z.string().uuid().parse(req.params.id)));}
export async function postDoseVolumeStop(req:Request,res:Response){await handle(res,()=>{
 const id=z.string().uuid().parse(req.params.id),input=doseVolumeStopSchema.parse(req.body);
 return stopDoseVolume(id,input.requestId,requestActor(req));
});}
