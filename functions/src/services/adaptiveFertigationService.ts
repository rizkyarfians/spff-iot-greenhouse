import {randomUUID} from 'node:crypto';
import {adaptiveStartCommandSchema,adaptiveFirmware1507StartSchema,guideEcRecipe,guideProgramHst,type AdaptiveSessionInput,type GuideActivity,type AiHstRealPlan} from '@spff/contracts';
import {pool,configuredSiteId as siteId} from './postgresRepository.js';
import {requireHstRealMode} from './hstExecutionModeService.js';
import {readGuideEcConversions} from './guideEcConversionService.js';
import {activityFingerprint} from './guideProgramService.js';
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status});};
export async function adaptiveProgress(programId:string,database:Pick<typeof pool,'query'>=pool){
 const p=(await database.query('SELECT config,plan FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',[siteId,programId])).rows[0];if(!p)return fail('Program tidak ditemukan.',404);
 const sessions=(await database.query(`SELECT s.*,s.fert_volume_l*(s.command_snapshot->>'nominalConcentrationGPerL')::double precision AS estimated_mass_g
  FROM spff.adaptive_fert_sessions s WHERE site_id=$1 AND program_id=$2 ORDER BY created_at DESC`,[siteId,programId])).rows;
 return {programId,massBasis:'estimated_from_metered_stock_volume_and_nominal_concentration',activities:(p.plan.activities as GuideActivity[]).map(a=>{
  const recipe=guideEcRecipe(a),fingerprint=activityFingerprint(a,p.config),matching=sessions.filter(s=>s.activity_fingerprint===fingerprint),delivered=matching.reduce((sum,s)=>sum+Number(s.estimated_mass_g),0),target=recipe?recipe.concentrationGPerL*a.waterL!:null;
  return {activityId:a.id,targetMassG:target,estimatedDeliveredMassG:delivered,remainingMassG:target===null?null:Math.max(0,target-delivered),requiresReconciliation:matching.some(s=>s.status==='reconciliation_required'),sessions:matching};
 }),history:sessions};
}
async function plan(input:AdaptiveSessionInput,database:Pick<typeof pool,'query'>=pool){
 const p=(await database.query('SELECT * FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2',[siteId,input.programId])).rows[0];if(!p)return fail('Program tidak ditemukan.',404);
 if(p.revision!==input.expectedProgramRevision)return fail('Revisi program berubah.');
 const activity=(p.plan.activities as GuideActivity[]).find(a=>a.id===input.activityId);
 if(!activity||activity.method.toLowerCase()!=='kocor'||activity.hst===null||activity.hst>guideProgramHst(p.config.plantingDate))return fail('Kegiatan bukan kocor yang sudah waktunya.');
 if(!p.config.deviceId)return fail('Hubungkan perangkat pada program.');
 if((await database.query('SELECT 1 FROM spff.guide_program_completions WHERE site_id=$1 AND program_id=$2 AND activity_fingerprint=$3 LIMIT 1',[siteId,input.programId,activityFingerprint(activity,p.config)])).rows.length)return fail('Kegiatan sudah ditandai selesai manual; sesi adaptif tidak dibuat.');
 const conversion=(await readGuideEcConversions(input.programId,database)).find(c=>c.activityId===input.activityId);
 if(!conversion||conversion.status!=='ready'||conversion.targetEcMsCm===null||!conversion.profile)return fail(conversion?.reason??'Konversi EC wajib tersedia.');
 const progress=await adaptiveProgress(input.programId,database);
 if(progress.history.some(s=>s.activity_id===input.activityId&&s.activity_fingerprint!==activityFingerprint(activity,p.config)&&Number(s.estimated_mass_g)>0))return fail('Resep kegiatan berubah setelah pemberian. Rekonsiliasi dosis antar-revisi diperlukan.');
 const remaining=progress.activities.find(a=>a.activityId===input.activityId)!;
 if(!remaining.remainingMassG||remaining.requiresReconciliation)return fail('Dosis selesai atau perlu rekonsiliasi.');
 const cMix=conversion.concentrationGPerL!,cStock=input.stockConcentrationGPerL;
 if(cStock<=cMix)return fail('Pekatan harus lebih terkonsentrasi dari larutan akhir.');
 const proposedStock=input.waterMeterPosition==='before_injector'?cMix*input.waterVolumeL/(cStock-cMix):cMix*input.waterVolumeL/cStock;
 const stockL=Math.min(proposedStock,remaining.remainingMassG/cStock),mixedL=stockL*cStock/cMix;
 const waterL=input.waterMeterPosition==='before_injector'?mixedL-stockL:mixedL;
 const command=adaptiveStartCommandSchema.safeParse({kind:'adaptive_fert_command',schemaVersion:1,siteId,deviceId:p.config.deviceId,sessionId:randomUUID(),commandId:randomUUID(),commandType:'start',targetEcUs:conversion.targetEcMsCm*1000,ecToleranceUs:input.ecToleranceUs,maxDurationSec:input.maxDurationSec,targetWaterVolumeL:waterL,targetFertVolumeL:stockL,nominalConcentrationGPerL:cStock,plantCount:Math.round(p.plan.plants),flushDurationSec:input.flushDurationSec});
 if(!command.success)return fail('Hasil konversi/jatah sesi di luar batas kontrak firmware adaptif. Target tidak dibulatkan atau diganti default.');
 return {program:p,activity,conversion,command:command.data,remainingMassG:remaining.remainingMassG,mixedVolumeL:mixedL};
}
export async function previewAdaptiveSession(input:AdaptiveSessionInput){const p=await plan(input);return {command:p.command,conversion:p.conversion,remainingMassG:p.remainingMassG,mixedVolumeL:p.mixedVolumeL,dispatchEnabled:process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true',resumeSupported:false};}
export type HstAdaptiveBinding={obligationId:string;approvalId:string;expectedRemainingG:number;sourceRow:number;product:string;aiPlan:AiHstRealPlan};
export async function createAdaptiveSession(input:AdaptiveSessionInput,actor:string,hst?:HstAdaptiveBinding){
 if(process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED!=='true')return fail('Dispatch adaptif belum diaktifkan; preview dan penerimaan telemetry tetap tersedia.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize same-program dose allocation and the existing soil-EC controller's device lock.
  await client.query('SELECT program_id FROM spff.guide_programs WHERE site_id=$1 AND program_id=$2 FOR UPDATE',[siteId,input.programId]);
  if(hst){
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ 'hst-mode:'+siteId ]);
   await requireHstRealMode(client);
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ 'hst-real:'+siteId+':'+hst.obligationId ]);
  }
  const prior=(await client.query('SELECT * FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND request_id=$2',[siteId,input.requestId])).rows[0];
  if(prior){if(hst){
   const link=(await client.query('SELECT obligation_id,approval_id FROM spff.hst_real_sessions WHERE site_id=$1 AND session_id=$2',[siteId,prior.session_id])).rows[0];
   if(!link||link.obligation_id!==hst.obligationId||link.approval_id!==hst.approvalId)return fail('ACC HST sudah digunakan oleh sesi yang berbeda.');
  }
  if(JSON.stringify(prior.input)!==JSON.stringify(JSON.parse(JSON.stringify(input)))){
   // PostgreSQL jsonb key order differs; compare canonical sorted fields.
   if(Object.entries(input).some(([k,v])=>prior.input[k]!==v))return fail('requestId sudah dipakai untuk permintaan berbeda.');
  }await client.query('COMMIT');return prior;}
  const p=await plan(input,client),device=p.command.deviceId;
  let command=p.command;
  if(hst){
   // Lock the verified stock/hydraulics row while creating the physical
   // command. A concurrent admin edit must not silently change the plant dose.
   const verified=(await client.query(`SELECT * FROM spff.hst_real_profiles
    WHERE site_id=$1 AND program_id=$2 AND activity_id=$3 AND source_row=$4 FOR SHARE`,
    [siteId,input.programId,input.activityId,hst.sourceRow])).rows[0];
   if(!verified||verified.product!==hst.product||verified.device_id!==device||
      verified.program_revision!==input.expectedProgramRevision||
      verified.ec_profile_revision!==input.expectedProfileRevision||
      verified.water_meter_position!==input.waterMeterPosition||
      verified.stock_concentration_g_l!==input.stockConcentrationGPerL||
      verified.max_duration_sec!==input.maxDurationSec||
      verified.flush_duration_sec!==input.flushDurationSec||
      verified.ec_tolerance_us!==input.ecToleranceUs||
      verified.hydraulics_reference!==input.hydraulicsReference)
     return fail('Konfigurasi fisik pupuk/hidrolik berubah saat ACC. Ulangi preflight.');
   const matching=p.activity.requirements.filter(r=>r.row===hst.sourceRow&&r.product===hst.product);
   if(p.activity.requirements.length!==1||matching.length!==1)
    return fail('Satu sesi HST harus terikat ke satu produk pupuk dan baris Panduan yang tepat.');
   const planMass=hst.aiPlan.stock_l*input.stockConcentrationGPerL;
   const toler=Math.max(0.01,Math.abs(planMass)*0.001);
   if(!Number.isFinite(planMass)||Math.abs(hst.aiPlan.mass_g-planMass)>toler||
      hst.aiPlan.mass_g>hst.expectedRemainingG+toler ||
      hst.aiPlan.mass_g>p.remainingMassG+toler ||
      Math.abs(hst.expectedRemainingG-p.remainingMassG)>Math.max(0.1,hst.expectedRemainingG*0.001))
    return fail('Massa AI, jatah HST tersisa, dan konsentrasi stok tidak konsisten.');
   if(hst.aiPlan.duration_seconds+input.flushDurationSec>input.maxDurationSec ||
      hst.aiPlan.flush_reserve_l<=0 || hst.aiPlan.priming_water_l<=0 ||
      hst.aiPlan.water_l<=hst.aiPlan.priming_water_l+hst.aiPlan.flush_reserve_l)
    return fail('Durasi/volume air AI tidak memenuhi cadangan priming dan flushing.');
   const validated=adaptiveStartCommandSchema.safeParse({
      ...p.command,
      // The upstream meter counts water only; the downstream meter records
      // total mixture after Venturi. Never silently treat both as equivalent.
      targetWaterVolumeL:input.waterMeterPosition==='after_injector'
       ?hst.aiPlan.water_l+hst.aiPlan.stock_l:hst.aiPlan.water_l,
      targetFertVolumeL:hst.aiPlan.stock_l,
   });
   if(!validated.success)return fail('Hasil kalkulasi AI berada di luar batas pompa firmware 1.5.07.');
   command=validated.data;
   const existing=(await client.query(`SELECT s.status FROM spff.hst_real_sessions h
     JOIN spff.adaptive_fert_sessions s ON s.site_id=h.site_id AND s.session_id=h.session_id
     WHERE h.site_id=$1 AND h.obligation_id=$2 AND s.status NOT IN ('completed','fault')
     LIMIT 1`,[siteId,hst.obligationId])).rows[0];
   if(existing)return fail('Sudah ada sesi HST aktif atau membutuhkan rekonsiliasi.');
  }
  if(input.expectedProfileRevision!==p.conversion.profile!.revision)return fail('Profil konversi berubah atau belum ditinjau. Sertakan expectedProfileRevision dari preview.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`soil-ec:${siteId}:${device}`]);
  const profile=(await client.query('SELECT revision FROM spff.guide_ec_profiles WHERE site_id=$1 AND recipe_key=$2 FOR SHARE',[siteId,p.conversion.recipeKey])).rows[0];
  if(profile?.revision!==p.conversion.profile!.revision)return fail('Profil konversi berubah; hitung ulang sesi.');
  const equipment=(await client.query(`SELECT c.*,st.online,st.recorded_at,st.raw_payload,st.mode FROM spff.device_automatic_control_configs c
   JOIN LATERAL(SELECT * FROM spff.device_status_events WHERE site_id=c.site_id AND device_id=c.device_id ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1)st ON true
   WHERE c.site_id=$1 AND c.device_id=$2 FOR SHARE OF c`,[siteId,device])).rows[0];
  if(!equipment||!equipment.online||equipment.recorded_at.getTime()>Date.now()||Date.now()-equipment.recorded_at.getTime()>90000||equipment.raw_payload?.firmwareVersion!=='1.5.07-AI-ACC-SESSION'||equipment.raw_payload?.pumpReadbackValid!==true||equipment.raw_payload?.pumpWaterActualActive!==false||equipment.raw_payload?.pumpFertActualActive!==false||equipment.raw_payload?.aiAccSessionActive!==false||equipment.water_enabled||equipment.fertilizer_enabled||equipment.desired_mode!=='manual'||equipment.applied_mode!=='manual'||equipment.mode!=='manual'||equipment.acknowledgement_status!=='applied'||String(equipment.revision)!==String(equipment.acknowledged_revision))return fail('Firmware 1.5.07 wajib online, mode Manual dan revision tersinkron, output kedua pompa terbaca OFF, tidak ada sesi AI air, serta aturan sensor nonaktif.');
  const sample=(await client.query(`SELECT * FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2 AND recorded_at<=now() ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1`,[siteId,device])).rows[0];
  const sensorKeys=['liquid_ec_us_cm','tank_water_level_pct','tank_fert_level_pct','flow_water_lpm','flow_fert_lpm'];
  if(!sample||Date.now()-sample.recorded_at.getTime()>120000||sensorKeys.some(key=>!Number.isFinite(sample[key])||sample[key]<0||sample.sensor_health?.[key]?.valid!==true))return fail('Sensor EC, tandon dan debit wajib valid serta terbaru sebelum sesi dimulai.');
  if(!Number.isFinite(equipment.water_min_tank_level_pct)||!Number.isFinite(equipment.fertilizer_min_tank_level_pct)||sample.tank_water_level_pct<=equipment.water_min_tank_level_pct||sample.tank_fert_level_pct<=equipment.fertilizer_min_tank_level_pct)return fail('Batas aman tandon belum dikonfigurasi atau isi tandon tidak mencukupi.');
  const blockers=await client.query(`SELECT 1 FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND device_id=$2 AND status NOT IN ('completed','fault')
   UNION ALL SELECT 1 FROM spff.adaptive_fert_commands cmd JOIN spff.adaptive_fert_sessions sess USING(site_id,session_id) WHERE sess.site_id=$1 AND sess.device_id=$2 AND cmd.expires_at>now() AND cmd.status<>'cancelled'
   UNION ALL SELECT 1 FROM spff.actuator_schedules WHERE site_id=$1 AND device_id=$2 AND enabled AND actuator_key IN ('pump_water','pump_fert')
   UNION ALL SELECT 1 FROM spff.device_soil_ec_execution_configs WHERE site_id=$1 AND device_id=$2 AND enabled
   UNION ALL SELECT 1 FROM spff.soil_ec_pulse_sessions WHERE site_id=$1 AND device_id=$2 AND status IN ('waiting','in_flight','fault')
   UNION ALL SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND device_id=$2 AND status IN ('pending','published','accepted') LIMIT 1`,[siteId,device]);
  if(blockers.rows.length)return fail('Jadwal, AI EC tanah, command atau sesi lain masih aktif.');
  // Bind the START to the *current* device boot, not a guessed or cached ID.
  // The exact expiry travels unchanged DB -> MQTT -> Edge -> ESP32.
  // A crash/uncertain publish is never retried as a second physical START.
  const issuedAt=new Date();
  const expiresAt=new Date(issuedAt.getTime()+15000);
  const firmwareStart=adaptiveFirmware1507StartSchema.safeParse({
   ...command,
   bootId:equipment.raw_payload?.pulseBootId,
   issuedAt:issuedAt.toISOString(),
   expiresAt:expiresAt.toISOString(),
  });
  if(!firmwareStart.success)return fail('Boot ID perangkat tidak tersedia atau format START firmware v1.5.07 tidak cocok.');
  const start=firmwareStart.data;
  const args=[siteId,start.sessionId,device,input.programId,input.expectedProgramRevision,input.activityId,activityFingerprint(p.activity,p.program.config),input.requestId,JSON.stringify(input),JSON.stringify(start),JSON.stringify(p.conversion),actor];
  const row=(await client.query(`INSERT INTO spff.adaptive_fert_sessions(site_id,session_id,device_id,program_id,program_revision,activity_id,activity_fingerprint,request_id,input,command_snapshot,conversion_snapshot,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)RETURNING *`,args)).rows[0];
  await client.query(`INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)VALUES($1,$2,$3,$4,$5,$6::timestamptz)`,[siteId,start.commandId,start.sessionId,input.requestId,JSON.stringify(start),start.expiresAt]);
  if(hst)await client.query(`INSERT INTO spff.hst_real_sessions
   (site_id,obligation_id,approval_id,session_id,source_row,product,expected_remaining_g,ai_plan,actor)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
   [siteId,hst.obligationId,hst.approvalId,start.sessionId,hst.sourceRow,hst.product,
    hst.expectedRemainingG,JSON.stringify(hst.aiPlan),actor]);
  await client.query('COMMIT');return row;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function controlAdaptiveSession(id:string,operation:'pause'|'resume'|'stop',requestId:string){
 if(operation==='resume')return fail('Resume firmware 1.5.00 melewati priming; backend belum mengizinkan operasi ini.');
 const c=await pool.connect();try{await c.query('BEGIN');const s=(await c.query('SELECT * FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND session_id=$2 FOR UPDATE',[siteId,id])).rows[0];if(!s)return fail('Sesi tidak ditemukan.',404);
 if(s.command_snapshot?.kind==='server_water_control')return fail('Gunakan STOP pada sesi pompa di Panduan.');
 const old=(await c.query('SELECT * FROM spff.adaptive_fert_commands WHERE site_id=$1 AND request_id=$2',[siteId,requestId])).rows[0];if(old){if(old.session_id!==id||old.payload.commandType!==operation)return fail('requestId konflik.');await c.query('COMMIT');return old;}
 if(operation==='pause'&&s.status!=='running')return fail('Pause memerlukan telemetry sesi berjalan.');
 if(['completed','fault'].includes(s.status))return fail('Sesi sudah terminal.');
 if(operation==='stop'){await c.query("UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=$1 AND session_id=$2 AND status='pending' AND payload->>'commandType'='start'",[siteId,id]);}
 const payload={kind:'adaptive_fert_command',schemaVersion:1,siteId,deviceId:s.device_id,sessionId:id,commandId:randomUUID(),commandType:operation};
 const row=(await c.query(`INSERT INTO spff.adaptive_fert_commands(site_id,command_id,session_id,request_id,payload,expires_at)VALUES($1,$2,$3,$4,$5,now()+interval '15 seconds')RETURNING *`,[siteId,payload.commandId,id,requestId,JSON.stringify(payload)])).rows[0];if(operation==='stop')await c.query("UPDATE spff.adaptive_fert_sessions SET status='reconciliation_required',reason='stop_requested' WHERE site_id=$1 AND session_id=$2",[siteId,id]);await c.query('COMMIT');return row;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function reconcileAdaptiveSession(id:string,observation:{pumpsOffVerified:true;waterVolumeL:number;fertVolumeL:number;note:string},actor:string){
 const c=await pool.connect();try{await c.query('BEGIN');const s=(await c.query('SELECT * FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND session_id=$2 FOR UPDATE',[siteId,id])).rows[0];if(!s)return fail('Sesi tidak ditemukan.',404);
 if(s.command_snapshot?.kind==='server_water_control')return fail('Gunakan rekonsiliasi sesi air dari Panduan.');
 if(s.status!=='reconciliation_required')return fail('Sesi tidak membutuhkan rekonsiliasi.');
 if(observation.waterVolumeL<s.water_volume_l||observation.fertVolumeL<s.fert_volume_l)return fail('Total terverifikasi tidak boleh mengurangi volume yang sudah tercatat.');
 if((await c.query('SELECT 1 FROM spff.adaptive_fert_commands WHERE site_id=$1 AND session_id=$2 AND expires_at>now() LIMIT 1',[siteId,id])).rows.length)return fail('Tunggu seluruh command kedaluwarsa sebelum rekonsiliasi.');
 await c.query('INSERT INTO spff.adaptive_fert_reconciliations(reconciliation_id,site_id,session_id,observation,actor)VALUES($1,$2,$3,$4,$5)',[randomUUID(),siteId,id,JSON.stringify(observation),actor]);
 await c.query("UPDATE spff.adaptive_fert_commands SET status='cancelled' WHERE site_id=$1 AND session_id=$2 AND status='pending'",[siteId,id]);
 await c.query("UPDATE spff.adaptive_fert_sessions SET status='fault',water_volume_l=$3,fert_volume_l=$4,reason='operator_reconciled' WHERE site_id=$1 AND session_id=$2",[siteId,id,observation.waterVolumeL,observation.fertVolumeL]);await c.query('COMMIT');return {reconciled:true};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function readAdaptiveSession(id:string){
 const s=(await pool.query('SELECT * FROM spff.adaptive_fert_sessions WHERE site_id=$1 AND session_id=$2',[siteId,id])).rows[0];if(!s)return fail('Sesi tidak ditemukan.',404);
 const commands=(await pool.query('SELECT * FROM spff.adaptive_fert_commands WHERE site_id=$1 AND session_id=$2 ORDER BY created_at',[siteId,id])).rows;
 const events=(await pool.query("SELECT * FROM spff.adaptive_fert_events WHERE site_id=$1 AND device_id=$2 AND payload->>'sessionId'=$3 ORDER BY stored_at DESC LIMIT 100",[siteId,s.device_id,id])).rows;
 return {session:s,commands,events,resumeSupported:false,dispatchEnabled:process.env.SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED==='true'};
}
