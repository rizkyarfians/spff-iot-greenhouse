import type { Request, Response } from 'express';
import {
  aiHstApprovalRequestSchema,
  aiHstApprovalResultSchema,
  aiHstProposalsSchema,
  aiHstExecutionReadinessSchema,
  aiHstRealPreflightSchema,
  aiHstHardwareProfileSchema,
  aiHstRealExecuteRequestSchema,
  aiHstRealStopRequestSchema,
  aiHstModeSchema,
  aiHstModeRequestSchema,
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
import {readHstRealHardwareProfile,saveHstRealHardwareProfile,executeHstReal,hstRealSession,latestHstRealSession}
 from '../services/hstRealExecutionService.js';
import {controlAdaptiveSession} from '../services/adaptiveFertigationService.js';
import {readHstMode,setHstMode} from '../services/hstExecutionModeService.js';

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
        ready: process.env.SPFF_HST_REAL_DISPATCH_ENABLED==='true' &&
           process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true',
        blockers: process.env.SPFF_HST_REAL_DISPATCH_ENABLED==='true' &&
           process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true'
          ? [] : ['real_execution_server_flag_disabled'],
      },
      canDispatch: process.env.SPFF_HST_REAL_DISPATCH_ENABLED==='true' &&
        process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true',
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
    if((await readHstMode()).shadowEnabled)blockers.add('hst_shadow_mode_enabled');
    const profile=proposal.source_row===null?null:
      await readHstRealHardwareProfile(proposal.program_id,proposal.activity_id,proposal.source_row);
    if(!profile)blockers.add('verified_hydraulics_and_single_stock_profile_missing');
    else{
      if(profile.product!==proposal.product)blockers.add('configured_stock_product_mismatch');
      if(row&&profile.programRevision!==row.revision)blockers.add('configured_program_revision_stale');
      const ec=(await readGuideEcConversions(proposal.program_id)).find(c=>c.activityId===proposal.activity_id);
      if(ec?.profile?.revision!==profile.ecProfileRevision)blockers.add('configured_ec_profile_revision_stale');
      if(row?.config?.deviceId!==profile.deviceId)blockers.add('configured_device_mismatch');
    }
    if(process.env.SPFF_HST_REAL_DISPATCH_ENABLED!=='true'||
       process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED!=='true')
       blockers.add('real_execution_server_flag_disabled');
    // Ready means capable of *requesting* an explicit REAL ACC; the POST still
    // performs a fresh Python AI review and atomic local DB/device checks.
    const canDispatch=blockers.size===0;
    const conversion=cfg.success? (await readGuideEcConversions(proposal.program_id))
      .find(item=>item.activityId===proposal.activity_id):null;
    const result = aiHstRealPreflightSchema.parse({
      schemaVersion: 1, obligationId, status: canDispatch?'READY':'BLOCKED',
      reasons: [...blockers].sort(), canDispatch,
      setup: row && cfg.success ? {
       programRevision:Number(row.revision),
       ecProfileRevision:conversion?.profile?.revision??null,
       deviceId:cfg.data.deviceId,
       profile:profile??null,
      }:null,
    });
    res.json({ success: true, data: result, message: 'Pemeriksaan TEST REAL read-only; tidak ada perintah pompa.' });
  } catch {
    res.status(503).json({ success: false, data: null, message: 'Pemeriksaan TEST REAL HST belum tersedia.' });
  }
}

export async function putHstRealHardwareProfile(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const parsed=aiHstHardwareProfileSchema.safeParse(req.body as unknown);
 if(!parsed.success){res.status(400).json({success:false,data:null,message:'Profil stok/hidrolik tidak valid.'});return;}
 try{
  const result=await saveHstRealHardwareProfile(parsed.data,requestActor(req));
  res.json({success:true,data:result,message:'Profil stok/hidrolik disimpan dan diaudit.'});
 }catch(e){
  res.status(e instanceof Error&&'status'in e?Number(e.status):503)
   .json({success:false,data:null,message:e instanceof Error?e.message:'Tidak dapat menyimpan profil.'});
 }
}
export async function getHstRealHardwareProfile(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const id=req.query.programId,activity=req.query.activityId,row=req.query.sourceRow;
 if(typeof id!=='string'||typeof activity!=='string'||typeof row!=='string'||
    !/^[0-9a-f-]{36}$/i.test(id)||!/^row-\d+$/.test(activity)||!/^[1-9]\d*$/.test(row)){
  res.status(400).json({success:false,data:null,message:'Identitas profil invalid.'});return;
 }
 try{
  const profile=await readHstRealHardwareProfile(id,activity,Number(row));
  res.json({success:true,data:profile,message:profile?'Profil tersedia.':'Profil belum disimpan.'});
 }catch{
  res.status(503).json({success:false,data:null,message:'Profil tidak tersedia.'});
 }
}
export async function postHstRealExecute(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const parsed=aiHstRealExecuteRequestSchema.safeParse(req.body as unknown);
 if(!parsed.success){res.status(400).json({success:false,data:null,message:'Permintaan ACC real tidak valid.'});return;}
 try{
  const session=await executeHstReal(parsed.data,requestActor(req));
  res.status(202).json({success:true,data:session,message:'Command sesi HST dicatat; tunggu ACK dan volume aktual ESP32.'});
 }catch(e){
  res.status(e instanceof Error&&'status'in e?Number(e.status):503)
   .json({success:false,data:null,message:e instanceof Error?e.message:'Tidak dapat menjalankan sesi HST.'});
 }
}
export async function getHstRealSession(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const id=req.params.sessionId;
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)){
  res.status(400).json({success:false,data:null,message:'ID sesi tidak valid.'});return;
 }
 try{
  const session=await hstRealSession(id);
  res.json({success:true,data:session,message:'Status sesi aktual dari PostgreSQL.'});
 }catch(e){
  res.status(e instanceof Error&&'status'in e?Number(e.status):503)
   .json({success:false,data:null,message:e instanceof Error?e.message:'Sesi tidak ditemukan.'});
 }
}
export async function postHstRealStop(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const id=req.params.sessionId;
 const parsed=aiHstRealStopRequestSchema.safeParse(req.body as unknown);
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)||!parsed.success){
  res.status(400).json({success:false,data:null,message:'Permintaan STOP tidak valid.'});return;
 }
 try{
  await hstRealSession(id);
  const command=await controlAdaptiveSession(id,'stop',parsed.data.requestId);
  res.status(202).json({success:true,data:{commandId:command.command_id,status:command.status},
    message:'STOP diminta; tunggu bukti kedua pompa OFF dari ESP32.'});
 }catch(e){
  res.status(e instanceof Error&&'status'in e?Number(e.status):503)
   .json({success:false,data:null,message:e instanceof Error?e.message:'Gagal mengirim STOP.'});
 }
}

export async function getHstRealLatest(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const obligationId=req.params.obligationId;
 if(typeof obligationId!=='string'||!/^[a-f0-9]{64}$/.test(obligationId)){
  res.status(400).json({success:false,data:null,message:'ID HST invalid.'});return;
 }
 try{
  const latest=await latestHstRealSession(obligationId);
  res.json({success:true,data:latest,message:latest?'Sesi HST terbaru':'Belum ada sesi fisik HST'});
 }catch{
  res.status(503).json({success:false,data:null,message:'Histori sesi HST tidak tersedia.'});
 }
}

export async function getHstMode(_req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 try{
  const data=await readHstMode();
  res.json({success:true,data:aiHstModeSchema.parse({schemaVersion:1,...data}),
   message:'Mode HST lokal dari PostgreSQL.'});
 }catch{
  res.status(503).json({success:false,data:null,message:'Mode SHADOW lokal tidak tersedia; default aman ON.'});
 }
}
export async function putHstMode(req:Request,res:Response):Promise<void>{
 res.set('Cache-Control','no-store');
 const parsed=aiHstModeRequestSchema.safeParse(req.body as unknown);
 if(!parsed.success){
  res.status(400).json({success:false,data:null,message:'Pilihan SHADOW tidak valid.'});return;
 }
 try{
  const data=await setHstMode(parsed.data.shadowEnabled,requestActor(req));
  res.json({success:true,data:aiHstModeSchema.parse({schemaVersion:1,...data}),
   message:data.shadowEnabled?'SHADOW ON: ACC fisik HST diblokir.':'SHADOW OFF: ACC fisik perlu lolos preflight.'});
 }catch(e){
  res.status(e instanceof Error&&'status'in e?Number(e.status):503)
    .json({success:false,data:null,message:e instanceof Error?e.message:'Gagal mengubah SHADOW MODE.'});
 }
}
