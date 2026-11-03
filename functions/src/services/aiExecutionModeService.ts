import type { PoolClient } from 'pg';
import type { AiExecutionMode, AiExecutionModeState, AiExecutionModeUpdate } from '@spff/contracts';
import { pool, configuredSiteId } from './postgresRepository.js';
import { requireAiAccHardwareEvidence, requireAiAccInterlockAgreement } from './aiAccHardwareSafety.js';
import type { AiAccDeviceEvidence, AiAccInterlockEvidence } from './aiAccHardwareSafety.js';

export class AiExecutionModeBlocked extends Error {}

type ModeRow = {
  mode: AiExecutionMode;
  revision: string | number;
  updated_at: Date;
  updated_by: string;
};

export const aiLiveSwitchAvailable = (environment: NodeJS.ProcessEnv = process.env) =>
  environment.SPFF_AI_ACC_LIVE_SWITCH_ENABLED === 'true' &&
  environment.SPFF_AI_ACC_WATER_TRIAL_ENABLED === 'true';

export function verifyAiModeChange(
  request: AiExecutionModeUpdate,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (request.mode === 'live') {
    if (request.confirmation !== 'ENABLE_AI_LIVE_SUPERVISED') {
      throw new AiExecutionModeBlocked('Konfirmasi LIVE supervised belum diberikan.');
    }
    if (!aiLiveSwitchAvailable(environment)) {
      throw new AiExecutionModeBlocked('LIVE dikunci oleh backend; perlu commissioning dan kedua flag eksplisit.');
    }
  } else if (request.confirmation !== 'CHANGE_AI_MODE') {
    throw new AiExecutionModeBlocked('Konfirmasi perubahan mode tidak valid.');
  }
}

function presentMode(deviceId: string, row?: ModeRow): AiExecutionModeState {
  return {
    deviceId,
    mode: row?.mode ?? 'shadow',
    revision: Number(row?.revision ?? 0),
    updatedAt: row?.updated_at instanceof Date ? row.updated_at.toISOString() : null,
    updatedBy: row?.updated_by ?? null,
    liveSelectable: aiLiveSwitchAvailable(),
    // Worker is independently gated by env+fresh ESP32 evidence; never claim it is ready.
    workerDispatchConfirmed: false,
  };
}

export async function readAiExecutionMode(deviceId: string): Promise<AiExecutionModeState> {
  const result = await pool.query<ModeRow>(
    'SELECT mode,revision,updated_at,updated_by FROM spff.ai_execution_modes WHERE site_id=$1 AND device_id=$2',
    [configuredSiteId, deviceId],
  );
  return presentMode(deviceId, result.rows[0]);
}

async function requireBasicLiveHardware(client: PoolClient, deviceId: string): Promise<void> {
  // Current MCU boot and the independent tank guard must pass before choosing LIVE.
  // Full telemetry, scheduling, expiry and pump-readback checks are repeated at
  // queue time AND at Worker dispatch time.
  const status = await client.query<AiAccDeviceEvidence>(
    ['SELECT online,mode,recorded_at,received_at,firmware_version,raw_payload',
     'FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2',
     'ORDER BY received_at DESC,device_status_id DESC LIMIT 1'].join(' '),
    [configuredSiteId, deviceId],
  );
  const { interlockEnabled } = requireAiAccHardwareEvidence(status.rows[0]);

  const interlock = await client.query<AiAccInterlockEvidence>(
    ['SELECT enabled,applied_enabled,acknowledgement_status,revision,acknowledged_revision',
     'FROM spff.device_water_interlock_configs WHERE site_id=$1 AND device_id=$2'].join(' '),
    [configuredSiteId, deviceId],
  );
  requireAiAccInterlockAgreement(interlock.rows[0], interlockEnabled);

  const automatic = await client.query<{
    desired_mode: string;
    applied_mode: string | null;
    acknowledgement_status: string | null;
    revision: number | string;
    acknowledged_revision: number | string | null;
  }>(
    ['SELECT desired_mode,applied_mode,acknowledgement_status,revision,acknowledged_revision',
     'FROM spff.device_automatic_control_configs WHERE site_id=$1 AND device_id=$2'].join(' '),
    [configuredSiteId, deviceId],
  );
  const cfg = automatic.rows[0];
  if (!cfg || cfg.desired_mode !== 'automatic' || cfg.applied_mode !== 'automatic' ||
      cfg.acknowledgement_status !== 'applied' ||
      String(cfg.revision) !== String(cfg.acknowledged_revision)) {
    throw new AiExecutionModeBlocked('ESP32 belum melaporkan konfigurasi Automatic applied.');
  }
}

export async function changeAiExecutionMode(
  request: AiExecutionModeUpdate,
  actor: string,
): Promise<AiExecutionModeState> {
  verifyAiModeChange(request);
  if (!actor.trim()) throw new AiExecutionModeBlocked('Operator tidak valid.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same lock used by ACC queue; serializes changes vs new AI approvals.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['ai-acc:' + configuredSiteId + ':' + request.deviceId],
    );
    const device = await client.query<{ enabled: boolean }>(
      'SELECT enabled FROM spff.devices WHERE site_id=$1 AND device_id=$2',
      [configuredSiteId, request.deviceId],
    );
    if (!device.rows[0]) throw new AiExecutionModeBlocked('Device tidak ditemukan.');
    if (request.mode === 'live' && device.rows[0].enabled !== true) {
      throw new AiExecutionModeBlocked('Device tidak aktif.');
    }

    const current = await client.query<ModeRow>(
      'SELECT mode,revision,updated_at,updated_by FROM spff.ai_execution_modes WHERE site_id=$1 AND device_id=$2 FOR UPDATE',
      [configuredSiteId, request.deviceId],
    );
    const previous = current.rows[0];
    if (Number(previous?.revision ?? 0) !== request.expectedRevision) {
      throw new AiExecutionModeBlocked('Mode diubah dari sesi lain. Muat ulang sebelum menyimpan.');
    }
    if (request.mode === 'live') await requireBasicLiveHardware(client, request.deviceId);
    const changed = previous
      ? await client.query<ModeRow>(
          ['UPDATE spff.ai_execution_modes',
           'SET mode=$3,revision=revision+1,updated_by=$4,updated_at=now()',
           'WHERE site_id=$1 AND device_id=$2',
           'RETURNING mode,revision,updated_at,updated_by'].join(' '),
          [configuredSiteId, request.deviceId, request.mode, actor.slice(0, 80)],
        )
      : await client.query<ModeRow>(
          ['INSERT INTO spff.ai_execution_modes (site_id,device_id,mode,revision,updated_by)',
           'VALUES ($1,$2,$3,1,$4) RETURNING mode,revision,updated_at,updated_by'].join(' '),
          [configuredSiteId, request.deviceId, request.mode, actor.slice(0, 80)],
        );
    await client.query('COMMIT');
    return presentMode(request.deviceId, changed.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
