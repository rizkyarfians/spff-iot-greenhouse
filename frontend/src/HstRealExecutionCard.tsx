import {useEffect,useRef,useState} from 'react';
import {aiHstHardwareProfileSchema} from '@spff/contracts';
import type {AiHstHardwareProfile,AiHstProposal,AiHstRealPreflight,AiHstRealSessionSummary} from '@spff/contracts';
import {useAuth} from './authContext';
import {executeAiHstReal,fetchAiHstRealSession,fetchAiHstRealLatest,saveAiHstRealProfile,stopAiHstRealSession} from './api';

type Props={proposal:AiHstProposal;shadowEnabled:boolean;preflight:AiHstRealPreflight|null;
 preflightError:string|null;refreshPreflight:()=>void};
const unavailable=import.meta.env.DEV&&import.meta.env.VITE_SPFF_AI_PREVIEW==='true';
const number=new Intl.NumberFormat('id-ID',{maximumFractionDigits:3});
const kg=(grams:number|null)=>grams!==null&&Number.isFinite(grams)?number.format(grams/1000)+' kg':'Perlu verifikasi';
const readinessMessages:Record<string,string>={
 obligation_completed:'Kebutuhan pupuk ini sudah selesai.',
 hst_source_requires_review:'Perubahan data Panduan perlu diperiksa kembali.',
 unverified_remaining_fertilizer_mass:'Sisa kebutuhan pupuk belum terverifikasi.',
 guide_program_missing_or_invalid:'Program Panduan belum tersedia.',
 hst_proposal_source_identity_mismatch:'Usulan belum sesuai dengan versi Panduan terbaru.',
 one_verified_fertilizer_product_per_session_required:'Pisahkan dan verifikasi satu produk pupuk untuk setiap sesi.',
 fertilizer_application_route_not_verified_for_adaptive_session:'Metode pada Panduan belum disetujui untuk jalur pompa ini.',
 hst_schedule_is_not_due_today:'Jadwal kegiatan ini bukan untuk hari ini; perlu peninjauan sebelum dijalankan.',
 guide_ec_recipe_not_validated:'Data campuran pada Panduan belum lengkap.',
 measured_guide_ec_conversion_profile_required:'Pengukuran EC untuk campuran Panduan belum tersimpan.',
 guide_ec_profile_unavailable:'Profil EC campuran belum bisa dibaca.',
 program_device_unbound:'Program Panduan belum dipasangkan dengan perangkat.',
 device_offline_or_stale:'Perangkat belum terhubung dengan data terbaru.',
 firmware_1507_and_fresh_boot_id_required:'Versi dan identitas perangkat belum terkonfirmasi.',
 pumps_not_confirmed_idle_by_device:'Perangkat belum mengonfirmasi kedua pompa berhenti.',
 manual_session_control_not_acknowledged:'Perangkat belum mengonfirmasi mode sesi MANUAL.',
 hst_shadow_mode_enabled:'SHADOW masih aktif; ACC hanya memeriksa hitungan.',
 verified_hydraulics_and_single_stock_profile_missing:'Data stok dan instalasi belum dikonfirmasi untuk kegiatan ini.',
 configured_stock_product_mismatch:'Produk stok tersimpan berbeda dari produk pada Panduan.',
 configured_program_revision_stale:'Panduan berubah; periksa ulang profil instalasi tersimpan.',
 configured_ec_profile_revision_stale:'Profil EC berubah; periksa ulang profil instalasi tersimpan.',
 configured_device_mismatch:'Profil tersimpan menggunakan perangkat lain.',
 real_execution_server_flag_disabled:'Izin menjalankan pompa dari AI belum diaktifkan di server.',
};

function uuid():string{
 // crypto.randomUUID() is unavailable on non-HTTPS LAN origins. The browser's
 // getRandomValues() remains available and is already used by SHADOW ACC.
 if(!globalThis.crypto?.getRandomValues)throw new Error('WebCrypto tidak tersedia untuk ACC.');
 const bytes=new Uint8Array(16);
 globalThis.crypto.getRandomValues(bytes);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function displayTime(value:string|null):string{
 if(!value)return 'Belum ada telemetry sesi';
 return new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
}
export function HstRealExecutionCard({proposal,shadowEnabled,preflight,preflightError,refreshPreflight}:Props){
 const {user}=useAuth();
 const setup=preflight?.setup;
 const sourceProfile=setup?.profile??setup?.suggestedProfile??null;
 const canSetup=!!setup?.deviceId&&!!setup.ecProfileRevision&&setup.guide?.targetEcUsCm!==null
  &&proposal.source_row!==null&&!!proposal.product;
 const [editing,setEditing]=useState(false);
 const [profileConfirmed,setProfileConfirmed]=useState(false);
 const [stock,setStock]=useState('');
 const [meter,setMeter]=useState<''|'before_injector'|'after_injector'>('');
 const [hydraulics,setHydraulics]=useState('');
 const [tolerance,setTolerance]=useState('100');
 const [maxSeconds,setMaxSeconds]=useState('600');
 const [flushSeconds,setFlushSeconds]=useState('30');
 const [confirmed,setConfirmed]=useState(false);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [session,setSession]=useState<AiHstRealSessionSummary|null>(null);
 const approvalRef=useRef<string|null>(null);
 const stopRef=useRef<string|null>(null);
 const lock=useRef(false);
 useEffect(()=>{
  let live=true;
  setSession(null);setConfirmed(false);setProfileConfirmed(false);setEditing(false);
  approvalRef.current=null;stopRef.current=null;
  void fetchAiHstRealLatest(proposal.obligation_id)
   .then(latest=>{if(live&&latest){setSession(latest);approvalRef.current=latest.approvalId}})
   .catch(e=>{if(live)setError(e instanceof Error?e.message:'Histori sesi HST tidak tersedia.')});
  return()=>{live=false};
 },[proposal.obligation_id]);
 useEffect(()=>{
  if(editing)return;
  const p=sourceProfile;
  setProfileConfirmed(false);
  setStock(p?String(p.stockConcentrationGPerL):'');
  setMeter(p?.waterMeterPosition??'');
  setHydraulics(p?.hydraulicsReference??'');
  setTolerance(String(p?.ecToleranceUs??100));
  setMaxSeconds(String(p?.maxDurationSec??600));
  setFlushSeconds(String(p?.flushDurationSec??30));
 },[sourceProfile,editing]);
 useEffect(()=>{setConfirmed(false);setProfileConfirmed(false);},
  [proposal.obligation_id,setup?.programRevision,setup?.ecProfileRevision]);
 useEffect(()=>{
  if(!session?.sessionId)return;
  const controller=new AbortController();
  const refresh=()=>{
   void fetchAiHstRealSession(session.sessionId)
    .then(result=>{if(!controller.signal.aborted)setSession(result)})
    .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Status sesi gagal diperbarui.')});
  };
  refresh();
  const interval=setInterval(refresh,4000);
  return()=>{controller.abort();clearInterval(interval)};
 },[session?.sessionId]);
 const draft=aiHstHardwareProfileSchema.safeParse({
  programId:proposal.program_id,activityId:proposal.activity_id,sourceRow:proposal.source_row,
  deviceId:setup?.deviceId??'',product:proposal.product??'',programRevision:setup?.programRevision??0,
  ecProfileRevision:setup?.ecProfileRevision??0,stockConcentrationGPerL:Number(stock),
  waterMeterPosition:meter,hydraulicsReference:hydraulics.trim(),ecToleranceUs:Number(tolerance),
  maxDurationSec:Number(maxSeconds),flushDurationSec:Number(flushSeconds),
 });
 async function save(){
  if(!setup?.deviceId||!setup.ecProfileRevision||proposal.source_row===null||!profileConfirmed||lock.current)return;
  if(!draft.success){setError('Lengkapi data stok, posisi meter, dan catatan kalibrasi yang sesuai instalasi.');return;}
  lock.current=true;setPending(true);setError('');setNotice('');
  try{
   const candidate:AiHstHardwareProfile=draft.data;
   await saveAiHstRealProfile(candidate);
   setEditing(false);setProfileConfirmed(false);setNotice('Data instalasi tersimpan dan akan dipakai otomatis untuk kegiatan ini.');
   refreshPreflight();
  }catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan profil.')}
  finally{setPending(false);lock.current=false;}
 }
 async function run(){
  if(shadowEnabled||lock.current||!confirmed||!preflight?.canDispatch||proposal.remaining_g===null||
     proposal.remaining_g<=0||unavailable||session)return;
  lock.current=true;setPending(true);setError('');setNotice('');
  try{
   approvalRef.current??=uuid();
   const created=await executeAiHstReal({
    obligationId:proposal.obligation_id,approvalId:approvalRef.current,
    expectedRemainingG:proposal.remaining_g,
    confirmation:'EXECUTE_HST_REAL_ADAPTIVE_SESSION',
   });
   setSession(created);
   setConfirmed(false);
   setNotice('Perintah tersimpan, menunggu ACK firmware. Status pompa belum dinyatakan berubah.');
  }catch(e){setError(e instanceof Error?e.message:'ACC real gagal. Perintah mungkin belum terkirim; cek sesi sebelum retry.')}
  finally{setPending(false);lock.current=false;}
 }
 async function stop(){
  if(!session||session.obligationId!==proposal.obligation_id||lock.current)return;
  lock.current=true;setPending(true);setError('');
  try{
   stopRef.current??=uuid();
   await stopAiHstRealSession(session.sessionId,stopRef.current);
   setNotice('STOP sudah diminta. Tunggu konfirmasi ESP32 bahwa kedua pompa OFF.');
   setSession(await fetchAiHstRealSession(session.sessionId));
  }catch(e){setError(e instanceof Error?e.message:'STOP gagal. Gunakan penghentian lokal perangkat bila diperlukan.')}
  finally{setPending(false);lock.current=false;}
 }
 const status=session?.status??'';
 const terminal=status==='completed'||status==='fault';
 // Keep an existing physical session and its STOP control visible even after
 // SHADOW is re-enabled. Flipping SHADOW never implicitly stops a live pump.
 if(shadowEnabled&&!session)return null;
 return <div className="hst-real-control">
  <div className="hst-real-control-header">
   <strong>{shadowEnabled?'Sesi pompa yang sudah dibuat':'Eksekusi fertigasi AI HST'}</strong>
   <span>{shadowEnabled?'SHADOW ON · Sesi fisik tetap dipantau'
     :preflight?.canDispatch?'Perangkat siap':'Menunggu kesiapan perangkat'}</span>
  </div>
  {!shadowEnabled&&preflightError&&<p role="alert">{preflightError}</p>}
  {!shadowEnabled&&!preflight&&!preflightError&&<p>Memeriksa kesiapan perangkat…</p>}
  {!shadowEnabled&&<section className="hst-guide-summary" aria-label="Data otomatis dari Panduan">
   <strong>Dari Panduan · otomatis</strong>
   <span>{proposal.product??'Produk belum tersedia'} · HST {proposal.hst??'—'}</span>
   <div><span>Target <b>{kg(proposal.target_g)}</b></span><span>Sisa kebutuhan <b>{kg(proposal.remaining_g)}</b></span></div>
   {setup?.guide&&<small>Metode: {setup.guide.method} · Air pelarut referensi: {setup.guide.waterL===null?'Belum tersedia':number.format(setup.guide.waterL)+' L'}</small>}
   <small>Target EC: {setup?.guide?.targetEcUsCm==null?'Menunggu profil pengukuran campuran':number.format(setup.guide.targetEcUsCm)+' µS/cm'}</small>
  </section>}
  {!shadowEnabled&&sourceProfile&&<section className="hst-installation-summary">
   <strong>{setup?.profile?'Profil instalasi tersimpan':'Profil tersimpan untuk produk ini'}</strong>
   <span>Stok {number.format(sourceProfile.stockConcentrationGPerL)} g/L · meter {sourceProfile.waterMeterPosition==='before_injector'?'sebelum':'sesudah'} injektor</span>
   <small>{sourceProfile.hydraulicsReference}</small>
   {!setup?.profile&&<small>Periksa apakah campuran stok dan instalasinya masih sama sebelum memakai profil ini.</small>}
  </section>}
  {!shadowEnabled&&preflight?.reasons.length? <details className="hst-readiness-details">
   <summary>Masih perlu disiapkan ({preflight.reasons.length})</summary>
   <ul>{preflight.reasons.map(reason=><li key={reason}>{readinessMessages[reason]??'Pemeriksaan perangkat tambahan belum lolos.'}</li>)}</ul>
  </details>:null}
  {!shadowEnabled&&user.role==='admin' && !session&&<>
   {!canSetup&&setup&&<p className="hst-setup-missing" role="status">{!setup.deviceId
    ?'Pasangkan perangkat pada program Panduan terlebih dahulu.'
    :!setup.ecProfileRevision?'Lengkapi pengukuran EC campuran di Panduan terlebih dahulu. Data dosis sudah terisi otomatis.'
    :setup.guide?.targetEcUsCm===null?setup.guide.ecReason??'Periksa pengukuran campuran dan EC air baku di Panduan terlebih dahulu.'
    :'Kegiatan ini belum memiliki satu produk pupuk yang dapat diikat ke sesi.'}</p>}
   {canSetup&&<button type="button" className="hst-refresh" onClick={()=>setEditing(v=>!v)}>
    {editing?'Tutup data instalasi':sourceProfile?'Periksa / ubah instalasi':'Lengkapi data instalasi sekali'}
   </button>}
   {canSetup&&!setup?.profile&&sourceProfile&&!editing&&<>
    <label className="hst-confirm"><input type="checkbox" checked={profileConfirmed} onChange={e=>setProfileConfirmed(e.target.checked)}/>
     Campuran stok dan instalasi masih sama dengan profil tersimpan.</label>
    <button type="button" className="hst-approve" disabled={pending||!profileConfirmed||!draft.success}
     onClick={()=>{void save()}}>Gunakan profil tersimpan</button>
   </>}
   {editing&&<div className="hst-real-form" onChange={event=>{
    if((event.target as HTMLInputElement).type!=='checkbox')setProfileConfirmed(false);
   }}>
    <p className="hst-setup-hint">Data fisik instalasi cukup disimpan sekali. Dosis dan jadwal tetap diambil dari Panduan.</p>
    <label>Konsentrasi larutan stok yang disiapkan (g/L)
     <input type="number" min="0.01" max="1000" step="any" value={stock} onChange={e=>setStock(e.target.value)}/></label>
    <label>Posisi flow meter air
     <select value={meter} onChange={e=>setMeter(e.target.value as ''|'before_injector'|'after_injector')}>
      <option value="" disabled>Pilih sesuai pemasangan</option>
      <option value="before_injector">Sebelum injektor</option>
      <option value="after_injector">Sesudah injektor</option>
     </select></label>
    <label>Catatan pengukuran aliran instalasi
     <input type="text" value={hydraulics} onChange={e=>setHydraulics(e.target.value)}
      placeholder="Contoh: hasil ukur volume dan waktu pengujian"/></label>
    <details className="hst-session-settings"><summary>Batas sesi dan pembilasan</summary>
    <label>Toleransi EC (µS/cm)
     <input type="number" min="20" max="500" value={tolerance} onChange={e=>setTolerance(e.target.value)}/></label>
    <label>Batas durasi (detik)
     <input type="number" min="60" max="7200" value={maxSeconds} onChange={e=>setMaxSeconds(e.target.value)}/></label>
    <label>Flushing (detik)
     <input type="number" min="10" max="600" value={flushSeconds} onChange={e=>setFlushSeconds(e.target.value)}/></label>
    </details>
    <label className="hst-confirm hst-setup-confirm"><input type="checkbox" checked={profileConfirmed} onChange={e=>setProfileConfirmed(e.target.checked)}/>
     Data stok, pemasangan, dan batas sesi sesuai kondisi yang sudah saya periksa.</label>
    <button className="hst-approve" disabled={pending||!canSetup||!draft.success||!profileConfirmed}
     onClick={()=>{void save()}} type="button">{pending?'Menyimpan…':'Simpan data instalasi'}</button>
   </div>}
  </>}
  {!shadowEnabled&&!session&&<label className="hst-confirm">
   <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}
    disabled={!preflight?.canDispatch||pending||unavailable}/>
   Saya menyetujui pelaksanaan hasil kalkulasi AI HST pada pompa air dan pupuk fisik,
   serta telah memeriksa stok, jalur, dan keamanan perangkat.
  </label>}
  {!shadowEnabled&&!session&&<button className="hst-approve" type="button"
   disabled={!confirmed||!preflight?.canDispatch||pending||unavailable}
   onClick={()=>{void run()}}>
   {pending?'Memproses ACC…':'ACC & Jalankan Sesi Pompa Real'}
  </button>}
  {session&&<div className="hst-real-session" role="status" aria-live="polite">
   <p><strong>Status sesi: {session.status.replaceAll('_',' ')}</strong></p>
   <small>ID sesi: {session.sessionId}</small>
   <p>Volume air: {session.waterVolumeL.toFixed(2)} / {session.commandedWaterL.toFixed(2)} L</p>
   <p>Volume pupuk: {session.fertVolumeL.toFixed(2)} / {session.commandedFertL.toFixed(2)} L</p>
   <p>Estimasi massa berdasarkan meter dan konsentrasi: {session.estimatedMassG.toFixed(1)} g</p>
   <small>Telemetry terakhir: {displayTime(session.lastTelemetryAt)}</small>
   {session.reason&&<p>Alasan: {session.reason}</p>}
   {!terminal&&<button className="hst-approve hst-stop" disabled={pending}
     onClick={()=>{void stop()}} type="button">{pending?'Mengirim STOP…':'STOP Sesi Pompa'}</button>}
  </div>}
  {notice&&<p role="status" className="hst-success">{notice}</p>}
  {error&&<p role="alert" className="hst-review">{error}</p>}
 </div>;
}
