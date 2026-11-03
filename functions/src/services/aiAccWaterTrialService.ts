import type { AiAccWaterTrialRequest, AiAccWaterTrialQueued, UnifiedAiDashboard } from '@spff/contracts';
import { aiAccWaterTrialQueuedSchema } from '@spff/contracts';
import { pool, configuredSiteId } from './postgresRepository.js';
import { AiAccWaterTrialBlocked, freshTimestamp, planAiAccWaterTrial } from './aiAccWaterTrialPolicy.js';
import { requireAiAccHardwareEvidence, requireAiAccInterlockAgreement, type AiAccDeviceEvidence, type AiAccInterlockEvidence } from './aiAccHardwareSafety.js';

function block(message: string): never { throw new AiAccWaterTrialBlocked(message); }

/**
 * Revalidate live SPFF evidence under a per-device SQL lock, then create a
 * durable queued command. Never report pump ON without the device's ACK.
 */
export async function queueAiAccWaterTrial(
  input: AiAccWaterTrialRequest,
  actor: string,
  source: UnifiedAiDashboard,
): Promise<AiAccWaterTrialQueued> {
  if (process.env.SPFF_AI_ACC_WATER_TRIAL_ENABLED !== 'true') {
    block('ACC pompa masih dinonaktifkan oleh konfigurasi lokal.');
  }
  if (!actor || actor.trim().length === 0) block('Operator tidak valid.');
  const candidate = planAiAccWaterTrial(source, input);
  const requestedBy = 'trial:water:ai:' + actor.slice(0, 60);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['ai-acc:' + configuredSiteId + ':' + input.deviceId],
    );

    const existing = await client.query<{
      status: string;
      requested_by: string;
      request_payload: {
        aiAcc?: { expectedEvaluatedAt?: string; expectedAction?: string };
        waterTrial?: { targetWaterL?: number; durationSec?: number };
      } | null;
    }>(
      'SELECT status,requested_by,request_payload FROM spff.control_commands WHERE command_id=$1 FOR UPDATE',
      [input.commandId],
    );
    const old = existing.rows[0];
    if (old) {
      if (old.requested_by !== requestedBy ||
          old.request_payload?.aiAcc?.expectedEvaluatedAt !== input.expectedEvaluatedAt ||
          old.request_payload?.aiAcc?.expectedAction !== input.expectedAction ||
          old.request_payload?.waterTrial?.targetWaterL !== candidate.targetWaterL ||
          old.request_payload?.waterTrial?.durationSec !== input.durationSec) {
        block('commandId sudah digunakan untuk persetujuan lain.');
      }
      await client.query('COMMIT');
      return aiAccWaterTrialQueuedSchema.parse({
        commandId: input.commandId, status: old.status, idempotent: true,
        waterOnly: true, dispatched: false, actualPumpOn: false,
        targetWaterL: candidate.targetWaterL, durationSec: input.durationSec,
      });
    }

    const device = await client.query<{ enabled: boolean }>(
      'SELECT enabled FROM spff.devices WHERE site_id=$1 AND device_id=$2',
      [configuredSiteId, input.deviceId],
    );
    if (device.rows[0]?.enabled !== true) block('Device disabled atau tidak ditemukan.');

    // Latest MCU heartbeat must match the exact 1.5.07 protocol, current boot,
    // independent healthy tank guard and fresh register-level OFF readback.
    const status = await client.query<AiAccDeviceEvidence>(
      ['SELECT online,mode,recorded_at,received_at,firmware_version,raw_payload',
       'FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2',
       'ORDER BY received_at DESC,device_status_id DESC LIMIT 1'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    const { bootId, interlockEnabled } = requireAiAccHardwareEvidence(status.rows[0]);

    // Dashboard interlock OFF can be intentional. Never bypass the independent
    // firmware tank guard; require saved and applied configuration to agree.
    const interlock = await client.query<AiAccInterlockEvidence>(
      ['SELECT enabled,applied_enabled,acknowledgement_status,revision,acknowledged_revision',
       'FROM spff.device_water_interlock_configs',
       'WHERE site_id=$1 AND device_id=$2'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    requireAiAccInterlockAgreement(interlock.rows[0], interlockEnabled);

    const control = await client.query<{
      desired_mode: string;
      applied_mode: string | null;
      acknowledgement_status: string | null;
      revision: string | number;
      acknowledged_revision: string | number | null;
    }>(
      ['SELECT desired_mode,applied_mode,acknowledgement_status,revision,acknowledged_revision',
       'FROM spff.device_automatic_control_configs',
       'WHERE site_id=$1 AND device_id=$2'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    const auto = control.rows[0];
    if (!auto || auto.desired_mode !== 'automatic' ||
        auto.applied_mode !== 'automatic' ||
        auto.acknowledgement_status !== 'applied' ||
        String(auto.revision) !== String(auto.acknowledged_revision)) {
      block('Automatic belum ACK applied dari ESP32.');
    }

    // Historical state rows alone may be old; the fresh MCU readback above
    // independently confirms both outputs OFF at this heartbeat.
    const states = await client.query<{ actuator_key: string; is_active: boolean | null; state: string }>(
      ['SELECT actuator_key,is_active,state FROM spff.latest_actuator_states',
       'WHERE site_id=$1 AND device_id=$2 AND actuator_key IN (\'pump_water\',\'pump_fert\')'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    if (states.rows.length !== 2 ||
        states.rows.some(row => row.state !== 'inactive' || row.is_active !== false)) {
      block('Actual state kedua pompa belum terlapor OFF.');
    }

    const telemetry = await client.query<{
      recorded_at: Date;
      received_at: Date;
      flow_water_total_l: number | string | null;
      sensor_health: Record<string, { valid?: boolean }> | null;
    }>(
      ['SELECT recorded_at,received_at,flow_water_total_l,sensor_health',
       'FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2',
       'ORDER BY received_at DESC LIMIT 1'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    const sample = telemetry.rows[0];
    if (!sample || !freshTimestamp(sample.recorded_at,new Date(),45000) ||
        !freshTimestamp(sample.received_at,new Date(),45000) ||
        sample.sensor_health?.tank_water_distance_cm?.valid !== true ||
        sample.sensor_health?.flow_water_total_l?.valid !== true ||
        sample.flow_water_total_l === null ||
        !Number.isFinite(Number(sample.flow_water_total_l)) ||
        Number(sample.flow_water_total_l) < 0) {
      block('Sensor tandon/flowmeter belum fresh atau tidak valid.');
    }

    const busy = await client.query(
      ['SELECT 1 FROM spff.control_commands',
       'WHERE site_id=$1 AND device_id=$2 AND status IN (\'pending\',\'published\',\'accepted\') LIMIT 1'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    if (busy.rows.length) block('Command lain belum final.');

    const schedule = await client.query(
      ['SELECT 1 FROM spff.actuator_schedules',
       'WHERE site_id=$1 AND device_id=$2 AND enabled',
       'AND actuator_key IN (\'pump_water\',\'pump_fert\') LIMIT 1'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    if (schedule.rows.length) block('Jadwal pompa harus dinonaktifkan selama trial ACC.');

    const maxRuntime = await client.query<{ max_runtime_seconds: number | string | null }>(
      ['SELECT max_runtime_seconds FROM spff.actuators',
       'WHERE site_id=$1 AND device_id=$2 AND actuator_key=\'pump_water\' AND enabled'].join(' '),
      [configuredSiteId, input.deviceId],
    );
    const allowed = Number(maxRuntime.rows[0]?.max_runtime_seconds ?? NaN);
    if (!Number.isFinite(allowed) || allowed < input.durationSec) {
      block('Max runtime pompa lebih kecil dari batas waktu trial.');
    }

    // The MQTT worker already serializes request_payload.waterTrial through
    // @spff/contracts. This INSERT is the only actuation queue mutation.
    await client.query(
      ['INSERT INTO spff.control_commands',
       '(command_id,site_id,device_id,actuator_key,requested_is_active,',
       'requested_by,issued_at,expires_at,request_payload)',
       'VALUES($1,$2,$3,\'pump_water\',true,$4,now(),now()+interval \'15 seconds\',$5::jsonb)'].join(' '),
      [
        input.commandId,configuredSiteId,input.deviceId,requestedBy,
        JSON.stringify({
          source: 'ai-operator-acc-water-only-trial',
          deviceId:input.deviceId,
          waterTrial: { targetWaterL:candidate.targetWaterL, durationSec:input.durationSec, bootId },
          aiAcc: { expectedAction:input.expectedAction,
            expectedEvaluatedAt:input.expectedEvaluatedAt,
            sourceWaterL:candidate.plannedWaterL,
            trialCapL:input.trialCapL,
            operator:actor,
            confirmation:input.confirmation },
        }),
      ],
    );
    await client.query('COMMIT');
    return aiAccWaterTrialQueuedSchema.parse({
      commandId:input.commandId,status:'pending',idempotent:false,
      waterOnly:true,dispatched:false,actualPumpOn:false,
      targetWaterL:candidate.targetWaterL,durationSec:input.durationSec,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
