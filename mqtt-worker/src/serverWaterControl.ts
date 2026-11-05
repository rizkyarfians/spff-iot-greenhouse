import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

/** Supervised water control through the existing set_pump outbox. */
export async function tickServerWater(client:PoolClient,enabled:boolean){
 const candidates=(await client.query(`SELECT site_id,device_id,session_id
  FROM spff.adaptive_fert_sessions WHERE command_snapshot->>'kind'='server_water_control'
  AND status NOT IN ('completed','fault')`)).rows;
 for(const candidate of candidates){
  const {site_id:site,device_id:device,session_id:id}=candidate;
  const lock=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
   [`soil-ec:${site}:${device}`])).rows[0];
  if(!lock?.acquired)continue;
  const row=(await client.query(`SELECT s.*,c.status AS on_status,c.expires_at AS on_expires,
    m.shadow_enabled,t.recorded_at AS sample_at,t.tank_water_level_pct,t.flow_water_lpm,t.flow_water_total_l,t.sensor_health,
    coalesce(t.raw_payload#>>'{sensorHealth,soil_2_moisture,pollBootId}',
             t.raw_payload#>>'{sensorHealth,soil_1_moisture,pollBootId}') AS sample_boot_id,
    h.recorded_at AS heartbeat_at,h.online,h.raw_payload AS heartbeat
   FROM spff.adaptive_fert_sessions s
   JOIN spff.control_commands c ON c.command_id=s.command_snapshot->>'startCommandId'
   LEFT JOIN spff.hst_execution_modes m ON m.site_id=s.site_id
   LEFT JOIN LATERAL (SELECT * FROM spff.telemetry_samples WHERE site_id=s.site_id AND device_id=s.device_id
    ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1) t ON true
   LEFT JOIN LATERAL (SELECT * FROM spff.device_status_events WHERE site_id=s.site_id AND device_id=s.device_id
    ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1) h ON true
   WHERE s.site_id=$1 AND s.session_id=$2 AND s.status NOT IN ('completed','fault') FOR UPDATE OF s`,[site,id])).rows[0];
  if(!row)continue;
  const now=Date.now();
  const recent=(value:unknown,maxAge:number)=>value instanceof Date&&now-value.getTime()>=-5000&&now-value.getTime()<=maxAge;
  const snapshot=row.command_snapshot;
  const heartbeat=row.heartbeat;
  const sameBoot=recent(row.heartbeat_at,90000)&&row.online===true&&heartbeat?.pulseBootId===snapshot.bootId;
  const validSensor=recent(row.sample_at,60000)&&row.sample_boot_id===snapshot.bootId&&row.sensor_health?.tank_water_level_pct?.valid===true&&
    Number.isFinite(row.tank_water_level_pct)&&row.sensor_health?.flow_water_lpm?.valid===true&&Number.isFinite(row.flow_water_lpm)&&
    row.sensor_health?.flow_water_total_l?.valid===true&&
    Number.isFinite(row.flow_water_total_l)&&row.flow_water_total_l>=snapshot.baselineWaterL;
  const measured=validSensor&&sameBoot?row.flow_water_total_l-snapshot.baselineWaterL:null;
  const volume=measured!==null&&measured>=row.water_volume_l?measured:null;
  if(volume!==null)await client.query(`UPDATE spff.adaptive_fert_sessions SET water_volume_l=$3,last_telemetry_at=$4
   WHERE site_id=$1 AND session_id=$2`,[site,id,volume,row.sample_at]);
  const manualStop=(await client.query(`SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
   AND actuator_key='pump_water' AND NOT requested_is_active AND issued_at>=$3 LIMIT 1`,[site,device,row.created_at])).rows.length>0;
  const stopReason=row.status==='reconciliation_required'?row.reason:
   manualStop?'operator_stop':
   !enabled||row.shadow_enabled!==false?'server_gate_closed':
   !sameBoot||heartbeat.waterInterlockEnabled!==true?'device_or_interlock_unverified':
   !validSensor||volume===null?'sensor_stale_or_meter_invalid':
   row.tank_water_level_pct===0?'tank_water_empty':
   heartbeat.aiAccTankGuardHealthy!==true?'tank_protection':
   row.status==='running'&&heartbeat.pumpReadbackValid===true&&heartbeat.pumpWaterActualActive===false?'device_stopped':
   now>=Date.parse(snapshot.deadline)?'max_runtime':
   ['rejected','timed_out','failed'].includes(row.on_status)?'start_unconfirmed':
   row.on_status==='completed'&&now-row.created_at.getTime()>45000&&
    row.sensor_health?.flow_water_lpm?.valid===true&&row.flow_water_lpm===0?'no_water_flow':null;
  if(!stopReason){
   if(row.on_status==='completed'&&heartbeat.pumpReadbackValid===true&&heartbeat.pumpWaterActualActive===true)
    await client.query("UPDATE spff.adaptive_fert_sessions SET status='running' WHERE site_id=$1 AND session_id=$2",[site,id]);
   continue;
  }
  await client.query(`UPDATE spff.control_commands SET status='failed',reason='server_water_stop'
   WHERE command_id=$1 AND status='pending'`,[snapshot.startCommandId]);
  await client.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason=$3 WHERE site_id=$1 AND session_id=$2",
   [site,id,stopReason]);
  const stop=(await client.query(`SELECT c.expires_at,c.status,a.acknowledged_at
   FROM spff.control_commands c LEFT JOIN LATERAL(
    SELECT acknowledged_at FROM spff.command_ack_events WHERE command_id=c.command_id
     AND status='completed' AND actual_is_active=false ORDER BY acknowledged_at DESC LIMIT 1
   ) a ON true
   WHERE c.site_id=$1 AND c.device_id=$2 AND c.request_payload->>'source'='spff-server-fuzzy-water-stop'
    AND c.request_payload->>'sessionId'=$3 ORDER BY c.issued_at DESC LIMIT 1`,[site,device,id])).rows[0];
  // A late in-flight ON cannot outlive its own expiry. Wait for verified OFF after that window.
  if(stop?.acknowledged_at instanceof Date&&stop.acknowledged_at>=row.on_expires&&sameBoot&&
     heartbeat.pumpReadbackValid===true&&heartbeat.pumpWaterActualActive===false&&heartbeat.pumpFertActualActive===false&&
     row.heartbeat_at>=stop.acknowledged_at&&volume!==null&&row.sample_at>=stop.acknowledged_at){
   await client.query(`UPDATE spff.dose_volume_bindings SET evidence_verified=true,evidence_basis='DEVICE_TERMINAL_MEASURED'
    WHERE site_id=$1 AND session_id=$2`,[site,id]);
   await client.query("UPDATE spff.adaptive_fert_sessions SET status='completed' WHERE site_id=$1 AND session_id=$2",[site,id]);
  }else if(!stop||(stop.expires_at.getTime()<=now&&(!stop.acknowledged_at||stop.acknowledged_at<row.on_expires))){
   await client.query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,
    requested_is_active,requested_by,issued_at,expires_at,request_payload)
    VALUES($1,$2,$3,'pump_water',false,'ai-fuzzy-water-stop',now(),now()+interval '15 seconds',
     jsonb_build_object('source','spff-server-fuzzy-water-stop','sessionId',$4::text))`,[randomUUID(),site,device,id]);
  }
 }
}
