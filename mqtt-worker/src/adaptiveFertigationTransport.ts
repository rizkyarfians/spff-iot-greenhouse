import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {adaptiveEventSchema,adaptiveDispatchSchema,type AdaptiveEvent,type AdaptiveDispatch} from '@spff/contracts';
import {config} from './config.js';
export class AdaptiveFertigationTransport {
 private pool:Pick<Pool,'query'|'connect'|'end'>;private timer:NodeJS.Timeout|null=null;private running=false;
 constructor(private publish:(payload:AdaptiveDispatch)=>Promise<void>,database?:Pick<Pool,'query'|'connect'|'end'>){this.pool=database??new Pool({connectionString:config.database.url,max:3});}
 async installed(){return (await this.pool.query("SELECT to_regclass('spff.adaptive_fert_sessions') IS NOT NULL AS ready")).rows[0]?.ready===true;}
 start(){this.timer=setInterval(()=>{if(this.running)return;this.running=true;void this.dispatch().catch(e=>console.error('[adaptive-dispatch]',e)).finally(()=>{this.running=false;});},1000);this.timer.unref();}
 async stop(){if(this.timer)clearInterval(this.timer);while(this.running)await new Promise(resolve=>setTimeout(resolve,10));await this.pool.end();}
 async dispatch(){
  const c=await this.pool.connect();let rows;
  try{await c.query('BEGIN');
   // Claim before network I/O. A process crash becomes uncertain; never replay START automatically.
   await c.query(`UPDATE spff.adaptive_fert_sessions s SET status='reconciliation_required',reason='command_outcome_unknown' WHERE status IN ('queued','running','paused') AND EXISTS(SELECT 1 FROM spff.adaptive_fert_commands cmd WHERE cmd.site_id=s.site_id AND cmd.session_id=s.session_id AND cmd.status IN ('dispatching','unknown') AND cmd.expires_at<now())`);
   await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='telemetry_timeout' WHERE status IN ('queued','running','paused') AND COALESCE(last_telemetry_at,created_at)<now()-interval '90 seconds'");
   await c.query("UPDATE spff.adaptive_fert_commands SET status='expired' WHERE status='pending' AND expires_at<now()");
   await c.query(`UPDATE spff.adaptive_fert_sessions s SET status='fault',reason='start_expired_before_dispatch' WHERE status='queued' AND EXISTS(SELECT 1 FROM spff.adaptive_fert_commands cmd WHERE cmd.site_id=s.site_id AND cmd.session_id=s.session_id AND cmd.payload->>'commandType'='start' AND cmd.status='expired')`);
   rows=(await c.query(`SELECT cmd.*,s.device_id FROM spff.adaptive_fert_commands cmd JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
    WHERE cmd.status='pending' AND cmd.expires_at>now() AND (s.status NOT IN ('completed','fault') OR cmd.payload->>'commandType'='reset_fault')
    AND (cmd.payload->>'commandType' NOT IN ('start','resume') OR $1::boolean)
    AND (cmd.payload->>'commandType'<>'start' OR NOT EXISTS(SELECT 1 FROM spff.adaptive_fert_commands earlier WHERE earlier.site_id=cmd.site_id AND earlier.session_id=cmd.session_id AND earlier.created_at<cmd.created_at AND earlier.status IN ('pending','dispatching','forwarded')))
    ORDER BY cmd.created_at FOR UPDATE OF cmd SKIP LOCKED LIMIT 10`,[process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true'])).rows;
   for(const row of rows)await c.query("UPDATE spff.adaptive_fert_commands SET status='dispatching',dispatch_started_at=now() WHERE site_id=$1 AND command_id=$2",[row.site_id,row.command_id]);
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
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const added=await c.query('INSERT INTO spff.adaptive_fert_events(site_id,device_id,message_id,payload,received_at)VALUES($1,$2,$3,$4,$5)ON CONFLICT DO NOTHING RETURNING message_id',[event.siteId,event.deviceId,event.messageId,JSON.stringify(payload),event.receivedAt]);
   if(!added.rows.length){await c.query('COMMIT');return;}
   // Unsolicited/old-session packets are retained for diagnosis but cannot allocate program dose.
   // IDLE retains the last session ID in this firmware. Preserve it as boot /
   // readiness evidence without reopening a terminal session or adding dose.
   if(payload.kind==='adaptive_fert_telemetry'&&payload.state==='IDLE'){await c.query('COMMIT');return;}
   const row=(await c.query('SELECT * FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND device_id=$2 AND session_id::text=$3 FOR UPDATE',[event.siteId,event.deviceId,payload.sessionId])).rows[0];
   if(row){
    const at=Date.parse(payload.kind==='adaptive_fert_ack'?payload.acknowledgedAt:payload.timestamp);
    if(at>=row.created_at.getTime()-1000&&at<=Date.now()+5000){
     if(payload.kind==='adaptive_fert_gateway_ack'){
      await c.query(`UPDATE spff.adaptive_fert_commands SET status=$4,ack=$5 WHERE site_id=$1 AND session_id=$2 AND command_id::text=$3 AND status IN ('dispatching','unknown')`,[event.siteId,row.session_id,payload.commandId,payload.status,JSON.stringify(payload)]);
     }else if(payload.kind==='adaptive_fert_ack'){
      await c.query(`UPDATE spff.adaptive_fert_commands SET status=$4,ack=$5 WHERE site_id=$1 AND session_id=$2 AND command_id::text=$3 AND status NOT IN ('completed','rejected')`,[event.siteId,row.session_id,payload.commandId,payload.status,JSON.stringify(payload)]);
      if(payload.status==='fault'&&!['completed','fault'].includes(row.status)&&(!row.last_telemetry_at||at>=row.last_telemetry_at.getTime()))await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason=$3 WHERE site_id=$1 AND session_id=$2",[event.siteId,row.session_id,payload.reason]);
      // Firmware reuses the start ID for control ACKs. Do not invent a correlation to a new command.
      if(payload.status==='rejected'&&payload.commandId===row.command_snapshot.commandId&&row.status==='queued')await c.query("UPDATE spff.adaptive_fert_sessions SET status='fault',reason=$3 WHERE site_id=$1 AND session_id=$2",[event.siteId,row.session_id,payload.reason]);
     }else{
      const newer=!row.last_telemetry_at||at>=row.last_telemetry_at.getTime();
      if(newer){
       const measured=payload.firmwareVersion==='1.5.03-SHT20-TELEMETRY-SYNC'&&typeof row.command_snapshot.bootId==='string'&&payload.bootId===row.command_snapshot.bootId&&payload.volumeEstimated===false&&payload.flowValid===true&&payload.flowAgeMs!==undefined&&payload.flowAgeMs<=25000&&payload.waterPumpKnown===true&&payload.fertPumpKnown===true;
       const terminal=row.status==='completed'||row.status==='fault';
       let status=payload.state==='COMPLETED'?'completed':payload.state==='FAULT'?'fault':payload.state==='PAUSED'?'paused':'running';
       if((payload.state==='COMPLETED'||payload.state==='FAULT')&&(payload.waterPump||payload.fertPump))status='reconciliation_required';
       if(payload.state==='FAULT'||payload.ecTargetUnreachable||row.status==='reconciliation_required')status='reconciliation_required';
       if(!measured||payload.ecValid!==true||payload.ecAgeMs===undefined||payload.ecAgeMs>30000)status='reconciliation_required';
       if(terminal&&status!==row.status)status='reconciliation_required';
       if(payload.waterVolumeL+1e-6<row.water_volume_l||payload.fertVolumeL+1e-6<row.fert_volume_l)status='reconciliation_required';
       const mass=payload.fertVolumeL*row.command_snapshot.nominalConcentrationGPerL;
       if(payload.fertVolumeL>row.command_snapshot.targetFertVolumeL+Math.max(0.1,row.command_snapshot.targetFertVolumeL*0.05)||Math.abs(payload.fertMassGrams-mass)>Math.max(1,mass*0.02))status='reconciliation_required';
       await c.query(`UPDATE spff.adaptive_fert_sessions SET water_volume_l=GREATEST(water_volume_l,$3),fert_volume_l=GREATEST(fert_volume_l,$4),last_telemetry_at=$5,last_telemetry=$6,status=$7,reason=$8 WHERE site_id=$1 AND session_id=$2`,[event.siteId,row.session_id,measured?payload.waterVolumeL:row.water_volume_l,measured?payload.fertVolumeL:row.fert_volume_l,payload.timestamp,JSON.stringify(payload),status,measured?payload.faultReason:'unverified_meter_or_boot']);
      }
     }
    }
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
