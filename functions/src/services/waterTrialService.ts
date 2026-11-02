import { pool, configuredSiteId } from './postgresRepository.js';
import type { WaterTrialRequest } from '@spff/contracts';
import { randomUUID } from 'node:crypto';

export class WaterTrialBlockedError extends Error {}

export interface AiWaterTrialProvenance {
  source: 'ai-shadow-approved-water-trial';
  approvalId: string;
  approvalFingerprint: string;
  fuzzyRecordedAt: string;
}

function block(reason: string): never {
  throw new WaterTrialBlockedError(reason);
}

function fresh(at: unknown, maxAgeMs: number): boolean {
  const dt = at instanceof Date ? at : new Date(String(at ?? ''));
  const delta = Date.now() - dt.getTime();
  return Number.isFinite(delta) && delta >= -5000 && delta <= maxAgeMs;
}

export async function createWaterTrial(input: WaterTrialRequest, actor: string, provenance?: AiWaterTrialProvenance) {
  if (process.env.SPFF_WATER_TRIAL_DISPATCH_ENABLED !== 'true') {
    block('Trial pump belum diaktifkan di server staging.');
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`water-trial:${configuredSiteId}:${input.deviceId}`]);

    const existing = await c.query(
      `SELECT command_id,status,request_payload,requested_by FROM spff.control_commands
       WHERE command_id=$1 FOR UPDATE`, [input.commandId]);
    if (existing.rows[0]) {
      const old = existing.rows[0];
      const trial = old.request_payload?.waterTrial;
      const expectedSource = provenance?.source ?? 'operator-calibration-trial';
      const previousOrigin = old.request_payload?.aiApproval;
      if (old.requested_by !== `trial:water:${actor.slice(0,60)}` ||
          old.request_payload?.deviceId !== input.deviceId ||
          old.request_payload?.source !== expectedSource ||
          (provenance && (
            previousOrigin?.approvalId !== provenance.approvalId ||
            previousOrigin?.approvalFingerprint !== provenance.approvalFingerprint ||
            previousOrigin?.fuzzyRecordedAt !== provenance.fuzzyRecordedAt
          )) ||
          trial?.targetWaterL !== input.targetWaterL ||
          trial?.durationSec !== input.durationSec) {
        block('commandId telah digunakan untuk permintaan lain.');
      }
      await c.query('COMMIT');
      return { commandId: input.commandId, status: old.status, idempotent: true };
    }

    const device = await c.query(
      `SELECT 1 FROM spff.devices
       WHERE site_id=$1 AND device_id=$2 AND enabled`,
      [configuredSiteId, input.deviceId]);
    if (!device.rowCount) block('Device tidak ditemukan/disabled.');

    const status = (await c.query(
      `SELECT online,mode,recorded_at,firmware_version,raw_payload
       FROM spff.device_status_events
       WHERE site_id=$1 AND device_id=$2
       ORDER BY received_at DESC, device_status_id DESC LIMIT 1`,
      [configuredSiteId,input.deviceId])).rows[0];
    if (!status || !status.online || status.mode !== 'manual' ||
        !fresh(status.recorded_at, 45000)) {
      block('ESP32 harus online, fresh, dan Manual.');
    }
    if (status.raw_payload?.timedWaterTrialCapable !== true ||
        !String(status.firmware_version ?? '').startsWith('1.5.04-WATER-TRIAL')) {
      block('Firmware belum melaporkan kemampuan timed-water trial aktif.');
    }
    if (status.raw_payload?.waterInterlockEnabled !== true) {
      block('Interlock tandon air harus aktif dan dilaporkan firmware.');
    }

    const control = (await c.query(
      `SELECT revision,acknowledged_revision,acknowledgement_status,
              desired_mode,applied_mode
       FROM spff.device_automatic_control_configs
       WHERE site_id=$1 AND device_id=$2`,
      [configuredSiteId,input.deviceId])).rows[0];
    if (!control || control.desired_mode !== 'manual' ||
        control.applied_mode !== 'manual' ||
        control.acknowledgement_status !== 'applied' ||
        String(control.revision) !== String(control.acknowledged_revision)) {
      block('Mode Manual belum mendapat ACK perangkat.');
    }

    const states = await c.query(
      `SELECT actuator_key,is_active,state FROM spff.latest_actuator_states
       WHERE site_id=$1 AND device_id=$2
         AND actuator_key IN ('pump_water','pump_fert')`,
      [configuredSiteId,input.deviceId]);
    if (states.rowCount !== 2 || states.rows.some(
      row => row.state !== 'inactive' || row.is_active !== false
    )) block('Kedua pompa harus terlapor OFF sebelum trial.');

    const sample = (await c.query(
      `SELECT recorded_at,received_at,flow_water_total_l,sensor_health
       FROM spff.telemetry_samples
       WHERE site_id=$1 AND device_id=$2
       ORDER BY received_at DESC LIMIT 1`,
      [configuredSiteId,input.deviceId])).rows[0];
    if (!sample || !fresh(sample.recorded_at,45000) ||
        !fresh(sample.received_at,45000) ||
        sample.sensor_health?.flow_water_total_l?.valid !== true ||
        !Number.isFinite(Number(sample.flow_water_total_l)) ||
        Number(sample.flow_water_total_l) < 0) {
      block('Flowmeter kumulatif tidak valid/segar; trial dibatalkan.');
    }

    const busy = await c.query(
      `SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2
         AND status IN ('pending','published','accepted') LIMIT 1`,
      [configuredSiteId,input.deviceId]);
    if (busy.rowCount) block('Masih ada command perangkat yang belum final.');

    const schedules = await c.query(
      `SELECT 1 FROM spff.actuator_schedules
       WHERE site_id=$1 AND device_id=$2 AND enabled
         AND actuator_key IN ('pump_water','pump_fert') LIMIT 1`,
      [configuredSiteId,input.deviceId]);
    if (schedules.rowCount) block('Nonaktifkan jadwal pompa terlebih dahulu sebelum trial.');

    const actuator = (await c.query(
      `SELECT max_runtime_seconds FROM spff.actuators
       WHERE site_id=$1 AND device_id=$2 AND actuator_key='pump_water' AND enabled`,
      [configuredSiteId,input.deviceId])).rows[0];
    if (!actuator || !Number.isFinite(Number(actuator.max_runtime_seconds)) ||
        Number(actuator.max_runtime_seconds) < input.durationSec) {
      block('Batas maksimum runtime pompa belum mengizinkan durasi trial.');
    }

    await c.query(
      `INSERT INTO spff.control_commands
        (command_id,site_id,device_id,actuator_key,requested_is_active,
         requested_by,issued_at,expires_at,request_payload)
       VALUES($1,$2,$3,'pump_water',true,$4,now(),now()+interval '15 seconds',$5::jsonb)`,
      [input.commandId,configuredSiteId,input.deviceId,
       `trial:water:${actor.slice(0,60)}`,
       JSON.stringify({
         source: provenance?.source ?? 'operator-calibration-trial',
         deviceId: input.deviceId,
         ...(provenance ? { aiApproval: {
           approvalId: provenance.approvalId,
           approvalFingerprint: provenance.approvalFingerprint,
           fuzzyRecordedAt: provenance.fuzzyRecordedAt,
         }} : {}),
         waterTrial: { targetWaterL:input.targetWaterL, durationSec:input.durationSec },
       })],
    );
    await c.query('COMMIT');
    return { commandId: input.commandId, status:'pending', idempotent:false };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); }
}

export async function getWaterTrial(commandId: string) {
  const result = await pool.query(
    `SELECT c.command_id,c.device_id,c.status,c.reason,c.issued_at,c.completed_at,
       c.request_payload, (SELECT jsonb_agg(a.raw_payload ORDER BY a.acknowledged_at)
           FROM spff.command_ack_events a WHERE a.command_id=c.command_id) AS acks
     FROM spff.control_commands c
     WHERE c.site_id=$1 AND c.command_id=$2 AND c.request_payload ? 'waterTrial'`,
    [configuredSiteId,commandId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    commandId:row.command_id, deviceId:row.device_id, status:row.status,
    reason:row.reason, issuedAt:row.issued_at, completedAt:row.completed_at,
    requested:row.request_payload?.waterTrial, deviceAcks:row.acks ?? [],
    measuredVolumeIsUncalibrated:true,
  };
}

/** Emergency operator STOP is separately queued; never blocked by in-flight START. */
export async function stopWaterTrial(commandId: string, actor: string) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`water-trial-stop:${configuredSiteId}:${commandId}`]);
    const source=(await c.query(
      `SELECT device_id FROM spff.control_commands
       WHERE site_id=$1 AND command_id=$2 AND request_payload ? 'waterTrial'`,
      [configuredSiteId,commandId])).rows[0];
    if (!source) block('Trial tidak ditemukan.');
    const existing=(await c.query(
      `SELECT command_id,status FROM spff.control_commands
       WHERE site_id=$1 AND request_payload->>'stopOf'=$2
       ORDER BY issued_at DESC LIMIT 1`,
      [configuredSiteId,commandId])).rows[0];
    if (existing) {
      await c.query('COMMIT');
      return { commandId:existing.command_id,status:existing.status,idempotent:true };
    }
    const stopId=randomUUID();
    await c.query(
      `INSERT INTO spff.control_commands
       (command_id,site_id,device_id,actuator_key,requested_is_active,
        requested_by,issued_at,expires_at,request_payload)
       VALUES($1,$2,$3,'pump_water',false,$4,now(),now()+interval '15 seconds',$5::jsonb)`,
      [stopId,configuredSiteId,source.device_id,`trial-stop:water:${actor.slice(0,60)}`,
       JSON.stringify({source:'water-trial-operator-stop',stopOf:commandId})]);
    await c.query('COMMIT');
    return {commandId:stopId,status:'pending',idempotent:false};
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {c.release();}
}

/** Saves an operator's independent measurement. Never applies the ratio to control. */
export async function recordWaterTrialCalibration(
  commandId: string, physicalMeasuredL: number, note: string, actor: string,
) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const r=await c.query(
      `SELECT cmd.device_id, ack.raw_payload AS proof
       FROM spff.control_commands cmd
       JOIN LATERAL (
         SELECT raw_payload FROM spff.command_ack_events
         WHERE command_id=cmd.command_id AND status IN ('completed','rejected')
         ORDER BY acknowledged_at DESC, ack_event_id DESC LIMIT 1
       ) ack ON true
       WHERE cmd.site_id=$1 AND cmd.command_id=$2
         AND cmd.request_payload ? 'waterTrial'
       FOR UPDATE OF cmd`,
      [configuredSiteId,commandId],
    );
    const row=r.rows[0];
    const proof=row?.proof;
    const reported=proof?.actualWaterL;
    if (!row || !proof || proof?.actualState?.isActive !== false ||
        typeof reported !== 'number' || !Number.isFinite(reported) ||
        reported <= 0 || reported > 10000 ||
        !String(proof.reason ?? '').startsWith('trial_')) {
      block('Belum ada ACK final dari ESP32 dengan output OFF dan delta flowmeter valid.');
    }
    const factor=physicalMeasuredL/reported;
    if (!Number.isFinite(factor) || factor <= 0 || factor >= 100) {
      block('Rasio kalibrasi di luar rentang; periksa pengukuran fisik.');
    }
    const existing=(await c.query(
      `SELECT meter_reported_l,physical_measured_l,provisional_correction_factor,
              recorded_by,recorded_at,operator_note
       FROM spff.water_trial_calibrations
       WHERE site_id=$1 AND command_id=$2 FOR UPDATE`,
      [configuredSiteId,commandId])).rows[0];
    if (existing) {
      if (existing.physical_measured_l !== physicalMeasuredL ||
          existing.operator_note !== note) {
        block('Kalibrasi sesi sudah dicatat; nilai tidak boleh ditimpa.');
      }
      await c.query('COMMIT');
      return { commandId, ...existing, status:'PROVISIONAL_ONLY', idempotent:true };
    }
    const saved=(await c.query(
      `INSERT INTO spff.water_trial_calibrations
       (site_id,command_id,device_id,meter_reported_l,physical_measured_l,
        provisional_correction_factor,evidence_ack,operator_note,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       RETURNING meter_reported_l,physical_measured_l,provisional_correction_factor,
                 recorded_by,recorded_at,operator_note`,
      [configuredSiteId,commandId,row.device_id,reported,physicalMeasuredL,factor,
       JSON.stringify(proof),note,actor],
    )).rows[0];
    await c.query('COMMIT');
    return {commandId,...saved,status:'PROVISIONAL_ONLY',idempotent:false};
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {c.release();}
}
