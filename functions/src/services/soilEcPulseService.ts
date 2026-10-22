import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { decideSoilEcPulse, fertigationPulseSchema, startSoilEcSessionSchema,
  soilEcPulseProfileSchema, type FertigationRecipe, type SoilEcPulseProfile, type SoilEcSample } from '@spff/contracts';
import { pool, configuredSiteId as siteId } from './postgresRepository.js';
import { getFertigationRecipe, listFertigationRecipes } from './fertigationRepository.js';
import { applicationDue, jakartaDay } from './fertigationSchedule.js';

export const soilEcPulsesEnabled = () => process.env.SPFF_SOIL_EC_PULSES_ENABLED === 'true' && (process.env.AI_EVALUATION_ENABLED??'true').trim().toLowerCase() === 'true';
export async function soilEcPulseStorageReady() {
  const r=await pool.query("SELECT to_regclass('spff.soil_ec_pulse_sessions') IS NOT NULL AS ready");
  return r.rows[0]?.ready===true;
}
type Session = { session_id: string; device_id: string; recipe_id: string; recipe_revision: string;
  application_day: string; profile: SoilEcPulseProfile; rule_snapshot: { automaticRevision: string; bootId: string }; status: string;
  cycles: number; total_on_ms: string; previous_ec: number | null; no_response_cycles: number;
  settle_until: Date; started_at: Date; reason: string };
function fail(message: string): never { throw Object.assign(new Error(message), { status: 409 }); }
async function equipment(client: PoolClient, deviceId: string, waterWithPulse: boolean) {
  const result = await client.query(`SELECT c.revision,c.desired_mode,c.applied_mode,c.acknowledged_revision,c.acknowledgement_status,
    c.fertilizer_enabled,st.recorded_at,st.online,st.mode,st.raw_payload,
    ss.revision AS schedule_revision,ss.acknowledged_revision AS schedule_ack,ss.acknowledgement_status AS schedule_status,
    crop.crop_id,
    EXISTS(SELECT 1 FROM spff.actuator_schedules a WHERE a.site_id=d.site_id AND a.device_id=d.device_id
      AND a.actuator_key='pump_fert' AND a.enabled AND (now() AT TIME ZONE a.timezone)::time >= a.on_time
      AND (now() AT TIME ZONE a.timezone)::time < a.off_time
      AND (a.repeat_rule='daily' OR (a.repeat_rule='weekdays' AND extract(isodow FROM now() AT TIME ZONE a.timezone)<=5)
        OR (a.repeat_rule='weekends' AND extract(isodow FROM now() AT TIME ZONE a.timezone)>=6)
        OR (a.repeat_rule='once' AND a.run_date=(now() AT TIME ZONE a.timezone)::date))) AS fert_window,
    EXISTS(SELECT 1 FROM spff.actuator_schedules a WHERE a.site_id=d.site_id AND a.device_id=d.device_id
      AND a.actuator_key='pump_water' AND a.enabled AND (now() AT TIME ZONE a.timezone)::time >= a.on_time
      AND (now() AT TIME ZONE a.timezone)::time < a.off_time
      AND (a.repeat_rule='daily' OR (a.repeat_rule='weekdays' AND extract(isodow FROM now() AT TIME ZONE a.timezone)<=5)
        OR (a.repeat_rule='weekends' AND extract(isodow FROM now() AT TIME ZONE a.timezone)>=6)
        OR (a.repeat_rule='once' AND a.run_date=(now() AT TIME ZONE a.timezone)::date))) AS water_window
    FROM spff.devices d
    JOIN spff.device_automatic_control_configs c USING(site_id,device_id)
    JOIN spff.device_schedule_sync_state ss USING(site_id,device_id)
    LEFT JOIN spff.site_crop_selections crop ON crop.site_id=d.site_id AND crop.zone_id='soil-1'
    LEFT JOIN LATERAL(SELECT * FROM spff.device_status_events WHERE site_id=d.site_id AND device_id=d.device_id
      ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1) st ON true
    WHERE d.site_id=$1 AND d.device_id=$2 AND d.enabled`, [siteId, deviceId]);
  const r = result.rows[0];
  if (!r || r.fertilizer_enabled || !r.online || r.mode !== 'automatic' || r.desired_mode !== 'automatic' || r.applied_mode !== 'automatic' ||
      r.acknowledgement_status !== 'applied' || String(r.revision) !== String(r.acknowledged_revision) ||
      !r.recorded_at || Date.now() - r.recorded_at.getTime() > 90000 || r.recorded_at.getTime() > Date.now() ||
      r.raw_payload?.serverPulseCapable !== true || !/^[a-fA-F0-9]{16}$/.test(r.raw_payload?.pulseBootId??'') || r.schedule_status !== 'applied' ||
      String(r.schedule_revision) !== String(r.schedule_ack) || !r.fert_window || (waterWithPulse && !r.water_window))
    fail('Perangkat, mode, firmware pulse, atau jadwal belum siap.');
  return r;
}
function validateRule(rule: FertigationRecipe | null, cropId: string, now = new Date()): asserts rule is FertigationRecipe {
  if (!rule || rule.zoneId !== 'soil-1' || rule.cropId !== cropId || rule.approvalStatus !== 'approved' ||
      !rule.approvalReference || !applicationDue(rule, jakartaDay(now)) || rule.targetStockL <= 0 ||
      rule.ecLowUsCm === null || rule.ecTargetUsCm === null || rule.ecHighUsCm === null)
    fail('Aturan tanaman/HST atau target EC tanah belum siap.');
}
export async function listSoilEcSessions(deviceId: string) {
  const r = await pool.query(`SELECT s.*,COALESCE((SELECT jsonb_agg(c ORDER BY c.cycle,c.created_at)
    FROM spff.soil_ec_pulse_commands c WHERE c.session_id=s.session_id),'[]'::jsonb) AS commands
    FROM spff.soil_ec_pulse_sessions s WHERE s.site_id=$1 AND s.device_id=$2 ORDER BY started_at DESC LIMIT 20`, [siteId, deviceId]);
  return r.rows;
}
export async function startSoilEcSession(input: unknown, actor: string) {
  const parsed = startSoilEcSessionSchema.parse(input);
  if (!soilEcPulsesEnabled()) fail('Eksekusi pulse belum diaktifkan pada server.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`soil-ec:${siteId}:${parsed.deviceId}`]);
    const previous = await c.query('SELECT * FROM spff.soil_ec_pulse_sessions WHERE request_id=$1', [parsed.requestId]);
    if (previous.rows[0]) {
      if (previous.rows[0].site_id !== siteId || previous.rows[0].device_id !== parsed.deviceId ||
          previous.rows[0].recipe_id !== parsed.recipeId || JSON.stringify(soilEcPulseProfileSchema.parse(previous.rows[0].profile)) !== JSON.stringify(parsed.profile))
        fail('requestId sudah dipakai untuk permintaan berbeda.');
      await c.query('COMMIT'); return previous.rows[0];
    }
    const equipmentState = await equipment(c, parsed.deviceId, parsed.profile.waterWithPulse);
    await c.query('SELECT recipe_id FROM spff.fertigation_recipes WHERE recipe_id=$1 AND site_id=$2 FOR SHARE', [parsed.recipeId,siteId]);
    const rule = await getFertigationRecipe(parsed.recipeId);
    validateRule(rule, equipmentState.crop_id);
    const available = (await listFertigationRecipes()).filter((r): r is FertigationRecipe => r !== null &&
      r.cropId === rule.cropId && r.approvalStatus === 'approved' && applicationDue(r, jakartaDay(new Date())));
    if (available.length !== 1 || available[0]?.recipeId !== rule.recipeId) fail('Aturan tanaman/HST bertabrakan.');
    if (rule.ecTargetUsCm! + parsed.profile.toleranceUsCm >= rule.ecHighUsCm! ||
        rule.ecLowUsCm! >= rule.ecTargetUsCm! - parsed.profile.toleranceUsCm) fail('Toleransi bertabrakan dengan batas mulai/tinggi.');
    const blockers = await c.query(`SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2
      AND (status IN ('waiting','in_flight','fault') OR updated_at > now()-($3::bigint * interval '1 millisecond'))
      UNION ALL SELECT 1 FROM spff.soil_ec_pulse_commands pc JOIN spff.soil_ec_pulse_sessions ps USING(session_id)
        WHERE ps.site_id=$1 AND ps.device_id=$2 AND pc.status IN ('pending','published','accepted')
      UNION ALL SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2 AND status IN ('pending','published','accepted')
      LIMIT 1`, [siteId,parsed.deviceId,parsed.profile.cooldownMs]);
    if (blockers.rowCount) fail('Sesi, command, cooldown, atau fault perangkat belum selesai.');
    const id = randomUUID();
    const inserted = await c.query(`INSERT INTO spff.soil_ec_pulse_sessions
      (session_id,request_id,site_id,device_id,recipe_id,application_day,recipe_revision,profile,rule_snapshot,status,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting',$10) RETURNING *`, [id,parsed.requestId,siteId,parsed.deviceId,
      rule.recipeId,jakartaDay(new Date()),rule.revision,JSON.stringify(parsed.profile),JSON.stringify({ rule, automaticRevision:String(equipmentState.revision),bootId:equipmentState.raw_payload.pulseBootId }),actor]);
    await c.query('COMMIT'); return inserted.rows[0];
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function stopSession(c: PoolClient, s: Session, status: 'fault'|'cancelled'|'completed', reason: string, release = false) {
  // Stop is queued even when outcome is uncertain; duration timeout remains local.
  const id = randomUUID(), now = new Date();
  const command = { kind:release?'fertigation_pulse_release':'fertigation_pulse_stop',schemaVersion:1,siteId,deviceId:s.device_id,sessionId:s.session_id,
    commandId:id,cycle:Math.max(1,s.cycles),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30000).toISOString() };
  await c.query(`INSERT INTO spff.soil_ec_pulse_commands(command_id,session_id,cycle,operation,payload,expires_at)
    VALUES($1,$2,$3,$6,$4,$5) ON CONFLICT(session_id,cycle,operation) DO NOTHING`, [id,s.session_id,command.cycle,JSON.stringify(command),command.expiresAt,release?'release':'stop']);
  await c.query(`UPDATE spff.soil_ec_pulse_sessions SET status=$2,reason=$3,updated_at=now() WHERE session_id=$1`, [s.session_id,status,reason]);
}
export async function cancelSoilEcSession(id: string) {
  const c=await pool.connect();
  try { await c.query('BEGIN'); const r=await c.query<Session>('SELECT * FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND session_id=$2 FOR UPDATE',[siteId,id]);
    if (!r.rows[0]) fail('Sesi tidak ditemukan.');
    await stopSession(c,r.rows[0],'cancelled','operator_stop'); await c.query('COMMIT');
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
export async function releaseSoilEcOwnership(id:string) {
  const c=await pool.connect();
  try{await c.query('BEGIN');
    const r=await c.query<Session>('SELECT * FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND session_id=$2 FOR UPDATE',[siteId,id]);
    const s=r.rows[0];if(!s||!['completed','cancelled','fault'].includes(s.status))fail('Hentikan sesi sebelum melepas strategi.');
    const mode=await c.query(`SELECT 1 FROM spff.device_automatic_control_configs WHERE site_id=$1 AND device_id=$2
      AND desired_mode='manual' AND applied_mode='manual' AND acknowledged_revision=revision AND acknowledgement_status='applied'`,[siteId,s.device_id]);
    if(!mode.rowCount)fail('Terapkan mode Manual pada perangkat sebelum melepas strategi pulse.');
    await stopSession(c,s,'cancelled','release_requested',true);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function advanceSoilEcSession(id: string) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const locked=await c.query<Session>(`SELECT s.*,to_char(application_day,'YYYY-MM-DD') AS application_day FROM spff.soil_ec_pulse_sessions s WHERE session_id=$1
      AND status IN ('waiting','in_flight') FOR UPDATE SKIP LOCKED`,[id]);
    const s=locked.rows[0]; if(!s){await c.query('COMMIT');return;}
    const p=soilEcPulseProfileSchema.parse(s.profile), now=Date.now();
    if(!soilEcPulsesEnabled() || s.application_day!==jakartaDay(new Date()) || now-s.started_at.getTime()>p.maxSessionMs) {
      await stopSession(c,s,'fault','disabled_or_session_timeout');await c.query('COMMIT');return;
    }
    const command=await c.query(`SELECT * FROM spff.soil_ec_pulse_commands WHERE session_id=$1 AND operation='pulse' ORDER BY cycle DESC LIMIT 1`,[id]);
    const last=command.rows[0];
    if(last && ['pending','published','accepted'].includes(last.status)) {
      if(now > last.expires_at.getTime()+last.payload.params.onDurationMs+10000)
        await stopSession(c,s,'fault','pulse_outcome_unknown');
      await c.query('COMMIT');return;
    }
    if(last && last.status!=='completed') {await stopSession(c,s,'fault','device_rejected_or_fault');await c.query('COMMIT');return;}
    if(s.status==='in_flight') {
      // Server receive time is authoritative for settling; device clock cannot shorten it.
      await c.query(`UPDATE spff.soil_ec_pulse_sessions SET status='waiting',settle_until=$2,updated_at=now() WHERE session_id=$1`,
        [id,new Date(last.finished_at.getTime()+p.settleMs)]);
      s.settle_until=new Date(last.finished_at.getTime()+p.settleMs);
    }
    let rule: FertigationRecipe|null=null;
    try {
      const state=await equipment(c,s.device_id,p.waterWithPulse);
      await c.query('SELECT recipe_id FROM spff.fertigation_recipes WHERE recipe_id=$1 FOR SHARE',[s.recipe_id]);
      rule=await getFertigationRecipe(s.recipe_id);validateRule(rule,state.crop_id);
      if(String(rule.revision)!==String(s.recipe_revision) || String(state.revision)!==s.rule_snapshot.automaticRevision || state.raw_payload.pulseBootId!==s.rule_snapshot.bootId)
        fail('rule_or_mode_revision_changed');
    } catch {
      await stopSession(c,s,'fault','rule_mode_schedule_or_device_changed');await c.query('COMMIT');return;
    }
    const readings=await c.query(`SELECT DISTINCT ON(recorded_at) recorded_at,received_at,
      soil_1_ec_us_cm AS ec,soil_1_moisture AS moisture,sensor_health,
      tank_water_level_pct,tank_fert_level_pct FROM spff.telemetry_samples
      WHERE site_id=$1 AND device_id=$2 ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 20`,[siteId,s.device_id]);
    const samples:SoilEcSample[]=readings.rows.map(r=>({recordedAt:r.recorded_at.toISOString(),ec:r.ec,moisture:r.moisture,
      valid:r.sensor_health?.soil_1_ec_us_cm?.valid===true && r.sensor_health?.soil_1_moisture?.valid===true &&
        r.ec!==null && Number.isFinite(r.ec) && r.ec>=0 && r.ec<=100000 &&
        r.moisture!==null && Number.isFinite(r.moisture) && r.moisture>=0 && r.moisture<=100}));
    const latest=readings.rows[0];
    // Tank gates are checked on server using explicit per-parameter health; never infer stock litres.
    const tankOk=latest && ['tank_water_level_pct','tank_fert_level_pct'].every(k=>
      latest.sensor_health?.[k]?.valid===true && Number.isFinite(latest[k]) && latest[k]>=0 && latest[k]<=100) &&
      latest.tank_water_level_pct>=rule.minWaterTankPercent && latest.tank_fert_level_pct>=rule.minStockTankPercent;
    if(!tankOk){await stopSession(c,s,'fault','tank_sensor_or_level_invalid');await c.query('COMMIT');return;}
    const daily=await c.query(`SELECT COALESCE(sum(total_on_ms),0) AS total FROM spff.soil_ec_pulse_sessions
      WHERE site_id=$1 AND device_id=$2 AND application_day=$3`,[siteId,s.device_id,jakartaDay(new Date())]);
    const decision=decideSoilEcPulse({nowMs:now,afterMs:s.settle_until.getTime(),samples,
      target:rule.ecTargetUsCm!,high:rule.ecHighUsCm!,startLow:rule.ecLowUsCm!,cycles:s.cycles,
      totalOnMs:Number(s.total_on_ms),dailyOnMs:Number(daily.rows[0].total),previousEc:s.previous_ec,
      noResponseCycles:s.no_response_cycles,profile:p});
    if(decision.action==='fault'||decision.action==='complete') {
      await stopSession(c,s,decision.action==='complete'?'completed':'fault',decision.reason);
    } else if(decision.action==='wait') {
      await c.query('UPDATE spff.soil_ec_pulse_sessions SET reason=$2 WHERE session_id=$1',[id,decision.reason]);
    } else {
      const commandId=randomUUID(),cycle=s.cycles+1,issued=new Date();
      const payload=fertigationPulseSchema.parse({kind:'fertigation_pulse',bootId:s.rule_snapshot.bootId,schemaVersion:1,siteId,deviceId:s.device_id,
        sessionId:id,commandId,cycle,issuedAt:issued.toISOString(),expiresAt:new Date(now+15000).toISOString(),targetId:'pump_fert',
        params:{onDurationMs:decision.onMs,waterWithPulse:p.waterWithPulse,minFlowLpm:p.minFlowLpm,flowSensorKey:p.flowSensorKey}});
      await c.query(`INSERT INTO spff.soil_ec_pulse_commands(command_id,session_id,cycle,operation,payload,expires_at)
        VALUES($1,$2,$3,'pulse',$4,$5)`,[commandId,id,cycle,JSON.stringify(payload),payload.expiresAt]);
      const noResponse=s.previous_ec!==null && decision.ec!-s.previous_ec<p.minimumRiseUsCm?s.no_response_cycles+1:0;
      await c.query(`UPDATE spff.soil_ec_pulse_sessions SET status='in_flight',cycles=$2,total_on_ms=total_on_ms+$3,
        previous_ec=$4,no_response_cycles=$5,reason=$6,updated_at=now() WHERE session_id=$1`,[id,cycle,decision.onMs,decision.ec,noResponse,decision.reason]);
    }
    await c.query('COMMIT');
  } catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}
export function startSoilEcCoordinator() {
  let running=false;
  const timer=setInterval(()=>{if(running)return;running=true;
    void pool.query(`SELECT session_id FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND status IN ('waiting','in_flight')`,[siteId])
      .then(async r=>{for(const row of r.rows)await advanceSoilEcSession(row.session_id);})
      .catch((e:unknown)=>console.error('[soil-ec-coordinator]',e)).finally(()=>{running=false;});},2000);
  timer.unref();return ()=>clearInterval(timer);
}
