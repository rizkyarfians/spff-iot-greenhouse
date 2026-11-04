import type { Request, Response } from 'express';
import {
  aiHstApprovalRequestSchema,
  aiHstApprovalResultSchema,
  aiHstProposalsSchema,
  aiHstExecutionReadinessSchema,
  aiHstRealPreflightSchema,
  guideProgramConfigSchema,
  guideProgramHst,
  guideEcRecipe,
  type GuideActivity,
  type GuideProgramPlan,
} from '@spff/contracts';
import { requestActor } from '../middleware/operatorAuth.js';

import { localAiUrl } from '../services/localAiEndpoint.js';
import { pool, configuredSiteId as siteId } from '../services/postgresRepository.js';
import { readGuideEcConversions } from '../services/guideEcConversionService.js';

export async function getHstProposals(_req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  try {
    const response = await fetch(localAiUrl('/hst/proposals'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      res.status(503).json({ success: false, data: null, message: 'HST AI belum tersedia.' });
      return;
    }
    const parsed = aiHstProposalsSchema.safeParse(await response.json() as unknown);
    if (!parsed.success) {
      res.status(503).json({ success: false, data: null, message: 'Format HST AI tidak valid.' });
      return;
    }
    res.json({ success: true, data: parsed.data, message: 'Usulan HST SHADOW.' });
  } catch {
    res.status(503).json({ success: false, data: null, message: 'HST AI tidak terjangkau.' });
  }
}

export async function postHstApproval(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const parsedRequest = aiHstApprovalRequestSchema.safeParse(req.body as unknown);
  if (!parsedRequest.success) {
    res.status(400).json({ success: false, data: null, message: 'ACC HST tidak valid.' });
    return;
  }
  const body = parsedRequest.data;
  const key = process.env.AI_HST_BRIDGE_KEY;
  // A public browser must never have access to this backend-to-AI secret.
  if (!key || key.length < 32) {
    res.status(503).json({ success: false, data: null,
      message: 'Jembatan ACC HST belum dikonfigurasi; belum ada persetujuan dicatat.' });
    return;
  }
  try {
    const response = await fetch(localAiUrl('/hst/approvals'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-SPFF-Bridge-Key': key,
      },
      body: JSON.stringify({
        obligation_id: body.obligationId,
        approval_id: body.approvalId,
        expected_remaining_g: body.expectedRemainingG,
        actor: requestActor(req),
        confirmation: 'REVIEW_HST_SHADOW_SESSION',
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      res.status(response.status === 409 ? 409 : 503).json({
        success: false, data: null,
        message: response.status === 409
          ? 'Usulan berubah atau tidak bisa disetujui. Refresh sebelum ACC ulang.'
          : 'Pemeriksaan ACC HST tidak tersedia.',
      });
      return;
    }
    const parsedResult = aiHstApprovalResultSchema.safeParse(await response.json() as unknown);
    if (!parsedResult.success) {
      res.status(503).json({ success: false, data: null,
        message: 'Konfirmasi SHADOW dari AI tidak valid.' });
      return;
    }
    res.json({ success: true, data: parsedResult.data,
      message: 'ACC sesi dicatat sebagai review SHADOW. Tidak ada perintah pompa.' });
  } catch {
    res.status(503).json({ success: false, data: null,
      message: 'Pemeriksaan sensor setelah ACC gagal; status eksekusi tetap BLOCKED.' });
  }
}

/** Expose authoritative fail-closed readiness. This route never changes AI
 * runtime state, grants MQTT privileges, or drives the ESP32.
 * Do not turn this flag on until HST/firmware session mapping is implemented,
 * proven with real hardware, and guarded by independent safety preflight.
 */
export function getHstExecutionReadiness(_req: Request, res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: aiHstExecutionReadinessSchema.parse({
      schemaVersion: 1,
      runningMode: 'SHADOW_MODE',
      realTest: {
        ready: false,
        blockers: [
          'hst_ai_to_firmware_volume_session_not_verified',
          'device_ack_and_actual_pump_state_integration_not_verified',
          'fertilizer_dose_to_single_stock_session_binding_not_verified',
        ],
      },
      canDispatch: false,
    }),
    message: 'TEST REAL belum dapat diaktifkan; SHADOW tetap aman.',
  });
}

/** Purely observational HST -> volume-session compatibility check.
 * Real ACC route MUST NOT be enabled through this endpoint; its result always
 * contains blockers and never starts an adaptive session or publishes MQTT.
 */
export async function getHstRealPreflight(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const obligationId = req.params.obligationId;
  if (typeof obligationId !== 'string' || !/^[a-f0-9]{64}$/.test(obligationId)) {
    res.status(400).json({ success: false, data: null, message: 'ID kewajiban HST tidak valid.' });
    return;
  }
  try {
    const response = await fetch(localAiUrl('/hst/proposals'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('AI HST tidak tersedia');
    const proposals = aiHstProposalsSchema.safeParse(await response.json() as unknown);
    if (!proposals.success) throw new Error('Kontrak AI HST tidak valid');
    const proposal = proposals.data.proposals.find(item => item.obligation_id === obligationId);
    if (!proposal) {
      res.status(404).json({ success: false, data: null, message: 'Proposal HST tidak ditemukan.' });
      return;
    }
    const blockers = new Set<string>();
    if (proposal.status === 'COMPLETED') blockers.add('obligation_completed');
    if (proposal.status === 'REQUIRES_REVIEW' || proposal.review_reasons.length) blockers.add('hst_source_requires_review');
    if (proposal.remaining_g === null || proposal.remaining_g <= 0) blockers.add('unverified_remaining_fertilizer_mass');

    const row = (await pool.query(
      'SELECT config, plan, revision FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',
      [siteId, proposal.program_id],
    )).rows[0];
    const cfg = guideProgramConfigSchema.safeParse(row?.config as unknown);
    if (!row || !cfg.success) {
      blockers.add('guide_program_missing_or_invalid');
    } else {
      const plan = row.plan as GuideProgramPlan | null;
      const activity: GuideActivity | undefined = Array.isArray(plan?.activities)
        ? plan.activities.find(item => item.id === proposal.activity_id)
        : undefined;
      const source = activity?.requirements.find(item => item.row === proposal.source_row);
      if (!activity || !source || source.product !== proposal.product
        || activity.hst !== proposal.hst) blockers.add('hst_proposal_source_identity_mismatch');
      if (activity && (activity.requirements.length !== 1 || !source))
        blockers.add('one_verified_fertilizer_product_per_session_required');
      if (activity && activity.method.trim().toLowerCase() !== 'kocor')
        blockers.add('fertilizer_application_route_not_verified_for_adaptive_session');
      if (activity && guideProgramHst(cfg.data.plantingDate) !== activity.hst)
        blockers.add('hst_schedule_is_not_due_today');
      if (activity && !guideEcRecipe(activity)) blockers.add('guide_ec_recipe_not_validated');
      // Even valid guide EC is only an interpolation; it does NOT establish
      // the actual stock container, its concentration, or the current volume.
      try {
        const conversions = await readGuideEcConversions(proposal.program_id);
        if (!conversions.some(item => item.activityId === proposal.activity_id
          && item.status === 'ready' && item.profile !== null))
          blockers.add('measured_guide_ec_conversion_profile_required');
      } catch {
        blockers.add('guide_ec_profile_unavailable');
      }
      if (!cfg.data.deviceId) {
        blockers.add('program_device_unbound');
      } else {
        const [statusResult, controlResult] = await Promise.all([
          pool.query(`SELECT online, mode, recorded_at, raw_payload
            FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
            ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`, [siteId, cfg.data.deviceId]),
          pool.query(`SELECT desired_mode,applied_mode,revision,acknowledged_revision,acknowledgement_status,
                     water_enabled,fertilizer_enabled
            FROM spff.device_automatic_control_configs
            WHERE site_id=$1 AND device_id=$2 LIMIT 1`, [siteId, cfg.data.deviceId]),
        ]);
        const device = statusResult.rows[0];
        const control = controlResult.rows[0];
        const raw = device?.raw_payload as Record<string, unknown> | undefined;
        const last = device?.recorded_at instanceof Date ? device.recorded_at.getTime() : Number.NaN;
        if (!device?.online || !Number.isFinite(last) || last > Date.now() + 5000 || Date.now() - last > 90000)
          blockers.add('device_offline_or_stale');
        if (raw?.firmwareVersion !== '1.5.07-AI-ACC-SESSION'
            || typeof raw?.pulseBootId !== 'string' || !/^[a-fA-F0-9]{16}$/.test(raw.pulseBootId))
          blockers.add('firmware_1507_and_fresh_boot_id_required');
        if (raw?.pumpReadbackValid !== true || raw?.pumpWaterActualActive !== false
            || raw?.pumpFertActualActive !== false || raw?.aiAccSessionActive !== false)
          blockers.add('pumps_not_confirmed_idle_by_device');
        if (device?.mode !== 'manual' || control?.desired_mode !== 'manual'
            || control?.applied_mode !== 'manual' || control?.acknowledgement_status !== 'applied'
            || String(control?.revision ?? '') !== String(control?.acknowledged_revision ?? '')
            || control?.water_enabled !== false || control?.fertilizer_enabled !== false)
          blockers.add('manual_session_control_not_acknowledged');
      }
    }
    // These gates remain until verified stock profile, atomic HST reservation,
    // hardware volume/ACK correlation and physical acceptance tests exist.
    blockers.add('single_stock_concentration_and_hst_mass_binding_not_verified');
    blockers.add('atomic_hst_approval_to_firmware_session_binding_not_implemented');
    blockers.add('hardware_volume_ack_interlock_acceptance_test_pending');

    const result = aiHstRealPreflightSchema.parse({
      schemaVersion: 1, obligationId, status: 'BLOCKED', reasons: [...blockers].sort(), canDispatch: false,
    });
    res.json({ success: true, data: result, message: 'Pemeriksaan TEST REAL read-only; tidak ada perintah pompa.' });
  } catch {
    res.status(503).json({ success: false, data: null, message: 'Pemeriksaan TEST REAL HST belum tersedia.' });
  }
}
