import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { waterInterlockUpdateSchema, type WaterInterlockView } from '@spff/contracts';
import { pool, configuredSiteId as siteId } from '../services/postgresRepository.js';
import { requestActor } from '../middleware/operatorAuth.js';

export async function readWaterInterlock(deviceId:string):Promise<WaterInterlockView|null>{
  const r=await pool.query(`SELECT d.device_id,c.*,st.online,st.recorded_at,st.raw_payload
    FROM spff.devices d LEFT JOIN spff.device_water_interlock_configs c USING(site_id,device_id)
    LEFT JOIN LATERAL(SELECT online,recorded_at,raw_payload FROM spff.device_status_events
      WHERE site_id=d.site_id AND device_id=d.device_id ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1) st ON true
    WHERE d.site_id=$1 AND d.device_id=$2 AND d.enabled`,[siteId,deviceId]);
  const row=r.rows[0];if(!row)return null;
  const online=row.online===true&&row.recorded_at&&Date.now()-row.recorded_at.getTime()>=0&&Date.now()-row.recorded_at.getTime()<90000;
  return {deviceId,revision:row.revision??0,enabled:row.enabled??true,
    acknowledgedRevision:row.acknowledged_revision??null,acknowledgementStatus:row.acknowledgement_status??null,
    appliedEnabled:row.applied_enabled??null,acknowledgedAt:row.acknowledged_at?.toISOString()??null,reason:row.acknowledgement_reason??null,
    capable:online&&row.raw_payload?.waterInterlockConfigCapable===true,online:!!online,
    reportedEnabled:online&&typeof row.raw_payload?.waterInterlockEnabled==='boolean'?row.raw_payload.waterInterlockEnabled:null,
    reportedRevision:online&&Number.isInteger(row.raw_payload?.waterInterlockRevision)?row.raw_payload.waterInterlockRevision:null};
}
function handleError(e:unknown,res:Response,next:NextFunction){
  if(e instanceof z.ZodError){res.status(400).json({success:false,message:'Parameter interlock tidak valid.',data:null});return;}
  next(e);
}
export async function getWaterInterlock(req:Request,res:Response,next:NextFunction){
  try{
    const id=waterInterlockUpdateSchema.shape.deviceId.parse(req.query.deviceId);
    const value=await readWaterInterlock(id);
    if(!value){res.status(404).json({success:false,message:'Perangkat tidak ditemukan.',data:null});return;}
    res.set('Cache-Control','no-store').json({success:true,data:value,message:'Pengaturan interlock tandon air CH3.'});
  }catch(e){handleError(e,res,next);}
}
export async function putWaterInterlock(req:Request,res:Response,next:NextFunction){
  const c=await pool.connect();
  try{
    const input=waterInterlockUpdateSchema.parse(req.body);
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`water-interlock:${siteId}:${input.deviceId}`]);
    const d=await c.query('SELECT 1 FROM spff.devices WHERE site_id=$1 AND device_id=$2 AND enabled',[siteId,input.deviceId]);
    if(!d.rowCount){await c.query('ROLLBACK');res.status(404).json({success:false,message:'Perangkat tidak ditemukan.',data:null});return;}
    const previous=await c.query('SELECT * FROM spff.device_water_interlock_configs WHERE site_id=$1 AND device_id=$2 FOR UPDATE',[siteId,input.deviceId]);
    const old=previous.rows[0];
    // An uncertain HTTP response can be retried without toggling or creating another revision.
    if(old&&old.revision===input.expectedRevision+1&&old.enabled===input.enabled){
      await c.query('COMMIT');res.json({success:true,data:await readWaterInterlock(input.deviceId),message:'Permintaan sudah tersimpan.'});return;
    }
    if((old?.revision??0)!==input.expectedRevision){await c.query('ROLLBACK');res.status(409).json({success:false,data:null,message:'Pengaturan berubah. Muat ulang sebelum menyimpan.'});return;}
    if(!old){
      await c.query(`INSERT INTO spff.device_water_interlock_configs(site_id,device_id,enabled,updated_by)
        VALUES($1,$2,$3,$4)`,[siteId,input.deviceId,input.enabled,requestActor(req)]);
    }else if(old.enabled!==input.enabled){
      await c.query(`UPDATE spff.device_water_interlock_configs SET enabled=$3,revision=revision+1,
        acknowledgement_status=NULL,acknowledgement_reason=NULL,published_at=NULL,updated_at=now(),updated_by=$4
        WHERE site_id=$1 AND device_id=$2`,[siteId,input.deviceId,input.enabled,requestActor(req)]);
    }
    await c.query('COMMIT');
    res.json({success:true,data:await readWaterInterlock(input.deviceId),message:'Tersimpan; tunggu konfirmasi firmware.'});
  }catch(e){await c.query('ROLLBACK');handleError(e,res,next);}finally{c.release();}
}
