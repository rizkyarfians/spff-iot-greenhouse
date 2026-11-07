import {createHash,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {adaptiveEventSchema,adaptiveDispatchSchema,doseVolumeControlSchema,type AdaptiveEvent,type AdaptiveDispatch} from '@spff/contracts';
import {config} from './config.js';
import {normalizeDoseVolumeStop,saveDoseVolumeEvidence} from './doseVolumeEvidence.js';
import {tickServerWater} from './serverWaterControl.js';
export class AdaptiveFertigationTransport {
 private pool:Pick<Pool,'query'|'connect'|'end'>;private timer:NodeJS.Timeout|null=null;private running=false;
 constructor(private publish:(payload:AdaptiveDispatch)=>Promise<void>,database?:Pick<Pool,'query'|'connect'|'end'>){this.pool=database??new Pool({connectionString:config.database.url,max:3});}
 async installed(){return (await this.pool.query("SELECT to_regclass('spff.adaptive_fert_sessions') IS NOT NULL AS ready")).rows[0]?.ready===true;}
 start(){this.timer=setInterval(()=>{if(this.running)return;this.running=true;void this.dispatch().catch(e=>console.error('[adaptive-dispatch]',e)).finally(()=>{this.running=false;});},1000);this.timer.unref();}
 async stop(){if(this.timer)clearInterval(this.timer);while(this.running)await new Promise(resolve=>setTimeout(resolve,10));await this.pool.end();}
 private async stopOnEmptyWater(client:PoolClient){
  const result=await client.query(`SELECT s.site_id,s.device_id,s.session_id,s.command_snapshot,
    md5('dose-volume-water-empty:'||s.session_id::text)::uuid AS stop_request_id
   FROM spff.adaptive_fert_sessions s
   JOIN LATERAL (
    SELECT t.recorded_at,t.tank_water_level_pct,t.sensor_health
    FROM spff.telemetry_samples t
    WHERE t.site_id=s.site_id AND t.device_id=s.device_id
    ORDER BY t.recorded_at DESC,t.telemetry_id DESC LIMIT 1
   ) sample ON true
   WHERE s.command_snapshot->>'kind'='dose_volume_command'
    AND s.status NOT IN ('completed','fault')
    AND sample.recorded_at>=s.created_at
    AND sample.recorded_at BETWEEN now()-interval '60 seconds' AND now()+interval '5 seconds'
    AND sample.tank_water_level_pct=0
    AND sample.sensor_health #> '{tank_water_level_pct,valid}'='true'::jsonb
    AND NOT EXISTS (
     SELECT 1 FROM spff.adaptive_fert_commands cmd
     WHERE cmd.site_id=s.site_id AND cmd.session_id=s.session_id
      AND cmd.payload->>'commandType'='stop'
      AND (cmd.request_id=md5('dose-volume-water-empty:'||s.session_id::text)::uuid OR cmd.expires_at>now())
    )
   FOR UPDATE OF s SKIP LOCKED`);
  for(const row of result.rows){
   const now=new Date();
   const command=doseVolumeControlSchema.safeParse({
    kind:'dose_volume_command',schemaVersion:1,contract:'spff-dose-volume-v1',
    siteId:row.site_id,deviceId:row.device_id,sessionId:row.session_id,
    bootId:row.command_snapshot.bootId,commandId:randomUUID(),commandType:'stop',
    issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+15000).toISOString(),
   });
   if(!command.success)continue;
   await client.query(`UPDATE spff.adaptive_fert_commands SET status='cancelled'
    WHERE site_id=$1 AND session_id=$2 AND status='pending' AND payload->>'commandType'='start'`,[row.site_id,row.session_id]);
   await client.query(`INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)
    VALUES($1,$2,$3,$4,$5,$6)`,[
     row.site_id,command.data.commandId,row.session_id,row.stop_request_id,JSON.stringify(command.data),command.data.expiresAt,
   ]);
   await client.query(`UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',
    reason=CASE WHEN status='reconciliation_required' THEN reason ELSE 'stop_requested_by:tank_water_empty' END
    WHERE site_id=$1 AND session_id=$2`,[row.site_id,row.session_id]);
  }
 }
 async dispatch(){
  const c=await this.pool.connect();let rows;
  try{await c.query('BEGIN');
   await tickServerWater(c,false);
   await this.stopOnEmptyWater(c);
   // Claim before network I/O. A process crash becomes uncertain; never replay START automatically.
   await c.query(`UPDATE spff.adaptive_fert_sessions s SET status='reconciliation_required',reason='command_outcome_unknown' WHERE status IN ('queued','running','paused') AND EXISTS(SELECT 1 FROM spff.adaptive_fert_commands cmd WHERE cmd.site_id=s.site_id AND cmd.session_id=s.session_id AND cmd.status IN ('dispatching','unknown') AND cmd.expires_at<now())`);
   await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='telemetry_timeout' WHERE status IN ('queued','running','paused') AND coalesce(command_snapshot->>'kind','') NOT IN ('server_water_control','hst_dose_pulse') AND COALESCE(last_telemetry_at,created_at)<now()-interval '90 seconds'");
   await c.query("UPDATE spff.adaptive_fert_commands SET status='expired' WHERE status='pending' AND expires_at<now()");
   await c.query(`UPDATE spff.adaptive_fert_sessions s SET status='fault',reason='start_expired_before_dispatch' WHERE status='queued' AND EXISTS(SELECT 1 FROM spff.adaptive_fert_commands cmd WHERE cmd.site_id=s.site_id AND cmd.session_id=s.session_id AND cmd.payload->>'commandType'='start' AND cmd.status='expired')`);
   rows=(await c.query(`SELECT cmd.*,s.device_id,s.command_snapshot FROM spff.adaptive_fert_commands cmd JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
    WHERE cmd.status='pending' AND cmd.expires_at>now() AND s.status NOT IN ('completed','fault')
    AND s.command_snapshot->>'kind' IS DISTINCT FROM 'hst_dose_pulse'
    AND (cmd.payload->>'commandType' NOT IN ('start','resume') OR CASE WHEN cmd.payload->>'kind'='dose_volume_command' THEN $2::boolean ELSE $1::boolean END)
    AND (cmd.payload->>'commandType'<>'start' OR NOT EXISTS(SELECT 1 FROM spff.adaptive_fert_commands earlier WHERE earlier.site_id=cmd.site_id AND earlier.session_id=cmd.session_id AND earlier.created_at<cmd.created_at AND earlier.status IN ('pending','dispatching','forwarded')))
    ORDER BY cmd.created_at FOR UPDATE OF cmd SKIP LOCKED LIMIT 10`,[false,false])).rows;
   for(const row of rows){
    row.payload=normalizeDoseVolumeStop(row);
    await c.query("UPDATE spff.adaptive_fert_commands SET status='dispatching',dispatch_started_at=now(),payload=$3 WHERE site_id=$1 AND command_id=$2",
     [row.site_id,row.command_id,JSON.stringify(row.payload)]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  for(const row of rows){
   try{const payload=adaptiveDispatchSchema.parse({kind:'adaptive_fert_dispatch',schemaVersion:1,siteId:row.site_id,deviceId:row.device_id,command:row.payload,expiresAt:row.expires_at.toISOString()});await this.publish(payload);}
   catch(e){await this.pool.query("UPDATE spff.adaptive_fert_commands SET status='unknown' WHERE site_id=$1 AND command_id=$2 AND status='dispatching'",[row.site_id,row.command_id]);console.error('[adaptive-dispatch] outcome unknown',e);}
  }
 }
 async saveEvent(raw:AdaptiveEvent){
  const event=adaptiveEventSchema.parse(raw),payload=event.payload;
  if(createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==event.messageId)throw new Error('Adaptive event fingerprint mismatch');
  if(payload.kind==='dose_volume_ack'||payload.kind==='dose_volume_telemetry'){
   await saveDoseVolumeEvidence(this.pool,event,payload);return;
  }
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const added=await c.query('INSERT INTO spff.adaptive_fert_events(site_id,device_id,message_id,payload,received_at)VALUES($1,$2,$3,$4,$5)ON CONFLICT DO NOTHING RETURNING message_id',[event.siteId,event.deviceId,event.messageId,JSON.stringify(payload),event.receivedAt]);
   if(!added.rows.length){await c.query('COMMIT');return;}
   // Unsolicited/old-session packets are retained for diagnosis but cannot allocate program dose.
   const row=(await c.query('SELECT * FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND device_id=$2 AND session_id::text=$3 FOR UPDATE',[event.siteId,event.deviceId,payload.sessionId])).rows[0];
   if(payload.kind==='water_first_fertigation_completed'){
    const at=Date.parse(payload.timestamp);
    if(row?.command_snapshot?.kind==='server_water_first_fertigation'&&payload.bootId===row.command_snapshot.bootId&&
      !['completed','fault'].includes(row.status)&&row.last_telemetry?.kind!==payload.kind&&
      at>=row.created_at.getTime()&&at<=Date.now()+5000){
     await c.query(`UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',
      reason='water_first_pumps_off_awaiting_dose_evidence',last_telemetry_at=$3,last_telemetry=$4
      WHERE site_id=$1 AND session_id=$2`,[event.siteId,row.session_id,new Date(at),JSON.stringify(payload)]);
    }
    await c.query('COMMIT');return;
   }
   if(row?.command_snapshot?.kind==='server_water_first_fertigation'){await c.query('COMMIT');return;}
   if(row?.command_snapshot?.kind==='server_water_control'){await c.query('COMMIT');return;}
   if(row?.command_snapshot?.kind==='dose_volume_command'&&payload.kind!=='adaptive_fert_gateway_ack'){
    await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='dose_volume_wrong_report_protocol' WHERE site_id=$1 AND session_id=$2",[event.siteId,row.session_id]);
    await c.query('COMMIT');return;
   }
   if(row){
    const at=Date.parse(payload.kind==='adaptive_fert_ack'?payload.acknowledgedAt:payload.timestamp);
    if(at>=row.created_at.getTime()-1000&&at<=Date.now()+5000){
     if(payload.kind==='adaptive_fert_gateway_ack'){
      await c.query(`UPDATE spff.adaptive_fert_commands SET status=$4,ack=$5 WHERE site_id=$1 AND session_id=$2 AND command_id::text=$3 AND status IN ('dispatching','unknown')`,[event.siteId,row.session_id,payload.commandId,payload.status,JSON.stringify(payload)]);
     }else if(payload.kind==='adaptive_fert_ack'){
      await c.query(`UPDATE spff.adaptive_fert_commands SET status=$4,ack=$5 WHERE site_id=$1 AND session_id=$2 AND command_id::text=$3 AND status NOT IN ('completed','rejected')`,[event.siteId,row.session_id,payload.commandId,payload.status,JSON.stringify(payload)]);
      // Final completion is correlated to BOTH firmware terminal ACK and
      // terminal measured telemetry (arrival order does not matter).
      if(payload.status==='completed'&&payload.state==='COMPLETED'&&
         payload.commandId===row.command_snapshot?.commandId&&
         row.status!=='reconciliation_required'&&row.last_telemetry?.state==='COMPLETED'&&
         row.last_telemetry?.waterPump===false&&row.last_telemetry?.fertPump===false&&
         row.last_telemetry?.waterPumpKnown===true&&row.last_telemetry?.fertPumpKnown===true&&
         row.last_telemetry?.volumeEstimated===false&&
         row.last_telemetry?.flowValid===true&&row.last_telemetry?.ecValid===true&&
         row.last_telemetry?.bootId===row.command_snapshot?.bootId)
        await c.query("UPDATE spff.adaptive_fert_sessions SET status='completed',reason='device_terminal_ack_and_measured_pumps_off' WHERE site_id=$1 AND session_id=$2 AND status NOT IN ('completed','fault','reconciliation_required')",[event.siteId,row.session_id]);
      if(payload.status==='fault'&&!['completed','fault'].includes(row.status)&&(!row.last_telemetry_at||at>=row.last_telemetry_at.getTime()))await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason=$3 WHERE site_id=$1 AND session_id=$2",[event.siteId,row.session_id,payload.reason]);
      // Firmware reuses the start ID for control ACKs. Do not invent a correlation to a new command.
      if(payload.status==='rejected'&&payload.commandId===row.command_snapshot.commandId&&row.status==='queued')await c.query("UPDATE spff.adaptive_fert_sessions SET status='fault',reason=$3 WHERE site_id=$1 AND session_id=$2",[event.siteId,row.session_id,payload.reason]);
     }else{
      const newer=!row.last_telemetry_at||at>=row.last_telemetry_at.getTime();
      if(newer){
       // Device reports flow/counter and register readback validity in 1.5.07.
       // Never allocate a fertilizer dose from an estimated counter, another
       // boot, stale/invalid sensor, or an already uncertain session.
       const evidenceVerified=payload.bootId===row.command_snapshot?.bootId &&
        payload.flowValid===true && payload.ecValid===true &&
        payload.waterPumpKnown===true && payload.fertPumpKnown===true &&
        payload.volumeEstimated===false;
       if(!evidenceVerified || row.status==='reconciliation_required'){
        await c.query(`UPDATE spff.adaptive_fert_sessions
         SET status='reconciliation_required',reason=$3,last_telemetry_at=$4,last_telemetry=$5
         WHERE site_id=$1 AND session_id=$2`,
         [event.siteId,row.session_id,'adaptive_measurement_unverified',payload.timestamp,JSON.stringify(payload)]);
       }else{
       const terminal=row.status==='completed'||row.status==='fault';
       let status=payload.state==='COMPLETED'?'completed':payload.state==='FAULT'?'fault':payload.state==='PAUSED'?'paused':'running';
       if((payload.state==='COMPLETED'||payload.state==='FAULT')&&(payload.waterPump||payload.fertPump))status='reconciliation_required';
       if(payload.state==='FAULT'||payload.ecTargetUnreachable||row.status==='reconciliation_required')status='reconciliation_required';
       if(payload.state==='COMPLETED'&&status==='completed'){
        const startAck=(await c.query("SELECT status FROM spff.adaptive_fert_commands WHERE site_id=$1 AND command_id=$2",[event.siteId,row.command_snapshot.commandId])).rows[0];
        // A telemetry packet alone is not a command completion ACK.
        if(startAck?.status!=='completed')status='running';
       }
       if(terminal&&status!==row.status)status='reconciliation_required';
       if(payload.waterVolumeL+1e-6<row.water_volume_l||payload.fertVolumeL+1e-6<row.fert_volume_l)status='reconciliation_required';
       const mass=payload.fertVolumeL*row.command_snapshot.nominalConcentrationGPerL;
       if(payload.fertVolumeL>row.command_snapshot.targetFertVolumeL+Math.max(0.1,row.command_snapshot.targetFertVolumeL*0.05)||Math.abs(payload.fertMassGrams-mass)>Math.max(1,mass*0.02))status='reconciliation_required';
       if(status==='reconciliation_required'){
        // Preserve the incident but never debit grams from an uncertain meter.
        await c.query(`UPDATE spff.adaptive_fert_sessions SET last_telemetry_at=$3,last_telemetry=$4,status='reconciliation_required',reason=$5 WHERE site_id=$1 AND session_id=$2`,[event.siteId,row.session_id,payload.timestamp,JSON.stringify(payload),'adaptive_meter_discrepancy']);
       }else{
        await c.query(`UPDATE spff.adaptive_fert_sessions SET water_volume_l=GREATEST(water_volume_l,$3),fert_volume_l=GREATEST(fert_volume_l,$4),last_telemetry_at=$5,last_telemetry=$6,status=$7,reason=$8 WHERE site_id=$1 AND session_id=$2`,[event.siteId,row.session_id,payload.waterVolumeL,payload.fertVolumeL,payload.timestamp,JSON.stringify(payload),status,payload.faultReason]);
       }
       }
      }
     }
    }
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
