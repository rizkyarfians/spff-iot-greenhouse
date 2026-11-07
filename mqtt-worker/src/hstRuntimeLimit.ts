import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

export function hstRuntimeSeconds(configured:unknown):number {
  const n=Number(configured);
  return Number.isInteger(n)&&n>0?Math.min(n,900):900;
}

/** Durable server timeout. Repeated ticks/restarts do not reset a running cycle. */
export async function enforceHstRuntimeLimit(client:PoolClient,now=new Date()) {
  const rows=(await client.query(`SELECT h.*,w.request_payload AS water_payload,
    coalesce(least(w.published_at,f.published_at),h.started_at) AS runtime_start,
    cfg.water_max_runtime_seconds,
    coalesce((SELECT max(a.acknowledged_at) FROM spff.command_ack_events a
      WHERE a.command_id IN (h.water_command_id,h.fertilizer_command_id)
        AND a.status='completed' AND a.actual_is_active),h.started_at) AS confirmed_on_at
    FROM spff.hst_fertilization_starts h
    JOIN (SELECT DISTINCT ON(site_id,device_id) start_id FROM spff.hst_fertilization_starts
      ORDER BY site_id,device_id,created_at DESC,start_id DESC) latest USING(start_id)
    JOIN spff.control_commands w ON w.command_id=h.water_command_id
    JOIN spff.control_commands f ON f.command_id=h.fertilizer_command_id
    LEFT JOIN spff.device_automatic_control_configs cfg ON cfg.site_id=h.site_id AND cfg.device_id=h.device_id
    WHERE h.status='started' AND w.request_payload->>'hstRuntimeCompletedAt' IS NULL
    FOR UPDATE OF h SKIP LOCKED`)).rows;
  for(const row of rows) {
    const at=row.runtime_start instanceof Date?row.runtime_start:new Date(row.runtime_start);
    if(!Number.isFinite(at.getTime())||!row.confirmed_on_at) continue;
    const payload=row.water_payload??{};
    const seconds=hstRuntimeSeconds(payload.hstRuntimeLimitSeconds??row.water_max_runtime_seconds);
    // Adopt an already-running HST once, keeping the original published ON time.
    if(payload.hstRuntimeLimitSeconds==null) await client.query(`UPDATE spff.control_commands
      SET request_payload=coalesce(request_payload,'{}'::jsonb)||$2::jsonb WHERE command_id=$1`,
      [row.water_command_id,JSON.stringify({hstRuntimeLimitSeconds:seconds})]);
    const ended=(await client.query(`SELECT recorded_at FROM spff.device_status_events
      WHERE site_id=$1 AND device_id=$2 AND online AND recorded_at>$3 AND recorded_at<=$4
        AND raw_payload @> '{"pumpReadbackValid":true,"pumpWaterActualActive":false,"pumpFertActualActive":false}'::jsonb
      ORDER BY recorded_at LIMIT 1`,[row.site_id,row.device_id,row.confirmed_on_at,now])).rows[0];
    // A later ON belongs to a different owner; do not stop it using an old HST deadline.
    const transferred=(await client.query(`SELECT 1 FROM spff.control_commands
      WHERE site_id=$1 AND device_id=$2 AND requested_is_active AND issued_at>$3 AND issued_at<=$4
        AND command_id NOT IN ($5,$6) AND status IN ('published','accepted','completed') LIMIT 1`,
      [row.site_id,row.device_id,at,now,row.water_command_id,row.fertilizer_command_id])).rows.length>0;
    const offAcks=(await client.query(`SELECT count(DISTINCT c.actuator_key)::int AS n FROM spff.control_commands c
      JOIN spff.command_ack_events a USING(command_id)
      WHERE c.site_id=$1 AND c.device_id=$2 AND c.requested_by='hst-runtime-limit'
        AND c.request_payload->>'startId'=$3 AND a.status='completed' AND a.actual_is_active=false`,
      [row.site_id,row.device_id,row.start_id])).rows[0]?.n===2;
    if(ended||transferred||offAcks) {
      await client.query(`UPDATE spff.control_commands SET request_payload=coalesce(request_payload,'{}'::jsonb)||$2::jsonb
        WHERE command_id=$1`,[row.water_command_id,JSON.stringify({hstRuntimeCompletedAt:now.toISOString(),
          hstRuntimeEndReason:offAcks?'runtime_limit':transferred?'ownership_transferred':'device_stopped'})]);
      continue;
    }
    if(now.getTime()-at.getTime()<seconds*1000) continue;
    for(const actuator of ['pump_water','pump_fert']) {
      const pending=(await client.query(`SELECT 1 FROM spff.control_commands
        WHERE site_id=$1 AND device_id=$2 AND actuator_key=$3 AND requested_by='hst-runtime-limit'
          AND request_payload->>'startId'=$4 AND issued_at<=$5 AND
          ((status IN ('pending','published','accepted') AND expires_at>$5) OR issued_at>$5::timestamptz-interval '15 seconds') LIMIT 1`,
        [row.site_id,row.device_id,actuator,row.start_id,now])).rows.length>0;
      if(pending) continue;
      await client.query(`INSERT INTO spff.control_commands(command_id,site_id,device_id,actuator_key,
        requested_is_active,requested_by,issued_at,expires_at,request_payload)
        VALUES($1,$2,$3,$4,false,'hst-runtime-limit',$5,$5::timestamptz+interval '30 seconds',$6)`,
        [randomUUID(),row.site_id,row.device_id,actuator,now,JSON.stringify({source:'hst-runtime-limit',
          startId:row.start_id,phaseId:row.phase_id,reason:'hst_runtime_limit',maxRuntimeSeconds:seconds})]);
      console.log('[hst-runtime-limit] OFF queued',{deviceId:row.device_id,targetId:actuator,maxRuntimeSeconds:seconds});
    }
  }
}
