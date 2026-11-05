import type {Pool} from 'pg';
import {doseVolumeStartSchema,doseVolumeControlSchema,type AdaptiveEvent,type DoseVolumeEventPayload} from '@spff/contracts';

/** Convert emergency STOP created by existing DB relay-ownership triggers.
 * Only a claimed pending STOP for a dose-volume session is normalized.
 */
export function normalizeDoseVolumeStop(row:{payload:Record<string,unknown>;command_snapshot:Record<string,unknown>;created_at:Date;expires_at:Date}){
 if(row.command_snapshot?.kind!=='dose_volume_command'||row.payload.commandType!=='stop'||row.payload.kind!=='adaptive_fert_command')return row.payload;
 return doseVolumeControlSchema.parse({...row.payload,kind:'dose_volume_command',contract:'spff-dose-volume-v1',
  bootId:row.command_snapshot.bootId,issuedAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString()});
}

export async function saveDoseVolumeEvidence(pool:Pick<Pool,'connect'>,event:AdaptiveEvent,
 payload:DoseVolumeEventPayload){
 const c=await pool.connect();try{
  await c.query('BEGIN');
  const added=await c.query(`INSERT INTO spff.adaptive_fert_events(site_id,device_id,message_id,payload,received_at)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id`,
   [event.siteId,event.deviceId,event.messageId,JSON.stringify(payload),event.receivedAt]);
  if(!added.rows.length){await c.query('COMMIT');return;}
  const session=(await c.query(`SELECT * FROM spff.adaptive_fert_sessions
   WHERE site_id=$1 AND device_id=$2 AND session_id=$3 FOR UPDATE`,[event.siteId,event.deviceId,payload.sessionId])).rows[0];
  const parsed=doseVolumeStartSchema.safeParse(session?.command_snapshot);
  if(!session||!parsed.success){await c.query('COMMIT');return;}
  const command=parsed.data;
  const binding=(await c.query('SELECT * FROM spff.dose_volume_bindings WHERE site_id=$1 AND session_id=$2 FOR UPDATE',
   [event.siteId,payload.sessionId])).rows[0];
  if(!binding){await c.query('COMMIT');return;}
  if(binding.evidence_verified){await c.query('COMMIT');return;}
  const at=Date.parse(payload.timestamp);
  if(!Number.isFinite(at)||at<session.created_at.getTime()-1000||at>Date.now()+5000
    ||payload.bootId!==command.bootId){
   await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_identity_or_clock_mismatch' WHERE site_id=$1 AND session_id=$2",
    [event.siteId,payload.sessionId]);await c.query('COMMIT');return;
  }
  if(payload.kind==='dose_volume_ack'){
   const issued=(await c.query('SELECT payload FROM spff.adaptive_fert_commands WHERE site_id=$1 AND session_id=$2 AND command_id=$3',
    [event.siteId,payload.sessionId,payload.commandId])).rows[0];
   if(!issued){await c.query('COMMIT');return;}
   if(issued.payload.kind!=='dose_volume_command'||issued.payload.bootId!==command.bootId){await c.query('COMMIT');return;}
   await c.query("UPDATE spff.adaptive_fert_commands SET status=$4,ack=$5 WHERE site_id=$1 AND session_id=$2 AND command_id=$3 AND status NOT IN ('completed','rejected','fault')",
    [event.siteId,payload.sessionId,payload.commandId,payload.status,JSON.stringify(payload)]);
   if(payload.status==='rejected'){
    if(issued.payload.commandType==='start'&&session.status==='queued')
     await c.query("UPDATE spff.adaptive_fert_sessions SET status='fault',reason='dose_volume_start_rejected' WHERE site_id=$1 AND session_id=$2",
      [event.siteId,payload.sessionId]);
   }else if(['completed','fault'].includes(payload.status)&&['COMPLETED','STOPPED','FAULT'].includes(payload.state)){
    if(binding.terminal_ack&&binding.terminal_ack.state!==payload.state){
     await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_terminal_conflict' WHERE site_id=$1 AND session_id=$2",[event.siteId,payload.sessionId]);
     await c.query('COMMIT');return;
    }
    if(issued.payload.commandType==='start'&&payload.commandId!==command.commandId){await c.query('COMMIT');return;}
    if(issued.payload.commandType==='stop'&&payload.state==='COMPLETED'){await c.query('COMMIT');return;}
    await c.query('UPDATE spff.dose_volume_bindings SET terminal_ack=$3 WHERE site_id=$1 AND session_id=$2',
     [event.siteId,payload.sessionId,JSON.stringify(payload)]);
   }
  }else{
   const current=session.last_telemetry_at instanceof Date?session.last_telemetry_at.getTime():0;
   if(at<current){await c.query('COMMIT');return;}
   const tolerance=command.limits.meterToleranceL;
   const valid=payload.commandId===command.commandId&&payload.flowValid&&payload.volumeEstimated===false
    &&payload.waterPumpKnown&&payload.fertPumpKnown
    &&payload.waterVolumeL+tolerance>=session.water_volume_l&&payload.stockVolumeL+tolerance>=session.fert_volume_l
    &&payload.waterVolumeL<=command.targetWaterVolumeL+tolerance&&payload.stockVolumeL<=command.targetStockVolumeL+tolerance
    &&(command.mode!=='water_only'||(payload.stockVolumeL===0&&payload.fertPump===false));
   if(!valid){
    await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_meter_unverified' WHERE site_id=$1 AND session_id=$2",
     [event.siteId,payload.sessionId]);await c.query('COMMIT');return;
   }
   // Any counter regression is uncertain, even within normal target tolerance.
   if(payload.waterVolumeL+1e-6<session.water_volume_l||payload.stockVolumeL+1e-6<session.fert_volume_l){
    await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_counter_regression' WHERE site_id=$1 AND session_id=$2",
     [event.siteId,payload.sessionId]);await c.query('COMMIT');return;
   }
   const terminal=['COMPLETED','STOPPED','FAULT'].includes(payload.state);
   if(terminal&&(payload.waterPump||payload.fertPump)){
    await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_outputs_not_off' WHERE site_id=$1 AND session_id=$2",
     [event.siteId,payload.sessionId]);await c.query('COMMIT');return;
   }
   await c.query(`UPDATE spff.adaptive_fert_sessions SET water_volume_l=$3,fert_volume_l=$4,last_telemetry_at=$5,last_telemetry=$6,
    status=CASE WHEN status='reconciliation_required' THEN status ELSE 'running' END WHERE site_id=$1 AND session_id=$2`,
    [event.siteId,payload.sessionId,payload.waterVolumeL,payload.stockVolumeL,payload.timestamp,JSON.stringify(payload)]);
   if(terminal)await c.query('UPDATE spff.dose_volume_bindings SET terminal_telemetry=$3 WHERE site_id=$1 AND session_id=$2',
    [event.siteId,payload.sessionId,JSON.stringify(payload)]);
  }
  const final=(await c.query('SELECT * FROM spff.dose_volume_bindings WHERE site_id=$1 AND session_id=$2 FOR UPDATE',
   [event.siteId,payload.sessionId])).rows[0];
  const ack=final?.terminal_ack,telemetry=final?.terminal_telemetry;
  const uncertain=(await c.query('SELECT status,reason FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND session_id=$2',
   [event.siteId,payload.sessionId])).rows[0];
  // STOP request itself is not a measurement failure. All other uncertainty
  // must be explicitly reconciled; later good packets cannot silently clear it.
  const mayCredit=uncertain?.status!=='reconciliation_required'||String(uncertain.reason).startsWith('stop_requested_by:');
  if(mayCredit&&ack&&telemetry&&ack.state===telemetry.state&&ack.bootId===command.bootId
    &&telemetry.bootId===command.bootId&&telemetry.waterPump===false&&telemetry.fertPump===false){
   const mass=telemetry.stockVolumeL*command.nominalConcentrationGPerL;
   const tooMuch=mass>command.targetMassG+command.limits.meterToleranceL*command.nominalConcentrationGPerL+0.001;
   if(tooMuch){
    await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_mass_overrun' WHERE site_id=$1 AND session_id=$2",[event.siteId,payload.sessionId]);
   }else{
    const credit=Math.min(final.target_mass_g,mass);
    await c.query("UPDATE spff.dose_volume_bindings SET credited_g=$3,evidence_verified=true,evidence_basis='DEVICE_TERMINAL_MEASURED' WHERE site_id=$1 AND session_id=$2",
     [event.siteId,payload.sessionId,credit]);
    const full=telemetry.state==='COMPLETED'&&telemetry.waterVolumeL+command.limits.meterToleranceL>=command.targetWaterVolumeL
     &&telemetry.stockVolumeL+command.limits.meterToleranceL>=command.targetStockVolumeL;
    await c.query('UPDATE spff.adaptive_fert_sessions SET status=$3,reason=$4 WHERE site_id=$1 AND session_id=$2',
     [event.siteId,payload.sessionId,full?'completed':'fault',full?'dose_volume_terminal_measured_outputs_off':'dose_volume_partial_verified']);
   }
  }
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
