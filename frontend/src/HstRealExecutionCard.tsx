import {useEffect,useRef,useState} from 'react';
import type {AiHstHardwareProfile,AiHstProposal,AiHstRealPreflight,AiHstRealSessionSummary} from '@spff/contracts';
import {useAuth} from './authContext';
import {executeAiHstReal,fetchAiHstRealSession,fetchAiHstRealLatest,saveAiHstRealProfile,stopAiHstRealSession} from './api';

type Props={proposal:AiHstProposal;shadowEnabled:boolean;preflight:AiHstRealPreflight|null;
 preflightError:string|null;refreshPreflight:()=>void};
const unavailable=import.meta.env.DEV&&import.meta.env.VITE_SPFF_AI_PREVIEW==='true';

function uuid():string{
 if(!globalThis.crypto?.randomUUID)throw new Error('Browser tidak mendukung identitas ACC aman.');
 return globalThis.crypto.randomUUID();
}
function displayTime(value:string|null):string{
 if(!value)return 'Belum ada telemetry sesi';
 return new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
}
export function HstRealExecutionCard({proposal,shadowEnabled,preflight,preflightError,refreshPreflight}:Props){
 const {user}=useAuth();
 const setup=preflight?.setup;
 const [editing,setEditing]=useState(false);
 const [stock,setStock]=useState('');
 const [meter,setMeter]=useState<'before_injector'|'after_injector'>('before_injector');
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
  void fetchAiHstRealLatest(proposal.obligation_id)
   .then(latest=>{if(live&&latest){setSession(latest);approvalRef.current=latest.approvalId}})
   .catch(e=>{if(live)setError(e instanceof Error?e.message:'Histori sesi HST tidak tersedia.')});
  return()=>{live=false};
 },[proposal.obligation_id]);
 useEffect(()=>{
  if(editing)return;
  const p=setup?.profile;
  setStock(p?String(p.stockConcentrationGPerL):'');
  setMeter(p?.waterMeterPosition??'before_injector');
  setHydraulics(p?.hydraulicsReference??'');
  setTolerance(String(p?.ecToleranceUs??100));
  setMaxSeconds(String(p?.maxDurationSec??600));
  setFlushSeconds(String(p?.flushDurationSec??30));
 },[setup?.profile,editing]);
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
 async function save(){
  if(!setup?.deviceId||!setup.ecProfileRevision||!proposal.source_row||lock.current)return;
  lock.current=true;setPending(true);setError('');setNotice('');
  try{
   const candidate:AiHstHardwareProfile={
    programId:proposal.program_id,activityId:proposal.activity_id,sourceRow:proposal.source_row,
    deviceId:setup.deviceId,product:proposal.product??'',programRevision:setup.programRevision,
    ecProfileRevision:setup.ecProfileRevision,stockConcentrationGPerL:Number(stock),
    waterMeterPosition:meter,hydraulicsReference:hydraulics.trim(),ecToleranceUs:Number(tolerance),
    maxDurationSec:Number(maxSeconds),flushDurationSec:Number(flushSeconds),
   };
   await saveAiHstRealProfile(candidate);
   setEditing(false);setNotice('Profil stok dan instalasi tersimpan. Periksa kembali sebelum ACC.');
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
  if(!session||lock.current)return;
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
  {!shadowEnabled&&preflight?.reasons.length? <p className="hst-real-blockers">
   {preflight.reasons.map(reason=><small key={reason}>• {reason.replaceAll('_',' ')}</small>)}
  </p>:null}
  {!shadowEnabled&&setup?.profile&&<p className="hst-real-stock">
   Stok terverifikasi: <strong>{setup.profile.stockConcentrationGPerL} g/L</strong> ·
   {setup.profile.product} · flow meter {setup.profile.waterMeterPosition==='before_injector'?'sebelum':'sesudah'} injektor
  </p>}
  {!shadowEnabled&&user.role==='admin' && !session&&<>
   <button type="button" className="hst-refresh" onClick={()=>setEditing(v=>!v)}>
    {editing?'Tutup konfigurasi':'Konfigurasi stok dan hidrolik'}
   </button>
   {editing&&<div className="hst-real-form">
    <label>Konsentrasi stok aktual (g/L)
     <input type="number" min="0.01" max="1000" step="any" value={stock} onChange={e=>setStock(e.target.value)}/></label>
    <label>Posisi flow meter air
     <select value={meter} onChange={e=>setMeter(e.target.value as 'before_injector'|'after_injector')}>
      <option value="before_injector">Sebelum injektor</option>
      <option value="after_injector">Sesudah injektor</option>
     </select></label>
    <label>Referensi kalibrasi hidrolik
     <input type="text" value={hydraulics} onChange={e=>setHydraulics(e.target.value)}
      placeholder="Catatan uji dan kalibrasi flow meter"/></label>
    <label>Toleransi EC (µS/cm)
     <input type="number" min="20" max="500" value={tolerance} onChange={e=>setTolerance(e.target.value)}/></label>
    <label>Batas durasi (detik)
     <input type="number" min="60" max="7200" value={maxSeconds} onChange={e=>setMaxSeconds(e.target.value)}/></label>
    <label>Flushing (detik)
     <input type="number" min="10" max="600" value={flushSeconds} onChange={e=>setFlushSeconds(e.target.value)}/></label>
    <button className="hst-approve" disabled={pending||!setup?.deviceId||!setup.ecProfileRevision||!proposal.source_row}
     onClick={()=>{void save()}} type="button">{pending?'Menyimpan…':'Simpan profil terverifikasi'}</button>
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
