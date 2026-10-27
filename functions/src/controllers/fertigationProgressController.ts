import type {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {readFertigationProgress} from '../services/fertigationProgressService.js';
export async function getFertigationProgress(req:Request,res:Response,next:NextFunction){
 try{
  const query=z.object({deviceId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),recipeId:z.string().uuid().optional()}).parse(req.query);
  res.set('Cache-Control','no-store').json({success:true,data:await readFertigationProgress(query.deviceId,query.recipeId),message:'Rekomendasi dan progres EC terkini.'});
 }catch(e){if(e instanceof z.ZodError){res.status(400).json({success:false,data:null,message:'Perangkat atau program tidak valid.'});return;}
  if(e instanceof Error&&'status' in e&&e.status===409){res.status(409).json({success:false,data:null,message:e.message});return;}next(e);}
}
