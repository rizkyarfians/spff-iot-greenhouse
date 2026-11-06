import {useEffect,useRef,useState} from 'react';
import type {AiHstProposal,GuideProgram} from '@spff/contracts';
import {
 executeAiHstVolumeApproval,executeAiHstVolumePlan,fetchAiHstVolumeSessions,fetchGuidePrograms,stopAiHstVolumeSession,
 type AiHstVolumePlan,type AiHstVolumeSession,
} from './api';

const formatter=new Intl.NumberFormat('id-ID',{maximumFractionDigits:3});
const amount=(value:number|null,unit:string)=>value===null?'Belum tersedia':formatter.format(value)+' '+unit;
const errorText=(error:unknown,fallback:string)=>error instanceof Error?error.message:fallback;
const terminal=(session:AiHstVolumeSession)=>['completed','fault'].includes(session.status);
const blockers:Record<string,string>={
 commissioned_dose_volume_firmware_required:'Firmware dosis/volume dan commissioning perangkat belum terkonfirmasi.',
 sensor_boot_not_current:'Menunggu pembacaan sensor dari boot perangkat saat ini.',
 water_level_not_safe_to_start:'Pembacaan air atau pengaman level belum siap.',
 server_water_runtime_required:'Isi Batas waktu menyala di pengaturan pompa air dan pertahankan mode Manual.',
 hst_pulse_flow_bound_or_dose_required:'Batas debit terverifikasi belum diisi atau sisa dosis terlalu kecil untuk satu pulsa.',
 hst_pulse_device_not_ready:'Pulsa pupuk dan proteksi tandon belum dikonfirmasi perangkat.',
 water_first_dispatch_pending:'Pratinjau saja. Eksekusi air dulu menunggu dukungan firmware dan kontrol sesi.',
 dose_volume_server_dispatch_disabled:'Izin START dosis/volume di server masih OFF.',
 target_exceeds_commissioned_session_limits:'Target liter melampaui batas sesi perangkat.',
};
const states:Record<string,string>={
 queued:'Menunggu perangkat',running:'Sesi berjalan',paused:'Sesi dijeda',
 reconciliation_required:'Status akhir perlu diperiksa',completed:'Selesai',fault:'Berhenti / gangguan',
};

function requestId(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&15)|64;
 bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
}

type PlanSelection={proposal:AiHstProposal}|{programId:string;activityId:string};

export function HstDoseVolumeCard(selection:PlanSelection){
 const proposal='proposal' in selection?selection.proposal:null;
 const mode=proposal?'fertigation':'water_only';
 const [plan,setPlan]=useState<AiHstVolumePlan|null>(null);
 const [expired,setExpired]=useState(false);
 const [confirmed,setConfirmed]=useState(false);
 const [route,setRoute]=useState(false);
 const [overdue,setOverdue]=useState(false);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const approval=useRef<string|null>(null);
 const busy=useRef(false);
 const cannotFertigate=!!proposal&&(proposal.status==='COMPLETED'||proposal.status==='REQUIRES_REVIEW'||
  proposal.remaining_g===null||proposal.remaining_g<=0);
 useEffect(()=>{
  if(!plan)return;
  const timer=setTimeout(()=>setExpired(true),Math.max(0,Date.parse(plan.validUntil)-Date.now()));
  return()=>clearTimeout(timer);
 },[plan]);
 function clearPlan(){
  setPlan(null);setConfirmed(false);setRoute(false);setOverdue(false);setExpired(false);
  approval.current=null;
 }
 async function prepare(){
  if(busy.current||(mode==='fertigation'&&cannotFertigate))return;
  busy.current=true;setPending(true);setError('');setNotice('');clearPlan();
  try{
   const id=requestId();
   setPlan(await executeAiHstVolumePlan('proposal' in selection
    ?{mode:'fertigation',execution:'water_first',requestId:id,obligationId:selection.proposal.obligation_id}
    :{mode:'water_only',requestId:id,programId:selection.programId,activityId:selection.activityId}));
  }catch(cause){setError(errorText(cause,'Rencana pompa belum tersedia.'))}
  finally{busy.current=false;setPending(false);}
 }
 const allowed=!!plan?.executionReady&&plan.calculationReady&&confirmed&&!expired&&
  (!plan.recipe.routeApprovalRequired||route)&&(!plan.recipe.pastDue||overdue);
 async function start(){
  if(busy.current||!plan||!allowed||Date.parse(plan.validUntil)<=Date.now())return;
  busy.current=true;setPending(true);setError('');
  try{
   approval.current??=requestId();
   await executeAiHstVolumeApproval({planId:plan.planId,approvalId:approval.current,
    preparedBatchConfirmed:true,confirmApplicationRoute:route,confirmPastDue:overdue});
   clearPlan();
   setNotice('START masuk antrean. Lihat status dan tombol STOP di Sesi pompa.');
  }catch(cause){
   setError(errorText(cause,'ACC belum terkonfirmasi. Periksa Sesi pompa sebelum mencoba kembali.'));
  }finally{busy.current=false;setPending(false);}
 }
 const recipe=plan?.recipe.recipe;
 return <div className="hst-real-control">
  <strong>{mode==='fertigation'?'Eksekusi air + pupuk':'Eksekusi air saja'}</strong>
  <button type="button" className="hst-refresh" disabled={pending||(mode==='fertigation'&&cannotFertigate)}
   onClick={()=>void prepare()}>{plan?'Hitung ulang rencana':'Hitung rencana pompa'}</button>
  {plan&&recipe&&<section className="hst-guide-summary" aria-label="Rencana volume pompa">
   <span>Perkiraan isi tandon air: <b>{amount(recipe.waterInventoryL,'L')}</b></span>
   {plan.recipe.waterFirst
    ?<small>Urutan rencana: pompa air ON, konfirmasi aliran air, lalu pompa pupuk ON.</small>
    :plan.recipe.hstPulse
    ?<small>Satu pulsa air + pupuk hingga {formatter.format(plan.recipe.hstPulse.onDurationMs/1000)} detik. Dosis dicatat setelah pompa OFF dan totalizer stabil.</small>
    :plan.recipe.serverWater
    ?<small>Server mengirim ON/OFF berdasarkan level tandon. Awasi pompa selama sesi berjalan.</small>
    :plan.recipe.waterUntilLowSeconds
    ?<small>Pompa air berjalan sampai pengaman level minimum. Meter mencatat liter yang keluar.</small>
    :recipe.targetWaterL===null
    ?<small>Target pompa menunggu batas perangkat terverifikasi.</small>
    :<span>Target sesi: air {amount(recipe.targetWaterL,'L')}{mode==='fertigation'&&' · stok '+amount(recipe.targetStockL,'L')}</span>}
   {mode==='fertigation'&&<>
    <span>Batch {plan.recipe.product} · {amount(recipe.batchMassG/1000,'kg')} dalam {amount(recipe.batchVolumeL,'L')}</span>
    {recipe.plannedMassG!==null&&<small>Dosis sesi {amount(recipe.plannedMassG/1000,'kg')} · Sisa perkiraan {amount(recipe.remainingAfterSessionG===null?null:recipe.remainingAfterSessionG/1000,'kg')}</small>}
   </>}
   {plan.recipe.blockers.map(blocker=><small key={blocker}>{blockers[blocker]??blocker}</small>)}
   {expired&&<small>Rencana kedaluwarsa. Hitung ulang sebelum ACC.</small>}
   {plan.executionReady&&!expired&&<>
    <label className="hst-confirm">
     <input type="checkbox" disabled={pending} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
     {mode==='fertigation'?'Batch sesuai resep sudah siap dan jalur pompa sudah diperiksa.':'Jalur air siap untuk volume yang tertera.'}
    </label>
    {plan.recipe.routeApprovalRequired&&<label className="hst-confirm">
     <input type="checkbox" disabled={pending} checked={route} onChange={event=>setRoute(event.target.checked)}/>
     Saya sudah memverifikasi bahwa produk ini bisa digunakan pada jalur pompa, meski metode Panduan adalah {plan.recipe.sourceMethod}.
    </label>}
    {plan.recipe.pastDue&&<label className="hst-confirm">
     <input type="checkbox" disabled={pending} checked={overdue} onChange={event=>setOverdue(event.target.checked)}/>
     Saya sudah meninjau kegiatan yang lewat jadwal ini.
    </label>}
   </>}
   <button type="button" className="hst-approve" disabled={pending||!allowed} onClick={()=>void start()}>
    ACC & Mulai Pompa
   </button>
  </section>}
  {error&&<small role="alert" className="ain-acc-error">{error}</small>}
  {notice&&<small role="status">{notice}</small>}
 </div>;
}

export function HstFuzzyVolumeControl(){
 const [programs,setPrograms]=useState<GuideProgram[]>([]);
 const [programId,setProgramId]=useState('');
 const [activityId,setActivityId]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  void fetchGuidePrograms()
   .then(rows=>{if(active)setPrograms(rows.filter(row=>!!row.config.deviceId))})
   .catch(cause=>{if(active)setError(errorText(cause,'Program Panduan belum tersedia.'))});
  return()=>{active=false};
 },[]);
 const program=programs.find(row=>row.programId===programId);
 const activity=program?.plan.activities.find(row=>row.id===activityId);
 return <section className="hst-real-control" aria-label="ACC Fuzzy Tanah 2">
  <strong>ACC Fuzzy Tanah 2</strong>
  <small>Penyiraman air baku. ACC tersedia saat Fuzzy menyatakan perlu menyiram. Gunakan mode Manual.</small>
  {error&&<small role="alert">{error}</small>}
  <label>Program{' '}
   <select value={programId} onChange={event=>{setProgramId(event.target.value);setActivityId('')}}>
    <option value="">Pilih program</option>
    {programs.map(row=><option value={row.programId} key={row.programId}>{row.plan.cropName} · {row.config.deviceId} · {row.config.plantingDate}</option>)}
   </select>
  </label>
  {program&&<label>Kegiatan Panduan{' '}
   <select value={activityId} onChange={event=>setActivityId(event.target.value)}>
    <option value="">Pilih kegiatan</option>
    {program.plan.activities.map(activity=><option value={activity.id} key={activity.id}>{activity.title} · HST {activity.hst??'—'}</option>)}
   </select>
  </label>}
  {program&&activity&&<HstDoseVolumeCard key={programId+':'+activity.id} programId={programId} activityId={activity.id}/>}
 </section>;
}

export function HstDoseVolumeSessions({refreshProposals}:{refreshProposals:()=>Promise<void>}){
 const [sessions,setSessions]=useState<AiHstVolumeSession[]>([]);
 const [pollError,setPollError]=useState('');
 const [stopError,setStopError]=useState('');
 const [stopping,setStopping]=useState<string|null>(null);
 const [stopNotice,setStopNotice]=useState('');
 const busy=useRef(false);
 const credited=useRef<string|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  let pending=false;
  async function refresh(){
   if(pending)return;
   pending=true;
   try{
    const rows=await fetchAiHstVolumeSessions(controller.signal);
    if(controller.signal.aborted)return;
    setSessions(rows);setPollError('');
    const evidence=rows.filter(row=>row.evidence_verified&&row.credited_g>0)
     .map(row=>row.session_id+':'+row.credited_g).sort().join(',');
    if(credited.current!==null&&credited.current!==evidence)void refreshProposals();
    credited.current=evidence;
   }catch(cause){
    if(!controller.signal.aborted)setPollError(errorText(cause,'Status sesi belum tersedia.'));
   }finally{pending=false;}
  }
  void refresh();
  const timer=setInterval(()=>void refresh(),3000);
  return()=>{controller.abort();clearInterval(timer);};
 },[refreshProposals]);
 async function stop(session:AiHstVolumeSession){
  if(busy.current||terminal(session))return;
  busy.current=true;setStopping(session.session_id);setStopError('');setStopNotice('');
  try{
   await stopAiHstVolumeSession(session.session_id,requestId());
   setStopNotice('STOP masuk antrean. Tunggu konfirmasi perangkat.');
  }catch(cause){setStopError(errorText(cause,'STOP belum terkonfirmasi. Periksa perangkat.'))}
  finally{busy.current=false;setStopping(null);}
 }
 if(!sessions.length&&!pollError)return null;
 return <section className="hst-real-control" aria-label="Sesi pompa">
  <strong>Sesi pompa · dosis/volume</strong>
  {pollError&&<small role="alert">{pollError}</small>}
  {sessions.map(session=><div className="hst-guide-summary" key={session.session_id}>
   <strong>{session.product??'Air saja'} · {states[session.status]??session.status}</strong>
   <span>{session.device_id} · Air {amount(session.water_volume_l,'L')} · Stok {amount(session.fert_volume_l,'L')}</span>
   {session.evidence_basis==='DEVICE_TERMINAL_MEASURED'&&session.evidence_verified&&
    <small>Perangkat mengonfirmasi kedua pompa OFF.</small>}
   {session.reason&&<small>{session.reason.replaceAll('_',' ')}</small>}
   {!terminal(session)&&<button type="button" className="hst-refresh" disabled={stopping!==null}
    onClick={()=>void stop(session)}>{stopping===session.session_id?'Mengirim STOP…':'STOP Pompa'}</button>}
  </div>)}
  {stopError&&<small role="alert">{stopError}</small>}
  {stopNotice&&<small role="status">{stopNotice}</small>}
 </section>;
}
