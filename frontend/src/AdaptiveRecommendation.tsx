import {useEffect,useState} from 'react'
import type {FertigationProgress,GuideEcConversion,GuideProgram} from '@spff/contracts'
import {fetchGuidePrograms,fetchGuideEcConversions,fetchAdaptiveProgress,type AdaptiveProgressReport} from './api'
import {automaticGuideActivities,supportsFertigationAutomation} from './fertigationSupport'
import {GuideEcTarget} from './GuideEcTarget'
import {AutomationMethod} from './AutomationMethod'
import './AdaptiveRecommendation.css'
const fmt=(v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(v)
function RecommendationBar({value,target,label,missing}:{value:number|null|undefined;target:number|null|undefined;label:string;missing:string}){
 const valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&typeof target==='number'&&Number.isFinite(target)&&target>0
 const percent=valid?value/target*100:null
 return <div className="ar-meter">
  <div className="ar-meter-caption"><span>{label}</span><strong>{percent===null?'—':`${fmt(percent)}%`}</strong></div>
  {valid?<progress aria-label={label} max={target} value={Math.min(target,value)} aria-valuetext={`${fmt(value)} dari ${fmt(target)}; ${fmt(percent)} persen`}/>:<div className="ar-meter-empty" aria-label={missing}/>}
  {percent===null&&<small>{missing}</small>}
 </div>
}
export function AdaptiveRecommendation({deviceId,report,onOpen}:{deviceId:string;report:FertigationProgress|null;onOpen:()=>void}){
 const [programs,setPrograms]=useState<GuideProgram[]>([]),[id,setId]=useState(''),[activityId,setActivityId]=useState('')
 const [data,setData]=useState<{program:GuideProgram;conversions:GuideEcConversion[];progress:AdaptiveProgressReport}|null>(null)
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0)
 useEffect(()=>{
  let active=true,inFlight=false
  setData(null);setPrograms([]);setError('');setLoading(true)
  async function load(){
   if(inFlight)return;inFlight=true
   try{
    const rows=(await fetchGuidePrograms()).filter(p=>p.config.deviceId===deviceId&&automaticGuideActivities(p).length>0)
    const p=rows.find(p=>p.programId===id)??(rows.length===1?rows[0]:null)
    const next=p?{program:p,conversions:await fetchGuideEcConversions(p.programId),progress:await fetchAdaptiveProgress(p.programId)}:null
    if(active){setPrograms(rows);setData(next);setError('');setLoading(false)}
   }catch(e){if(active){setData(null);setError(e instanceof Error?e.message:'Gagal memuat rekomendasi.');setLoading(false)}}finally{inFlight=false}
  }
  void load();const timer=setInterval(()=>void load(),5000)
  return()=>{active=false;clearInterval(timer)}
 },[deviceId,id,retry])
 const p=data?.program
 const activities=p?automaticGuideActivities(p):[]
 // Prefer the earliest unfinished kocor activity that is due; never add EC across days.
 const a=activities.find(a=>a.id===activityId)??activities.filter(a=>supportsFertigationAutomation(a)&&a.hst!==null&&a.hst<=p!.hst&&!p!.completedActivityIds.includes(a.id)&&data!.progress.activities.find(v=>v.activityId===a.id)?.remainingMassG!==0).sort((a,b)=>a.hst!-b.hst!)[0]??activities[0]
 const conversion=data?.conversions.find(c=>c.activityId===a?.id),progress=data?.progress.activities.find(v=>v.activityId===a?.id)
 const session=progress?.sessions[0],t=session?.last_telemetry
 const age=t?Date.now()-Date.parse(t.timestamp):Infinity
 const live=age>=0&&age<=90000?t:null
 const currentEc=live?.filteredEc??(report?.deviceId===deviceId&&report.telemetryFresh?report.liquidEc.value:null)
 const target=conversion?.targetEcMsCm==null?null:conversion.targetEcMsCm*1000
 const kocor=!!a&&supportsFertigationAutomation(a)
 const manuallyDone=!!a&&!!p?.completedActivityIds.includes(a.id)
 const status=progress?.requiresReconciliation?'Perlu diperiksa':manuallyDone?'Selesai · dicatat petani':!a?'Belum ada kegiatan':!kocor?'Dikerjakan petani':progress?.requiresReconciliation?'Perlu diperiksa':session&&['queued','running','paused'].includes(session.status)?({queued:'Menunggu alat',running:live?'Sesi berjalan':'Menunggu data alat',paused:'Dijeda'}[session.status]):progress?.remainingMassG===0?'Jatah terpenuhi':a&&a.hst!==null&&p&&a.hst>p.hst?'Belum waktunya':conversion?.status==='ready'?'Target tersedia':'Target EC belum tersedia'
 return <div className="adaptive-recommendation" aria-busy={loading}>
  <label>Program tanaman<select value={p?.programId??''} onChange={e=>{setId(e.target.value);setActivityId('')}}><option value="">Pilih program</option>{programs.map(p=><option value={p.programId} key={p.programId}>{p.plan.cropName} · HST {p.hst}</option>)}</select></label>
  {error?<><p role="alert">{error}</p><button onClick={()=>setRetry(v=>v+1)}>Muat ulang</button></>:loading?<p>Memuat rekomendasi…</p>:!p?<p>{programs.length?'Pilih program untuk melihat hasil konversi.':'Belum ada program kocor untuk perangkat ini. Kegiatan manual tetap tersedia di Program Fertigasi.'}</p>:<>
   <section className="ar-activities" aria-label="Target setiap kegiatan">
    <h3>Target kegiatan · HST {p.hst}</h3>
    <div className="ar-activity-list">{activities.map(item=>{
     const doses=data?.progress.activities.find(v=>v.activityId===item.id)
     const converted=data?.conversions.find(v=>v.activityId===item.id)
     const manual=p.completedActivityIds.includes(item.id)
     const supported=supportsFertigationAutomation(item)
     const reached=doses?.targetMassG!=null&&doses.targetMassG>0&&doses.remainingMassG===0
     const review=!!doses?.requiresReconciliation
     const label=review?'Perlu diperiksa':manual?'Selesai · dicatat petani':supported&&reached?'Target tercapai':item.hst!==null&&item.hst>p.hst?'Belum waktunya':supported?'Belum tercapai':'Belum dicatat selesai'
     return <button key={item.id} type="button" className={`ar-activity${item.id===a?.id?' is-selected':''}`} aria-pressed={item.id===a?.id} onClick={()=>setActivityId(item.id)}>
      <span className="ar-activity-heading"><strong>{item.title} · HST {item.hst??'—'}</strong><span className={`ar-activity-state${!review&&(manual||supported&&reached)?' is-done':''}`}>{label}</span></span>
      <span className="ar-activity-method">{item.method}{!supported?' · Dikerjakan petani':''}</span>
      <span className="ar-activity-target">{item.requirements.length?item.requirements.map(r=>`${r.product}: ${fmt(r.amount)} ${r.unit}`).join(' · '):'Kebutuhan belum tersedia'}</span>
      {item.waterL!==null&&<span>Larutan akhir: {fmt(item.waterL)} L</span>}
      <GuideEcTarget activity={item} conversion={converted}/>
      {supported&&doses?.targetMassG!=null&&doses.targetMassG>0&&<span className="ar-activity-dose">{fmt(doses.estimatedDeliveredMassG/1000)} / {fmt(doses.targetMassG/1000)} kg tersalurkan (estimasi)<progress aria-label={`Progres pupuk ${item.title} HST ${item.hst}`} max={doses.targetMassG} value={Math.max(0,Math.min(doses.targetMassG,doses.estimatedDeliveredMassG))}/></span>}
     </button>
    })}</div>
   </section>
   <div className="ar-status"><AutomationMethod method={a?.method??''}/><strong>{status}</strong></div>
   {kocor?<><div className="ar-grid">
    <section><h3>EC campuran</h3><strong>{fmt(currentEc)} <small>µS/cm</small></strong><p>Target konversi: {fmt(target)} µS/cm</p><RecommendationBar value={currentEc} target={target} label="EC dibanding target" missing={target===null?'Menunggu hasil konversi':'Menunggu sensor valid'}/>{currentEc!==null&&target!==null&&currentEc>target&&<small className="ar-above">Di atas target {fmt(currentEc-target)} µS/cm</small>}</section>
    <section><h3>Kebutuhan panduan</h3><strong>{fmt(progress?.targetMassG==null?null:progress.targetMassG/1000)} <small>kg pupuk</small></strong><p>{fmt(a?.waterL)} L larutan akhir</p></section>
   </div>
   {conversion?.status!=='ready'&&<p className="ar-notice">{conversion?.reason.includes('air baku')?'Isi EC air baku pada program.':conversion?.reason.includes('Profil konversi')?'Profil campuran pupuk belum tersedia.':'Periksa dosis, volume larutan, dan profil konversi.'}</p>}
   <section className="ar-progress"><h3>Kebutuhan pupuk · lintas hari</h3><strong>{fmt(progress?.estimatedDeliveredMassG==null?null:progress.estimatedDeliveredMassG/1000)} / {fmt(progress?.targetMassG==null?null:progress.targetMassG/1000)} kg</strong>
    <RecommendationBar value={progress?.estimatedDeliveredMassG} target={progress?.targetMassG} label="Estimasi tersalurkan" missing="Kebutuhan pupuk belum tersedia"/>
    <p>Sisa {fmt(progress?.remainingMassG==null?null:progress.remainingMassG/1000)} kg · estimasi dari debit pekatan</p>
   </section>
   {session?<section className="ar-progress"><h3>Sesi terakhir</h3><p>Target EC sesi: {fmt(session.command_snapshot.targetEcUs)} µS/cm</p><div className="ar-grid"><p>Air <strong>{fmt(session.water_volume_l)} / {fmt(session.command_snapshot.targetWaterVolumeL)} L</strong></p><p>Pekatan <strong>{fmt(session.fert_volume_l)} / {fmt(session.command_snapshot.targetFertVolumeL)} L</strong></p></div><p>Pompa air: {live?(live.waterPump?'ON':'OFF'):'Belum terkonfirmasi'} · pupuk: {live?(live.fertPump?'ON':'OFF'):'Belum terkonfirmasi'}</p>{session.reason&&<p>{session.reason==='operator_reconciled'?'Hasil sesi sudah diperiksa.':session.reason==='stop_requested'?'Menunggu konfirmasi berhenti.':'Periksa kondisi alat dan hasil sesi.'}</p>}</section>:<p>Belum ada penyiraman tercatat.</p>}
   <details><summary>Dasar konversi</summary><p>{fmt(conversion?.concentrationGPerL)} g/L · EC air baku {fmt(p.config.waterEcMsCm)} mS/cm</p><p>{conversion?.profile?.sourceReference??'Profil konversi belum tersedia.'}</p></details>
   </>:<p>{a?`Kegiatan ${a.method} dilakukan petani. Tidak dikirim ke pompa fertigasi.`:'Belum ada kegiatan pada program ini.'}</p>}
  </>}
  <button className="ar-open" onClick={onOpen}>Buka Program Fertigasi</button>
 </div>
}
