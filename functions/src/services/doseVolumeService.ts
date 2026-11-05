import {createHash,randomUUID} from 'node:crypto';
import {calculateDoseVolume,doseVolumeApproveSchema,doseVolumeCapabilitySchema,doseVolumeControlSchema,
 doseVolumePlanRequestSchema,doseVolumeStartSchema,doseVolumeReconcileSchema,guideProgramConfigSchema,guideProgramHst,
 unifiedAiDashboardSchema,aiHstProposalsSchema,type DoseVolumePlanRequest,type DoseVolumeCapability,type GuideProgramPlan,
 type AiHstProposal} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
import {localAiUrl} from './localAiEndpoint.js';
import {requireHstRealMode} from './hstExecutionModeService.js';

type Database=Pick<typeof pool,'query'>;
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status});};
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,canonical(v)]));
 return value;
}
const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
const recent=(at:unknown,age:number)=>at instanceof Date&&Date.now()-at.getTime()>=-5000&&Date.now()-at.getTime()<=age;
async function ai(path:'/hst/proposals'|'/dashboard/summary'){
 const response=await fetch(localAiUrl(path),{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
 if(!response.ok)return fail('Sumber hitungan AI belum tersedia.',503);
 return response.json() as Promise<unknown>;
}

export async function doseVolumeCredits(proposal:AiHstProposal,database:Database=pool){
 const installed=(await database.query("SELECT to_regclass('spff.dose_volume_bindings') IS NOT NULL AS ready")).rows[0]?.ready;
 if(!installed)return proposal;
 const rows=(await database.query(`SELECT target_mass_g,credited_g,evidence_verified FROM spff.dose_volume_bindings
  WHERE site_id=$1 AND obligation_id=$2`,[siteId,proposal.obligation_id])).rows;
 if(!rows.length)return proposal;
 if(proposal.delivered_g===null||proposal.remaining_g===null)return {...proposal,status:'REQUIRES_REVIEW' as const,
  remaining_g:null,review_reasons:[...proposal.review_reasons,'dose_volume_source_progress_unverified']};
 const credited=rows.reduce((sum:number,row)=>sum+(row.evidence_verified?Number(row.credited_g):0),0);
 if(!Number.isFinite(credited)||credited<0||proposal.target_g===null||credited+proposal.delivered_g!>proposal.target_g+0.01)
  return {...proposal,status:'REQUIRES_REVIEW' as const,remaining_g:null,
   review_reasons:[...proposal.review_reasons,'dose_volume_progress_requires_reconciliation']};
 // Python's existing HST ledger does not ingest this separate protocol ledger.
 const delivered=(proposal.delivered_g??0)+credited;
 const remaining=Math.max(0,proposal.target_g-delivered);
 return {...proposal,delivered_g:delivered,remaining_g:remaining,
  status:proposal.status==='REQUIRES_REVIEW'?proposal.status:remaining<=0.001?'COMPLETED' as const:
   credited>0?'PARTIAL_WAITING_APPROVAL' as const:proposal.status};
}

export async function assertLegacyHstNotVolumeBound(obligationId:string){
 const installed=(await pool.query("SELECT to_regclass('spff.dose_volume_bindings') IS NOT NULL AS ready")).rows[0]?.ready;
 if(installed&&(await pool.query('SELECT 1 FROM spff.dose_volume_bindings WHERE site_id=$1 AND obligation_id=$2 LIMIT 1',[siteId,obligationId])).rows.length)
  return fail('Kewajiban ini memakai ledger dosis/volume; gunakan jalur volume agar dosis tidak diulang.');
}

export async function readDoseVolumeReadiness(deviceId:string){
 const installed=(await pool.query("SELECT to_regclass('spff.dose_volume_bindings') IS NOT NULL AND to_regclass('spff.dose_volume_plans') IS NOT NULL AS ready")).rows[0]?.ready===true;
 const status=(await pool.query(`SELECT raw_payload,recorded_at FROM spff.device_status_events
  WHERE site_id=$1 AND device_id=$2 ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[siteId,deviceId])).rows[0];
 const capability=doseVolumeCapabilitySchema.safeParse(status?.raw_payload?.doseVolumeV1);
 const firmwareReady=capability.success&&recent(status?.recorded_at,90000)&&typeof status?.raw_payload?.firmwareVersion==='string'
  &&status.raw_payload.firmwareVersion!=='1.5.07-AI-ACC-SESSION';
 return {schemaVersion:1,mode:'GUIDE_DOSE_VOLUME',backendReady:installed,deviceId,
  firmwareVersion:status?.raw_payload?.firmwareVersion??null,requiredContract:'spff-dose-volume-v1',
  firmwareReady,dispatchEnabled:process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED==='true',
  canDispatch:false,reason:'Izin fisik tetap diperiksa per rencana dan ACC; profil EC tidak diperlukan.'};
}

type PlanSnapshot={
 mode:'water_only'|'fertigation';programId:string;programRevision:number;activityId:string;deviceId:string;
 obligationId:string|null;sourceRow:number|null;product:string|null;sourceMethod:string;sourceTargetG:number;
 remainingG:number;pastDue:boolean;routeApprovalRequired:boolean;sourceHash:string;policyVersion:string;
 recipe:ReturnType<typeof calculateDoseVolume>;limits:DoseVolumeCapability|null;blockers:string[];
 validUntil:string;volumeBasis:'LINEAR_LEVEL_APPROXIMATION';
};

async function current(input:DoseVolumePlanRequest,database:Database=pool):Promise<PlanSnapshot>{
 let obligation:AiHstProposal|null=null;
 if(input.mode==='fertigation'){
  const proposals=aiHstProposalsSchema.parse(await ai('/hst/proposals')).proposals;
  const original=proposals.find(p=>p.obligation_id===input.obligationId);
  if(!original)return fail('Kewajiban HST tidak ditemukan.',404);
  obligation=await doseVolumeCredits(original,database);
  const legacy=(await database.query(`SELECT 1 FROM spff.hst_real_sessions h
   JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
   WHERE h.site_id=$1 AND h.obligation_id=$2 LIMIT 1`,[siteId,input.obligationId])).rows;
  if(legacy.length)return fail('Ada riwayat dosis jalur EC lama; rekonsiliasi lintas jalur sebelum memakai mode volume.');
  if(obligation.status==='REQUIRES_REVIEW'||obligation.review_reasons.length||obligation.remaining_g===null
    ||obligation.remaining_g<=0||obligation.source_row===null)return fail('Sisa dosis HST perlu diperiksa atau sudah selesai.');
 }
 const programId=input.mode==='water_only'?input.programId:obligation!.program_id;
 const activityId=input.mode==='water_only'?input.activityId:obligation!.activity_id;
 const row=(await database.query('SELECT config,plan,revision,source_sha256,guide_revision FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',
  [siteId,programId])).rows[0];
 const cfg=guideProgramConfigSchema.safeParse(row?.config);
 const plan=row?.plan as GuideProgramPlan|undefined;
 const activity=Array.isArray(plan?.activities)?plan.activities.find(a=>a.id===activityId):undefined;
 if(!cfg.success||!cfg.data.deviceId||!activity)return fail('Program/kegiatan/perangkat Panduan belum valid.');
 const product=obligation?activity.requirements.find(r=>r.row===obligation!.source_row&&r.product===obligation!.product):null;
 if(obligation&&(!product||product.amount===null||!['g','kg'].includes(product.unit)||product.warnings.length||activity.warnings.length))
  return fail('Produk, satuan atau peringatan dosis Panduan perlu ditinjau.');
 const target=product?product.amount!*(product.unit==='kg'?1000:1):0;
 if(obligation&&(!Number.isFinite(target)||target<=0))return fail('Massa produk Panduan belum valid.');
 if(obligation&&Math.abs(target-(obligation.target_g??-1))>0.01)return fail('Target Panduan berubah; periksa ulang kewajiban HST.');
 const today=guideProgramHst(cfg.data.plantingDate);
 if(obligation&&(activity.hst===null||activity.hst>today))return fail('Kegiatan HST belum jatuh tempo.');
 const previous=(await database.query(`SELECT 1 FROM spff.dose_volume_bindings b
  JOIN spff.adaptive_fert_sessions s USING(site_id,session_id)
  WHERE b.site_id=$1 AND b.program_id=$2 AND b.activity_id=$3
  AND (s.status='reconciliation_required' OR (s.status IN ('completed','fault') AND NOT b.evidence_verified)) LIMIT 1`,
  [siteId,programId,activityId])).rows;
 if(previous.length)return fail('Hasil sesi volume sebelumnya belum direkonsiliasi.');
 if((await database.query(`SELECT 1 FROM spff.guide_program_completions
  WHERE site_id=$1 AND program_id=$2 AND activity_id=$3 LIMIT 1`,[siteId,programId,activityId])).rows.length)
  return fail('Kegiatan sudah ditandai selesai manual; periksa dosis sebelum membuat sesi baru.');
 const source=unifiedAiDashboardSchema.parse(await ai('/dashboard/summary'));
 const fuzzy=source.production_fuzzy;
 if(source.planning_source!=='POSTGRES_READ_ONLY'||source.planning_status!=='CURRENT'
   ||!fuzzy||fuzzy.basis!=='TANK_INVENTORY_FUZZY'||fuzzy.status!=='READY'||fuzzy.irrigation_needed!==true
   ||!fuzzy.expires_at||Date.parse(fuzzy.expires_at)<=Date.now())return fail('Fuzzy dan sensor terbaru belum mengizinkan penyiraman.');
 if(source.tank_preview.level_status!=='ESTIMATED'||source.tank_preview.estimated_available_l===null)
  return fail('Volume air tandon belum tersedia.');
 if(input.mode==='fertigation'&&(source.fertilizer_tank_preview.level_status!=='ESTIMATED'
   ||source.fertilizer_tank_preview.estimated_liquid_volume_l===null))return fail('Volume batch larutan pupuk belum tersedia.');
 const sample=(await database.query(`SELECT * FROM spff.telemetry_samples
  WHERE site_id=$1 AND device_id=$2 AND recorded_at=$3 ORDER BY telemetry_id DESC LIMIT 1`,
  [siteId,cfg.data.deviceId,source.planning_recorded_at])).rows[0];
 const sensorKey=fuzzy.input_key;
 const diagnostics=sensorKey?sample?.raw_payload?.sensorHealth?.[sensorKey]:null;
 if(!sample||!sensorKey||!recent(sample.recorded_at,60000)||sample.sensor_health?.[sensorKey]?.valid!==true
   ||diagnostics?.rawFresh!==true||diagnostics.lastPollOk!==true||!Number.isInteger(diagnostics.rawAgeMs)
   ||diagnostics.rawAgeMs<0||diagnostics.rawAgeMs+Math.max(0,Date.now()-sample.recorded_at.getTime())>60000
   ||!Number.isFinite(sample[sensorKey])||Math.abs(sample[sensorKey]-(fuzzy.moisture_pct??-100))>0.11
   ||Math.abs(sample.tank_water_level_pct-(source.tank_preview.reported_level_pct??-100))>0.01
   ||(input.mode==='fertigation'&&Math.abs(sample.tank_fert_level_pct-(source.fertilizer_tank_preview.reported_level_pct??-100))>0.01))
  return fail('Snapshot AI tidak cocok dengan sensor segar pada perangkat program ini.');
 const status=(await database.query(`SELECT raw_payload,recorded_at FROM spff.device_status_events
  WHERE site_id=$1 AND device_id=$2 ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1`,[siteId,cfg.data.deviceId])).rows[0];
 const capability=doseVolumeCapabilitySchema.safeParse(status?.raw_payload?.doseVolumeV1);
 const limits=capability.success?capability.data:null;
 const blockers:string[]=[];
 if(!recent(status?.recorded_at,90000)||!limits||typeof status?.raw_payload?.firmwareVersion!=='string'
   ||status.raw_payload.firmwareVersion==='1.5.07-AI-ACC-SESSION')
  blockers.push('commissioned_dose_volume_firmware_required');
 if(diagnostics.pollBootId!==status?.raw_payload?.pulseBootId)blockers.push('sensor_boot_not_current');
 if(process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED!=='true')blockers.push('dose_volume_server_dispatch_disabled');
 const remaining=obligation?.remaining_g??0;
 const recipe=calculateDoseVolume({mode:input.mode,remainingG:remaining,
  waterAvailableL:source.tank_preview.estimated_available_l,waterCapacityL:source.tank_preview.capacity_l,
  stockAvailableL:source.fertilizer_tank_preview.estimated_liquid_volume_l,stockCapacityL:source.fertilizer_tank_preview.capacity_l,limits});
 if(limits&&(recipe.targetWaterL!<limits.primeWaterL+limits.flushWaterL||recipe.targetWaterL!>limits.maxWaterL
   ||recipe.targetStockL!>limits.maxStockL||(input.mode==='fertigation'&&recipe.targetStockL!<=0)))
  blockers.push('target_exceeds_commissioned_session_limits');
 const sourceHash=hash({config:row.config,activity,revision:row.revision,source:row.source_sha256,guideRevision:row.guide_revision});
 return {mode:input.mode,programId,programRevision:row.revision,activityId,deviceId:cfg.data.deviceId,
  obligationId:obligation?.obligation_id??null,sourceRow:obligation?.source_row??null,product:obligation?.product??null,
  sourceMethod:activity.method,sourceTargetG:target,remainingG:remaining,pastDue:!!obligation&&activity.hst!<today,
  routeApprovalRequired:input.mode==='fertigation'&&!['kocor','irigasi','fertigasi','tetes','drip'].includes(activity.method.toLowerCase().trim()),
  sourceHash,policyVersion:fuzzy.profile_version!,recipe,limits,blockers,validUntil:fuzzy.expires_at,
  volumeBasis:'LINEAR_LEVEL_APPROXIMATION'};
}

export async function createDoseVolumePlan(raw:unknown,actor:string){
 const input=doseVolumePlanRequestSchema.parse(raw);
 const existing=(await pool.query('SELECT * FROM spff.dose_volume_plans WHERE site_id=$1 AND request_id=$2',[siteId,input.requestId])).rows[0];
 if(existing){if(existing.actor!==actor||hash(existing.snapshot.request)!==hash(input))return fail('Request ID sudah digunakan untuk rencana lain.');
  return present(existing);}
 const snapshot=await current(input);const planId=randomUUID();
 const data={...snapshot,request:input};
 const row=(await pool.query(`INSERT INTO spff.dose_volume_plans(site_id,plan_id,request_id,actor,snapshot,fingerprint,valid_until)
  VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(site_id,request_id) DO NOTHING RETURNING *`,
  [siteId,planId,input.requestId,actor,JSON.stringify(data),hash(data),snapshot.validUntil])).rows[0];
 if(!row)return createDoseVolumePlan(input,actor);
 return present(row);
}
function present(row:{plan_id:string;snapshot:PlanSnapshot;valid_until:Date;fingerprint:string}){
 return {planId:row.plan_id,fingerprint:row.fingerprint,recipe:row.snapshot,
  validUntil:row.valid_until.toISOString(),recipeReady:true,
  calculationReady:row.snapshot.recipe.targetWaterL!==null&&row.snapshot.recipe.plannedMassG!==null,canDispatch:false,
  executionReady:row.snapshot.blockers.length===0&&row.valid_until.getTime()>Date.now(),
  preparation:row.snapshot.mode==='fertigation'?'Siapkan batch satu produk dengan total massa dan volume akhir sesuai rencana; konfirmasi sebelum ACC.':'Air saja; pompa pupuk tetap OFF.'};
}

export async function approveDoseVolume(raw:unknown,actor:string){
 const input=doseVolumeApproveSchema.parse(raw);const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['dose-volume-approval:'+siteId+':'+input.approvalId]);
  const replay=(await c.query('SELECT * FROM spff.dose_volume_bindings WHERE site_id=$1 AND approval_id=$2',[siteId,input.approvalId])).rows[0];
  if(replay){if(replay.actor!==actor||hash(replay.approval)!==hash(input))return fail('Approval ID konflik.');
   await c.query('COMMIT');return readDoseVolumeSession(replay.session_id);}
  if(process.env.SPFF_DOSE_VOLUME_DISPATCH_ENABLED!=='true')return fail('Izin eksekusi dosis/volume belum aktif.');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['hst-mode:'+siteId]);
  await requireHstRealMode(c);
  const stored=(await c.query('SELECT * FROM spff.dose_volume_plans WHERE site_id=$1 AND plan_id=$2 FOR UPDATE',[siteId,input.planId])).rows[0];
  if(!stored||stored.valid_until.getTime()<=Date.now())return fail('Rencana kedaluwarsa; hitung dan tinjau ulang.');
  if((await c.query('SELECT 1 FROM spff.dose_volume_bindings WHERE site_id=$1 AND plan_id=$2 LIMIT 1',[siteId,input.planId])).rows.length)
   return fail('Rencana ini sudah dipakai; buat rencana baru untuk sesi berikutnya.');
  const old=stored.snapshot as PlanSnapshot&{request:DoseVolumePlanRequest};
  await c.query('SELECT program_id FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2 FOR SHARE',[siteId,old.programId]);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`soil-ec:${siteId}:${old.deviceId}`]);
  if(old.obligationId)await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['hst-real:'+siteId+':'+old.obligationId]);
  const fresh=await current(old.request,c);
  if(fresh.blockers.length||!fresh.limits||hash(fresh.limits)!==hash(old.limits))return fail('Firmware/batas perangkat belum siap atau berubah.');
  if(fresh.sourceHash!==old.sourceHash||fresh.policyVersion!==old.policyVersion||Math.abs(fresh.remainingG-old.remainingG)>0.001)
   return fail('Panduan atau sisa kebutuhan berubah; tinjau rencana baru.');
  if(old.routeApprovalRequired&&!input.confirmApplicationRoute)return fail('Setujui penggunaan jalur pompa untuk metode Panduan ini secara eksplisit.');
  if(old.pastDue&&!input.confirmPastDue)return fail('Kegiatan lewat jadwal perlu persetujuan eksplisit.');
  if(fresh.recipe.waterInventoryL+0.001<old.recipe.waterInventoryL
    ||(fresh.recipe.batchVolumeL??0)+0.001<(old.recipe.batchVolumeL??0))return fail('Isi tandon berkurang setelah rencana; tinjau ulang batch.');
  const equipment=(await c.query(`SELECT c.*,s.online,s.mode,s.recorded_at,s.raw_payload
   FROM spff.device_automatic_control_configs c JOIN LATERAL(SELECT * FROM spff.device_status_events
    WHERE site_id=c.site_id AND device_id=c.device_id ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1)s ON true
   WHERE c.site_id=$1 AND c.device_id=$2 FOR SHARE OF c`,[siteId,old.deviceId])).rows[0];
  const status=equipment?.raw_payload;
  if(!equipment?.online||!recent(equipment.recorded_at,90000)||equipment.mode!=='manual'
    ||equipment.desired_mode!=='manual'||equipment.applied_mode!=='manual'||equipment.acknowledgement_status!=='applied'
    ||String(equipment.revision)!==String(equipment.acknowledged_revision)||equipment.water_enabled||equipment.fertilizer_enabled
    ||status?.pumpReadbackValid!==true||status.pumpWaterActualActive!==false||status.pumpFertActualActive!==false
    ||status.aiAccSessionActive!==false||hash(status.doseVolumeV1)!==hash(fresh.limits))return fail('Perangkat, mode atau kondisi kedua pompa belum terkonfirmasi idle.');
  const sample=(await c.query(`SELECT * FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2
   AND recorded_at<=now()+interval '5 seconds' ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1`,[siteId,old.deviceId])).rows[0];
  const keys=old.mode==='water_only'?['tank_water_level_pct','flow_water_lpm']:['tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm'];
  if(!recent(sample?.recorded_at,60000)||keys.some(key=>!Number.isFinite(sample[key])||sample[key]<0||sample.sensor_health?.[key]?.valid!==true)
   ||sample.tank_water_level_pct<=fresh.limits.waterStopPct
   ||(old.mode==='fertigation'&&sample.tank_fert_level_pct<=fresh.limits.stockStopPct))return fail('Data tandon/aliran tidak valid atau level minimum tercapai.');
  const busy=(await c.query(`SELECT 1 FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND device_id=$2 AND status NOT IN ('completed','fault')
   UNION ALL SELECT 1 FROM spff.actuator_schedules WHERE site_id=$1 AND device_id=$2 AND enabled AND actuator_key IN ('pump_water','pump_fert')
   UNION ALL SELECT 1 FROM spff.device_soil_ec_execution_configs WHERE site_id=$1 AND device_id=$2 AND enabled
   UNION ALL SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2 AND status IN ('waiting','in_flight','fault')
   UNION ALL SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2 AND status IN ('pending','published','accepted')
   UNION ALL SELECT 1 FROM spff.adaptive_fert_commands cmd JOIN spff.adaptive_fert_sessions sess USING(site_id,session_id)
    WHERE sess.site_id=$1 AND sess.device_id=$2 AND cmd.expires_at>now() AND cmd.status NOT IN ('cancelled','expired','completed','rejected') LIMIT 1`,
   [siteId,old.deviceId])).rows;
  if(busy.length)return fail('Pompa sedang dimiliki jadwal, command atau sesi lain.');
  const sessionId=randomUUID(),commandId=randomUUID(),issued=new Date();
  const expires=new Date(Math.min(issued.getTime()+15000,stored.valid_until.getTime(),Date.parse(fresh.validUntil)));
  if(expires.getTime()<=issued.getTime())return fail('Bukti sensor/rencana kedaluwarsa saat ACC; tinjau ulang.');
  const command=doseVolumeStartSchema.parse({kind:'dose_volume_command',schemaVersion:1,contract:'spff-dose-volume-v1',
   siteId,deviceId:old.deviceId,sessionId,commandId,commandType:'start',controlAlgorithm:'guide_dose_volume_v1',
   mode:old.mode,planId:input.planId,bootId:status.pulseBootId,issuedAt:issued.toISOString(),expiresAt:expires.toISOString(),
   targetWaterVolumeL:old.recipe.targetWaterL!+(fresh.limits.waterMeterPosition==='after_injector'?old.recipe.targetStockL!:0),
   targetStockVolumeL:old.recipe.targetStockL,nominalConcentrationGPerL:old.recipe.nominalConcentrationGPerL,
   targetMassG:old.recipe.plannedMassG,limits:fresh.limits});
  await c.query(`INSERT INTO spff.adaptive_fert_sessions(site_id,session_id,device_id,program_id,program_revision,activity_id,
   activity_fingerprint,request_id,input,command_snapshot,conversion_snapshot,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[siteId,sessionId,old.deviceId,old.programId,old.programRevision,old.activityId,
   old.sourceHash,input.approvalId,JSON.stringify(input),JSON.stringify(command),JSON.stringify({mode:'guide_dose_volume_v1',planId:input.planId}),actor]);
  await c.query(`INSERT INTO spff.dose_volume_bindings(site_id,session_id,plan_id,approval_id,actor,approval,obligation_id,
   program_id,program_revision,activity_id,source_row,product,target_mass_g) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
   [siteId,sessionId,input.planId,input.approvalId,actor,JSON.stringify(input),old.obligationId,old.programId,old.programRevision,old.activityId,old.sourceRow,old.product,old.remainingG]);
  await c.query(`INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)
   VALUES($1,$2,$3,$4,$5,$6)`,[siteId,commandId,sessionId,input.approvalId,JSON.stringify(command),command.expiresAt]);
  await c.query('COMMIT');return readDoseVolumeSession(sessionId);
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

export async function listDoseVolumeSessions(){
 const result=await pool.query(`SELECT s.session_id,s.device_id,s.status,s.reason,s.water_volume_l,s.fert_volume_l,
  s.last_telemetry_at,b.product,b.credited_g,b.evidence_verified,b.evidence_basis
  FROM spff.adaptive_fert_sessions s JOIN spff.dose_volume_bindings b USING(site_id,session_id)
  WHERE s.site_id=$1 AND (s.status NOT IN ('completed','fault') OR s.created_at>now()-interval '1 day')
  ORDER BY (s.status NOT IN ('completed','fault')) DESC,s.created_at DESC LIMIT 20`,[siteId]);
 return result.rows;
}

export async function readDoseVolumeSession(id:string){
 const row=(await pool.query(`SELECT s.session_id,s.device_id,s.status,s.reason,s.water_volume_l,s.fert_volume_l,
  s.last_telemetry_at,s.command_snapshot,b.plan_id,b.obligation_id,b.product,b.target_mass_g,b.credited_g,b.evidence_verified,b.evidence_basis
  FROM spff.adaptive_fert_sessions s JOIN spff.dose_volume_bindings b USING(site_id,session_id)
  WHERE s.site_id=$1 AND s.session_id=$2`,[siteId,id])).rows[0];
 return row??fail('Sesi dosis/volume tidak ditemukan.',404);
}

export async function reconcileDoseVolume(id:string,raw:unknown,actor:string){
 const input=doseVolumeReconcileSchema.parse(raw);const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const replay=(await c.query('SELECT * FROM spff.adaptive_fert_reconciliations WHERE reconciliation_id=$1',[input.requestId])).rows[0];
  if(replay){if(replay.site_id!==siteId||replay.session_id!==id||replay.actor!==actor||hash(replay.observation)!==hash(input))return fail('Request rekonsiliasi konflik.');
   await c.query('COMMIT');return readDoseVolumeSession(id);}
  const row=(await c.query(`SELECT s.*,b.target_mass_g,b.evidence_verified FROM spff.adaptive_fert_sessions s
   JOIN spff.dose_volume_bindings b USING(site_id,session_id) WHERE s.site_id=$1 AND s.session_id=$2 FOR UPDATE OF s,b`,[siteId,id])).rows[0];
  if(!row||row.evidence_verified||!['reconciliation_required','fault'].includes(row.status))return fail('Sesi tidak memerlukan rekonsiliasi.');
  const command=doseVolumeStartSchema.parse(row.command_snapshot);
  if(input.waterVolumeL<row.water_volume_l||input.stockVolumeL<row.fert_volume_l
    ||input.waterVolumeL>command.targetWaterVolumeL+command.limits.meterToleranceL
    ||input.stockVolumeL>command.targetStockVolumeL+command.limits.meterToleranceL
    ||(command.mode==='water_only'&&input.stockVolumeL!==0))return fail('Volume rekonsiliasi tidak sesuai bukti atau batas sesi.');
  if((await c.query('SELECT 1 FROM spff.adaptive_fert_commands WHERE site_id=$1 AND session_id=$2 AND expires_at>now() LIMIT 1',[siteId,id])).rows.length)
   return fail('Tunggu seluruh command kedaluwarsa dan verifikasi pompa OFF.');
  await c.query('INSERT INTO spff.adaptive_fert_reconciliations(reconciliation_id,site_id,session_id,observation,actor) VALUES($1,$2,$3,$4,$5)',
   [input.requestId,siteId,id,JSON.stringify(input),actor]);
  const credited=Math.min(row.target_mass_g,input.stockVolumeL*command.nominalConcentrationGPerL);
  await c.query("UPDATE spff.dose_volume_bindings SET credited_g=$3,evidence_verified=true,evidence_basis='OPERATOR_RECONCILED' WHERE site_id=$1 AND session_id=$2",[siteId,id,credited]);
  await c.query("UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=$1 AND session_id=$2 AND status='pending'",[siteId,id]);
  await c.query("UPDATE spff.adaptive_fert_sessions SET status='fault',reason='dose_volume_operator_reconciled',water_volume_l=$3,fert_volume_l=$4 WHERE site_id=$1 AND session_id=$2",
   [siteId,id,input.waterVolumeL,input.stockVolumeL]);
  await c.query('COMMIT');return readDoseVolumeSession(id);
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function stopDoseVolume(id:string,requestId:string,actor:string){
 const c=await pool.connect();try{
  await c.query('BEGIN');
  const replay=(await c.query('SELECT payload FROM spff.adaptive_fert_commands WHERE site_id=$1 AND request_id=$2',[siteId,requestId])).rows[0];
  if(replay){if(replay.payload.sessionId!==id||replay.payload.commandType!=='stop')return fail('Request STOP konflik.');await c.query('COMMIT');return replay.payload;}
  const row=(await c.query(`SELECT s.* FROM spff.adaptive_fert_sessions s JOIN spff.dose_volume_bindings b USING(site_id,session_id)
   WHERE s.site_id=$1 AND s.session_id=$2 FOR UPDATE OF s`,[siteId,id])).rows[0];
  if(!row)return fail('Sesi tidak ditemukan.',404);
  if(['completed','fault'].includes(row.status))return fail('Sesi sudah terminal.');
  const now=new Date();const command=doseVolumeControlSchema.parse({kind:'dose_volume_command',schemaVersion:1,
   contract:'spff-dose-volume-v1',siteId,deviceId:row.device_id,sessionId:id,commandId:randomUUID(),commandType:'stop',
   bootId:row.command_snapshot.bootId,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+15000).toISOString()});
  await c.query("UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=$1 AND session_id=$2 AND status='pending' AND payload->>'commandType'='start'",[siteId,id]);
  await c.query(`INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)
   VALUES($1,$2,$3,$4,$5,$6)`,[siteId,command.commandId,id,requestId,JSON.stringify(command),command.expiresAt]);
  await c.query("UPDATE spff.adaptive_fert_sessions SET reason=CASE WHEN status='reconciliation_required' THEN reason ELSE $3 END,status='reconciliation_required' WHERE site_id=$1 AND session_id=$2",[siteId,id,'stop_requested_by:'+actor]);
  await c.query('COMMIT');return command;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
