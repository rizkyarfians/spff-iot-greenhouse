import type {Request,Response,NextFunction} from 'express';
import {requestActor} from '../middleware/operatorAuth.js';
import {readEcDoseSettings,saveEcDoseSettings} from '../services/ecDoseService.js';

const device=(req:Request)=>{
  const value=req.params.deviceId;
  if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw Object.assign(new Error('Pilih perangkat yang valid.'),{status:400});
  return value;
};
export async function getEcDoseSettings(req:Request,res:Response,next:NextFunction) {
  try {
    const product=req.query.product;
    if(typeof product!=='string'||!product.trim()||product.length>120)
      return res.status(400).json({success:false,message:'Pilih formulasi pupuk.'});
    res.set('Cache-Control','no-store');
    return res.json({success:true,data:await readEcDoseSettings(device(req),product)});
  }catch(error){return next(error);}
}
export async function putEcDoseSettings(req:Request,res:Response,next:NextFunction) {
  try {return res.json({success:true,data:await saveEcDoseSettings(device(req),req.body,requestActor(req))});}
  catch(error){return next(error);}
}
