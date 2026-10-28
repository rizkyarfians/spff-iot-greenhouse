import { randomUUID } from 'node:crypto';
import { observeSoilEcPumpAlert, observeSoilEcPumpAlertInTransaction, observeScheduledPumpAlerts, soilEcWaitingReasons } from './soilEcPumpAlerts.js';
import type { PoolClient } from 'pg';
import { decideSoilEcPulse, fertigationPulseSchema, startSoilEcSessionSchema,
  soilEcPulseProfileSchema, soilEcExecutionUpdateSchema, type SoilEcExecutionView,
  type FertigationRecipe, type SoilEcPulseProfile, type SoilEcSample } from '@spff/contracts';
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
async function executionInstalled() {
  const r=await pool.query("SELECT to_regclass('spff.device_soil_ec_execution_configs') IS NOT NULL AS ready");
  return r.rows[0]?.ready===true;
}
async function executionAllowed(c:PoolClient,deviceId:string) {
  if(!await executionInstalled()) return false;
  const r=await c.query('SELECT enabled FROM spff.device_soil_ec_execution_configs WHERE site_id=$1 AND device_id=$2',[siteId,deviceId]);
  return r.rows[0]?.enabled===true;
}
export async function readSoilEcExecution(deviceId:string):Promise<SoilEcExecutionView> {
  const device=await pool.query('SELECT 1 FROM spff.devices WHERE site_id=$1 AND device_id=$2 AND enabled',[siteId,deviceId]);
  if(!device.rowCount)fail('Perangkat tidak ditemukan.');
  const installed=await executionInstalled();
  const setting=installed?(await pool.query('SELECT enabled,revision FROM spff.device_soil_ec_execution_configs WHERE site_id=$1 AND device_id=$2',[siteId,deviceId])).rows[0]:null;
  const status=(await pool.query(`SELECT online,recorded_at,raw_payload FROM spff.device_status_events
    WHERE site_id=$1 AND device_id=$2 AND raw_payload ? 'serverPulseCapable'
    ORDER BY received_at DESC,device_status_id DESC LIMIT 1`,[siteId,deviceId])).rows[0];
  const age=status?.recorded_at?Date.now()-status.recorded_at.getTime():Infinity;
  const stops=await soilEcPulseStorageReady()?await pool.query(`SELECT count(*)::integer AS total FROM spff.soil_ec_pulse_sessions s
    WHERE s.site_id=$1 AND s.device_id=$2 AND s.status IN ('cancelled','fault','completed')
      AND NOT EXISTS(SELECT 1 FROM spff.soil_ec_pulse_commands pc WHERE pc.session_id=s.session_id
        AND pc.operation IN ('stop','release') AND pc.status='completed' AND pc.ack->>'pumpsOff'='true')`,[siteId,deviceId]):null;
  return {deviceId,installed,enabled:setting?.enabled??false,revision:setting?.revision??0,
    serverAvailable:soilEcPulsesEnabled(),capable:!!(status?.online&&age>=0&&age<90000&&status.raw_payload?.serverPulseCapable===true&&status.raw_payload?.independentSoilEcCapable===true),
    firmware:status?.raw_payload?.firmwareVersion??null,unconfirmedStopSessions:stops?.rows[0]?.total??0};
}
export async function setSoilEcExecution(input:unknown,actor:string) {
  const parsed=soilEcExecutionUpdateSchema.parse(input);
  if(!await executionInstalled())fail('Terapkan migration 030 terlebih dahulu.');
  // OFF remains available even if the deployment flag or MCU is unavailable.
  if(parsed.enabled&&!soilEcPulsesEnabled())fail('Eksekusi pulse belum diaktifkan pada konfigurasi server.');
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    // Same lock as MQTT publish: after OFF commits no new pulse can be published.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('soil-ec-dispatch',0))");
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`soil-ec:${siteId}:${parsed.deviceId}`]);
    const d=await c.query('SELECT 1 FROM spff.devices WHERE site_id=$1 AND device_id=$2 AND enabled',[siteId,parsed.deviceId]);
    if(!d.rowCount)fail('Perangkat tidak ditemukan.');
    const old=(await c.query('SELECT * FROM spff.device_soil_ec_execution_configs WHERE site_id=$1 AND device_id=$2 FOR UPDATE',[siteId,parsed.deviceId])).rows[0];
    const retry=old&&old.revision===parsed.expectedRevision+1&&old.enabled===parsed.enabled;
    if(!retry&&(old?.revision??0)!==parsed.expectedRevision)fail('Pengaturan berubah. Muat ulang sebelum menyimpan.');
    if(!retry)await c.query(`INSERT INTO spff.device_soil_ec_execution_configs(site_id,device_id,enabled,updated_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(site_id,device_id) DO UPDATE
      SET enabled=EXCLUDED.enabled,revision=device_soil_ec_execution_configs.revision+1,updated_at=now(),updated_by=EXCLUDED.updated_by`,
      [siteId,parsed.deviceId,parsed.enabled,actor]);
    if(!parsed.enabled) {
      const sessions=await c.query<Session>(`SELECT * FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2
        AND status IN ('waiting','in_flight','fault') ORDER BY session_id FOR UPDATE`,[siteId,parsed.deviceId]);
      for(const s of sessions.rows)await stopSession(c,s,'cancelled','ai_execution_disabled');
    }
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return readSoilEcExecution(parsed.deviceId);
}
export async function soilEcEquipment(client: PoolClient, deviceId: string) {
  const result = await client.query(`SELECT c.revision,c.desired_mode,c.applied_mode,c.acknowledged_revision,c.acknowledgement_status,
    c.fertilizer_enabled,st.recorded_at,st.online,st.mode,st.raw_payload,
    ss.revision AS schedule_revision,ss.acknowledged_revision AS schedule_ack,ss.acknowledgement_status AS schedule_status,
    crop.crop_id,
    EXISTS(SELECT 1 FROM spff.actuator_schedules a WHERE a.site_id=d.site_id AND a.device_id=d.device_id
      AND a.enabled AND a.actuator_key IN ('pump_fert','pump_water')
      AND (now() AT TIME ZONE a.timezone)::time >= a.on_time
      AND (now() AT TIME ZONE a.timezone)::time < a.off_time
      AND (a.repeat_rule='daily' OR (a.repeat_rule='weekdays' AND extract(isodow FROM now() AT TIME ZONE a.timezone)<=5)
        OR (a.repeat_rule='weekends' AND extract(isodow FROM now() AT TIME ZONE a.timezone)>=6)
        OR (a.repeat_rule='once' AND a.run_date=(now() AT TIME ZONE a.timezone)::date))) AS schedule_active
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
      r.raw_payload?.serverPulseCapable !== true || r.raw_payload?.independentSoilEcCapable !== true || !/^[a-fA-F0-9]{16}$/.test(r.raw_payload?.pulseBootId??'') || r.schedule_status !== 'applied' ||
      String(r.schedule_revision) !== String(r.schedule_ack))
    fail('Perangkat, mode, firmware AI mandiri, atau sinkronisasi jadwal belum siap.');
  if(r.schedule_active) fail('schedule_priority');
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
    if(!await executionAllowed(c,parsed.deviceId))fail('Aktifkan AI Fertigasi EC Tanah di Settings terlebih dahulu.');
    const previous = await c.query('SELECT * FROM spff.soil_ec_pulse_sessions WHERE request_id=$1', [parsed.requestId]);
    if (previous.rows[0]) {
      if (previous.rows[0].site_id !== siteId || previous.rows[0].device_id !== parsed.deviceId ||
          previous.rows[0].recipe_id !== parsed.recipeId || JSON.stringify(soilEcPulseProfileSchema.parse(previous.rows[0].profile)) !== JSON.stringify(parsed.profile))
        fail('requestId sudah dipakai untuk permintaan berbeda.');
      await c.query('COMMIT'); return previous.rows[0];
    }
    let automaticRecipeRevision:string|null=null;
    if(actor==='soil-ec:auto'){
      const saved=(await c.query('SELECT recipe_id,recipe_revision,profile,armed FROM spff.soil_ec_automatic_profiles WHERE site_id=$1 AND device_id=$2 FOR SHARE',[siteId,parsed.deviceId])).rows[0];
      if(!saved?.armed || saved.recipe_id!==parsed.recipeId || String(saved.recipe_revision)!==String((await getFertigationRecipe(parsed.recipeId))?.revision) || JSON.stringify(soilEcPulseProfileSchema.parse(saved.profile))!==JSON.stringify(parsed.profile))
        fail('Kalibrasi otomatis berubah atau dihentikan operator.');
      automaticRecipeRevision=String(saved.recipe_revision);
    }
    const equipmentState = await soilEcEquipment(c, parsed.deviceId);
    await c.query('SELECT recipe_id FROM spff.fertigation_recipes WHERE recipe_id=$1 AND site_id=$2 FOR SHARE', [parsed.recipeId,siteId]);
    const rule = await getFertigationRecipe(parsed.recipeId);
    validateRule(rule, equipmentState.crop_id);
    if(automaticRecipeRevision!==null&&String(rule.revision)!==automaticRecipeRevision)fail('Aturan berubah; simpan ulang kalibrasi otomatis.');
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
    const unreleased=await c.query(`SELECT 1 FROM spff.soil_ec_pulse_sessions s WHERE s.site_id=$1 AND s.device_id=$2
      AND NOT EXISTS(SELECT 1 FROM spff.soil_ec_pulse_commands pc WHERE pc.session_id=s.session_id
        AND pc.operation='release' AND pc.status='completed' AND pc.ack->>'pumpsOff'='true') LIMIT 1`,[siteId,parsed.deviceId]);
    if(unreleased.rowCount)fail('Kepemilikan sesi sebelumnya belum dilepas dan dikonfirmasi.');
    const id = randomUUID();
    const inserted = await c.query(`INSERT INTO spff.soil_ec_pulse_sessions
      (session_id,request_id,site_id,device_id,recipe_id,application_day,recipe_revision,profile,rule_snapshot,status,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting',$10) RETURNING *`, [id,parsed.requestId,siteId,parsed.deviceId,
      rule.recipeId,jakartaDay(new Date()),rule.revision,JSON.stringify(parsed.profile),JSON.stringify({ rule, automaticRevision:String(equipmentState.revision),bootId:equipmentState.raw_payload.pulseBootId }),actor]);
    await observeSoilEcPumpAlertInTransaction(c,siteId,parsed.deviceId,false,'session_started',id);
    await c.query('COMMIT'); return inserted.rows[0];
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function stopSession(c: PoolClient, s: Session, status: 'fault'|'cancelled'|'completed', reason: string, release = false) {
  if(status==='fault')await observeSoilEcPumpAlertInTransaction(c,siteId,s.device_id,true,reason,s.session_id);
  // Stop is queued even when outcome is uncertain; duration timeout remains local.
  const id = randomUUID(), now = new Date();
  const releaseCycle=release?Number((await c.query("SELECT COALESCE(max(cycle),0)+1 AS cycle FROM spff.soil_ec_pulse_commands WHERE session_id=$1 AND operation='release'",[s.session_id])).rows[0].cycle):0;
  const command = { kind:release?'fertigation_pulse_release':'fertigation_pulse_stop',schemaVersion:1,siteId,deviceId:s.device_id,sessionId:s.session_id,
    commandId:id,cycle:release?Math.max(1,s.cycles,releaseCycle):Math.max(1,s.cycles),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30000).toISOString() };
  await c.query(`INSERT INTO spff.soil_ec_pulse_commands(command_id,session_id,cycle,operation,payload,expires_at)
    VALUES($1,$2,$3,$6,$4,$5) ON CONFLICT(session_id,cycle,operation) DO NOTHING`, [id,s.session_id,command.cycle,JSON.stringify(command),command.expiresAt,release?'release':'stop']);
  await c.query(`UPDATE spff.soil_ec_pulse_sessions SET status=$2,reason=$3,updated_at=now() WHERE session_id=$1`, [s.session_id,status,reason]);
}
export async function cancelSoilEcSession(id: string) {
  const c=await pool.connect();
  try { await c.query('BEGIN'); const r=await c.query<Session>('SELECT * FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND session_id=$2 FOR UPDATE',[siteId,id]);
    if (!r.rows[0]) fail('Sesi tidak ditemukan.');
    await c.query("UPDATE spff.soil_ec_automatic_profiles SET armed=false,reason='operator_stop',updated_at=now() WHERE site_id=$1 AND device_id=$2",[siteId,r.rows[0].device_id]);
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
    if(!soilEcPulsesEnabled() || !await executionAllowed(c,s.device_id) || s.application_day!==jakartaDay(new Date()) || now-s.started_at.getTime()>p.maxSessionMs) {
      await stopSession(c,s,'fault','disabled_or_session_timeout');await c.query('COMMIT');return;
    }
    const command=await c.query(`SELECT * FROM spff.soil_ec_pulse_commands WHERE session_id=$1 AND operation='pulse' ORDER BY cycle DESC LIMIT 1`,[id]);
    const last=command.rows[0];
    if(last && ['pending','published','accepted'].includes(last.status)) {
      if(now > last.expires_at.getTime()+last.payload.params.onDurationMs+10000)
        await stopSession(c,s,'fault','pulse_outcome_unknown');
      await c.query('COMMIT');return;
    }
    if(last && last.status!=='completed') {
      const scheduled=last.status==='rejected'&&last.ack?.reason==='pulse_schedule_priority';
      await stopSession(c,s,scheduled?'cancelled':'fault',scheduled?'schedule_priority':(typeof last.ack?.reason==='string'?last.ack.reason:'device_rejected_or_fault'));await c.query('COMMIT');return;
    }
    if(s.status==='in_flight') {
      // Server receive time is authoritative for settling; device clock cannot shorten it.
      await c.query(`UPDATE spff.soil_ec_pulse_sessions SET status='waiting',settle_until=$2,updated_at=now() WHERE session_id=$1`,
        [id,new Date(last.finished_at.getTime()+p.settleMs)]);
      s.settle_until=new Date(last.finished_at.getTime()+p.settleMs);
    }
    let rule: FertigationRecipe|null=null;
    try {
      const state=await soilEcEquipment(c,s.device_id);
      await c.query('SELECT recipe_id FROM spff.fertigation_recipes WHERE recipe_id=$1 FOR SHARE',[s.recipe_id]);
      rule=await getFertigationRecipe(s.recipe_id);validateRule(rule,state.crop_id);
      if(String(rule.revision)!==String(s.recipe_revision) || String(state.revision)!==s.rule_snapshot.automaticRevision || state.raw_payload.pulseBootId!==s.rule_snapshot.bootId)
        fail('rule_or_mode_revision_changed');
    } catch (error) {
      const scheduled = error instanceof Error && error.message==='schedule_priority';
      await stopSession(c,s,scheduled?'cancelled':'fault',scheduled?'schedule_priority':'rule_mode_schedule_or_device_changed');await c.query('COMMIT');return;
    }
    let decision;
    try { decision=await evaluateSoilEcSamples(c,s.device_id,rule,p,{afterMs:s.settle_until.getTime(),cycles:s.cycles,
      totalOnMs:Number(s.total_on_ms),previousEc:s.previous_ec,noResponseCycles:s.no_response_cycles}); }
    catch {await stopSession(c,s,'fault','tank_sensor_or_level_invalid');await c.query('COMMIT');return;}
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
export async function evaluateSoilEcSamples(c:PoolClient,deviceId:string,rule:FertigationRecipe,p:SoilEcPulseProfile,
  state:{afterMs:number;cycles:number;totalOnMs:number;previousEc:number|null;noResponseCycles:number}) {
    const readings=await c.query(`SELECT DISTINCT ON(recorded_at) recorded_at,received_at,
      soil_1_ec_us_cm AS ec,soil_1_moisture AS moisture,sensor_health,
      tank_water_level_pct,tank_fert_level_pct FROM spff.telemetry_samples
      WHERE site_id=$1 AND device_id=$2 AND recorded_at <= now()
      ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 20`,[siteId,deviceId]);
    const samples:SoilEcSample[]=readings.rows.map(r=>({recordedAt:r.recorded_at.toISOString(),ec:r.ec,moisture:r.moisture,
      valid:r.sensor_health?.soil_1_ec_us_cm?.valid===true && r.sensor_health?.soil_1_moisture?.valid===true &&
        r.ec!==null && Number.isFinite(r.ec) && r.ec>=0 && r.ec<=100000 &&
        r.moisture!==null && Number.isFinite(r.moisture) && r.moisture>=0 && r.moisture<=100}));
    const latest=readings.rows[0];
    // Tank gates are checked on server using explicit per-parameter health; never infer stock litres.
    const tankOk=latest && ['tank_water_level_pct','tank_fert_level_pct'].every(k=>
      latest.sensor_health?.[k]?.valid===true && Number.isFinite(latest[k]) && latest[k]>=0 && latest[k]<=100) &&
      latest.tank_water_level_pct>=rule.minWaterTankPercent && latest.tank_fert_level_pct>=rule.minStockTankPercent;
    const daily=await c.query(`SELECT COALESCE(sum(total_on_ms),0) AS total FROM spff.soil_ec_pulse_sessions
      WHERE site_id=$1 AND device_id=$2 AND application_day=$3`,[siteId,deviceId,jakartaDay(new Date())]);
    const decision=decideSoilEcPulse({nowMs:Date.now(),afterMs:state.afterMs,samples,
      target:rule.ecTargetUsCm!,high:rule.ecHighUsCm!,startLow:rule.ecLowUsCm!,cycles:state.cycles,
      totalOnMs:state.totalOnMs,dailyOnMs:Number(daily.rows[0].total),previousEc:state.previousEc,
      noResponseCycles:state.noResponseCycles,profile:p});
    // A sufficient target needs no pumping; tank gates apply before any new ON command.
    if(decision.action==='pulse'&&!tankOk)fail('tank_sensor_or_level_invalid');
    return decision;
}
export async function readSoilEcAutomaticProfile(deviceId:string) {
  const r=await pool.query('SELECT recipe_id,recipe_revision,profile,armed,reason FROM spff.soil_ec_automatic_profiles WHERE site_id=$1 AND device_id=$2',[siteId,deviceId]);
  return r.rows[0]??null;
}
export async function saveSoilEcAutomaticProfile(input:unknown,actor:string) {
  const parsed=startSoilEcSessionSchema.parse(input);
  const rule=await getFertigationRecipe(parsed.recipeId);
  if(!rule || rule.approvalStatus!=='approved')fail('Setujui aturan tanaman sebelum menyimpan kalibrasi otomatis.');
  const c=await pool.connect();
  try {await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`soil-ec:${siteId}:${parsed.deviceId}`]);
    const active=await c.query(`SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2 AND status IN ('waiting','in_flight','fault')`,[siteId,parsed.deviceId]);
    if(active.rowCount)fail('Selesaikan sesi/fault sebelum mengganti kalibrasi.');
    await c.query(`INSERT INTO spff.soil_ec_automatic_profiles(site_id,device_id,recipe_id,recipe_revision,profile,updated_by)
      VALUES($1,$2,$3,$6,$4,$5) ON CONFLICT(site_id,device_id) DO UPDATE
      SET recipe_id=EXCLUDED.recipe_id,recipe_revision=EXCLUDED.recipe_revision,profile=EXCLUDED.profile,armed=true,reason='waiting_evaluation',updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [siteId,parsed.deviceId,parsed.recipeId,JSON.stringify(parsed.profile),actor,rule.revision]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return readSoilEcAutomaticProfile(parsed.deviceId);
}
// Only clean completion, schedule preemption or disabling AI may return control automatically.
// Faults and operator stops retain ownership until explicit Manual recovery.
export async function returnCleanSoilEcOwnership() {
 const c=await pool.connect();
 try {await c.query('BEGIN');
  const ready=await c.query<Session>(`SELECT s.* FROM spff.soil_ec_pulse_sessions s
   WHERE s.site_id=$1 AND (s.status='completed' OR (s.status='cancelled' AND s.reason IN ('schedule_priority','ai_execution_disabled')))
    AND EXISTS(SELECT 1 FROM spff.soil_ec_pulse_commands pc WHERE pc.session_id=s.session_id AND pc.operation='stop'
      AND pc.status='completed' AND pc.ack->>'pumpsOff'='true')
    AND NOT EXISTS(SELECT 1 FROM spff.soil_ec_pulse_commands pc WHERE pc.session_id=s.session_id AND pc.operation='release')
   FOR UPDATE OF s SKIP LOCKED`,[siteId]);
  for(const row of ready.rows){
   const id=randomUUID(),now=new Date();
   const payload={kind:'fertigation_pulse_release',schemaVersion:1,siteId,deviceId:row.device_id,
    sessionId:row.session_id,commandId:id,cycle:Math.max(1,row.cycles),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30000).toISOString(),resumeAutomatic:true};
   await c.query(`INSERT INTO spff.soil_ec_pulse_commands(command_id,session_id,cycle,operation,payload,expires_at)
    VALUES($1,$2,$3,'release',$4,$5) ON CONFLICT(session_id,cycle,operation) DO NOTHING`,[id,row.session_id,payload.cycle,JSON.stringify(payload),payload.expiresAt]);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function evaluateAutomaticSoilEc() {
 if(!soilEcPulsesEnabled())return;
 const ready=await pool.query("SELECT to_regclass('spff.soil_ec_automatic_profiles') IS NOT NULL AS ready");
 if(!ready.rows[0]?.ready)return;
 const profiles=await pool.query(`SELECT e.device_id,p.profile,p.recipe_id,p.recipe_revision FROM spff.device_soil_ec_execution_configs e
  LEFT JOIN spff.soil_ec_automatic_profiles p USING(site_id,device_id) WHERE e.site_id=$1 AND e.enabled AND (p.armed OR p.device_id IS NULL)`,[siteId]);
 for(const row of profiles.rows){
  const owned=await pool.query("SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2 AND status IN ('waiting','in_flight','fault')",[siteId,row.device_id]);
  if(owned.rowCount)continue;
  if(!row.profile){await observeSoilEcPumpAlert(pool,siteId,row.device_id,true,'calibration_missing');continue;}
  let reason='waiting_evaluation';
  try {
   const p=soilEcPulseProfileSchema.parse(row.profile),c=await pool.connect();
   let shouldStart=false;
   try {
    const crop=(await c.query("SELECT crop_id FROM spff.site_crop_selections WHERE site_id=$1 AND zone_id='soil-1'",[siteId])).rows[0];
    const rule=await getFertigationRecipe(row.recipe_id);validateRule(rule,crop?.crop_id);
    if(String(rule.revision)!==String(row.recipe_revision))fail('Aturan berubah; verifikasi dan simpan ulang kalibrasi otomatis.');
    const decision=await evaluateSoilEcSamples(c,row.device_id,rule,p,{afterMs:0,cycles:0,totalOnMs:0,previousEc:null,noResponseCycles:0});
    reason=decision.reason;
    if(decision.action==='pulse'){
     await soilEcEquipment(c,row.device_id);
     // start() revalidates mode/rule/ownership under a per-device transaction lock.
     shouldStart=true;
    }
   }finally{c.release();}
   if(shouldStart){
    await startSoilEcSession({deviceId:row.device_id,recipeId:row.recipe_id,requestId:randomUUID(),profile:p},'soil-ec:auto');
    reason='automatic_session_started';
   }
  }catch(e){reason=e instanceof Error?e.message:'evaluation_failed';}
  // A cooldown or outstanding command is normal arbitration, not a failed start.
  const busy=reason==='Sesi, command, cooldown, atau fault perangkat belum selesai.';
  if(!busy)await observeSoilEcPumpAlert(pool,siteId,row.device_id,!soilEcWaitingReasons.has(reason),reason);
  await pool.query('UPDATE spff.soil_ec_automatic_profiles SET reason=$3 WHERE site_id=$1 AND device_id=$2',[siteId,row.device_id,reason]);
 }
}
export function startSoilEcCoordinator() {
  let running=false, ticks=0;
  const timer=setInterval(()=>{if(running)return;running=true;
    void (async()=>{
      const r=await pool.query(`SELECT session_id FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND status IN ('waiting','in_flight')`,[siteId]);
      for(const row of r.rows)await advanceSoilEcSession(row.session_id);
      await returnCleanSoilEcOwnership();
      if(ticks++%5===0){await evaluateAutomaticSoilEc();await observeScheduledPumpAlerts(pool,siteId);}
    })().catch((e:unknown)=>console.error('[soil-ec-coordinator]',e)).finally(()=>{running=false;});},2000);
  timer.unref();return ()=>clearInterval(timer);
}
