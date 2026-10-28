import type {Request,Response,NextFunction} from 'express';
import {adaptiveSessionInputSchema,adaptiveSessionControlSchema,adaptiveReconcileSchema} from '@spff/contracts';
import {requestActor} from '../middleware/operatorAuth.js';
import {previewAdaptiveSession,createAdaptiveSession,adaptiveProgress,controlAdaptiveSession,reconcileAdaptiveSession,readAdaptiveSession} from '../services/adaptiveFertigationService.js';
async function handle(res:Response,next:NextFunction,fn:()=>Promise<unknown>){try{res.set('Cache-Control','no-store').json({success:true,data:await fn()});}catch(e){if(e instanceof Error&&'status'in e){res.status(Number(e.status)).json({success:false,message:e.message});return;}if(e instanceof Error&&'code'in e&&['42P01','42703','42501'].includes(String(e.code))){res.status(503).json({success:false,message:'Backend adaptif belum siap. Periksa migration 035/036 dan izin database.'});return;}next(e);}}
function parse<T>(v:{success:boolean;data?:T}){if(!v.success)throw Object.assign(new Error('Parameter sesi tidak valid; target EC tidak boleh diisi manual.'),{status:400});return v.data as T;}
function identifier(value:unknown){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw Object.assign(new Error('ID tidak valid.'),{status:400});return value;}
export async function adaptivePreview(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>previewAdaptiveSession(parse(adaptiveSessionInputSchema.safeParse(req.body))));}
export async function adaptiveStart(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>createAdaptiveSession(parse(adaptiveSessionInputSchema.safeParse(req.body)),requestActor(req)));}
export async function adaptiveGetProgress(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>adaptiveProgress(identifier(req.params.id)));}
export async function adaptiveControl(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>{const p=parse(adaptiveSessionControlSchema.safeParse(req.body));return controlAdaptiveSession(identifier(req.params.id),p.operation,p.requestId);});}

export async function adaptiveReconcile(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>reconcileAdaptiveSession(identifier(req.params.id),parse(adaptiveReconcileSchema.safeParse(req.body)),requestActor(req)));}

export async function adaptiveSession(req:Request,res:Response,next:NextFunction){await handle(res,next,()=>readAdaptiveSession(identifier(req.params.id)));}
