import type { PoolClient } from 'pg';

/** Reuse durable alarm incidents; repeated coordinator ticks do not spam the bell. */
export async function observeSoilEcPumpAlert(client: Pick<PoolClient,'query'>, siteId:string, deviceId:string,
  failing:boolean, reason:string, sessionId:string|null=null, target='pump_fert', source='soil-ec') {
  const incident=source==='schedule'?`scheduled_start:${target}`:'soil_ec_execution:pump_fert';
  const state=(await client.query(`SELECT a.metadata,s.active_alarm_id FROM spff.alarm_rule_states s
    LEFT JOIN spff.alarms a ON a.alarm_id=s.active_alarm_id
    WHERE s.site_id=$1 AND s.device_id=$2 AND s.incident_key=$3`,[siteId,deviceId,incident])).rows[0];
  if(failing && state?.active_alarm_id && state.metadata?.reason===reason && (state.metadata?.sessionId??null)===sessionId)return;
  if(!failing && !state?.active_alarm_id)return;
  await client.query(`SELECT spff.apply_alarm_observation($1,$2,'command_failed',$3,$6,$4,clock_timestamp(),NULL,NULL,$5::jsonb)`,
    [siteId,deviceId,incident,failing,JSON.stringify({source,reason,sessionId,requestedIsActive:true}),target]);
}

// These are routine waiting states, not evidence that starting a pump failed.
export const soilEcWaitingReasons=new Set(['waiting_evaluation','automatic_session_started','schedule_priority',
  'waiting_new_samples','settling','target_confirmation','soil_ec_unstable','soil_ec_above_start_threshold','soil_ec_target_stable']);

/** Timer schedules run locally; alert on missing ON confirmation after a 30s grace. */
export async function observeScheduledPumpAlerts(client:Pick<PoolClient,'query'>,siteId='greenhouse-01') {
 const schedules=await client.query(`SELECT a.site_id,a.device_id,a.actuator_key,
    min(((now() AT TIME ZONE a.timezone)::date+a.on_time) AT TIME ZONE a.timezone) AS starts_at,
    latest.is_active,latest.recorded_at
  FROM spff.actuator_schedules a
  JOIN spff.device_automatic_control_configs c USING(site_id,device_id)
  JOIN LATERAL(SELECT online,recorded_at,raw_payload FROM spff.device_status_events st
    WHERE st.site_id=a.site_id AND st.device_id=a.device_id ORDER BY received_at DESC,device_status_id DESC LIMIT 1) st ON true
  LEFT JOIN LATERAL(SELECT is_active,recorded_at FROM spff.actuator_state_events ev
    WHERE ev.site_id=a.site_id AND ev.device_id=a.device_id AND ev.actuator_key=a.actuator_key
    ORDER BY recorded_at DESC,actuator_state_id DESC LIMIT 1) latest ON true
  WHERE a.site_id=$1 AND a.enabled AND a.actuator_key IN ('pump_water','pump_fert')
    AND c.desired_mode='automatic' AND c.applied_mode='automatic'
    AND c.acknowledgement_status='applied' AND c.acknowledged_revision=c.revision
    AND st.online AND st.recorded_at BETWEEN now()-interval '90 seconds' AND now()
    AND st.raw_payload->>'independentSoilEcCapable'='true'
    AND (now() AT TIME ZONE a.timezone)::time>=a.on_time
    AND (now() AT TIME ZONE a.timezone)::time<a.off_time
    AND (a.repeat_rule='daily' OR (a.repeat_rule='weekdays' AND extract(isodow FROM now() AT TIME ZONE a.timezone)<=5)
      OR (a.repeat_rule='weekends' AND extract(isodow FROM now() AT TIME ZONE a.timezone)>=6)
      OR (a.repeat_rule='once' AND a.run_date=(now() AT TIME ZONE a.timezone)::date))
  GROUP BY a.site_id,a.device_id,a.actuator_key,latest.is_active,latest.recorded_at
  HAVING min(((now() AT TIME ZONE a.timezone)::date+a.on_time) AT TIME ZONE a.timezone)<now()-interval '30 seconds'`,[siteId]);
 for(const s of schedules.rows){
  const confirmed=s.is_active===true && s.recorded_at>=s.starts_at;
  await observeSoilEcPumpAlert(client,s.site_id,s.device_id,!confirmed,'schedule_start_unconfirmed',s.starts_at.toISOString(),s.actuator_key,'schedule');
 }
}

/** Notification failures must not roll back a pump STOP or a validated session. */
export async function observeSoilEcPumpAlertInTransaction(client:Pick<PoolClient,'query'>,siteId:string,deviceId:string,
 failing:boolean,reason:string,sessionId:string|null=null) {
 await client.query('SAVEPOINT soil_ec_notification');
 try{await observeSoilEcPumpAlert(client,siteId,deviceId,failing,reason,sessionId);}
 catch(error){await client.query('ROLLBACK TO SAVEPOINT soil_ec_notification');console.error('[soil-ec-notification]',error);}
 finally{await client.query('RELEASE SAVEPOINT soil_ec_notification');}
}
