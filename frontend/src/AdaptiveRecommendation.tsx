import {useEffect,useState} from 'react'
import type {FertigationProgress,GuideEcConversion,GuideProgram} from '@spff/contracts'
import {fetchGuidePrograms,fetchGuideEcConversions,fetchAdaptiveProgress,type AdaptiveProgressReport} from './api'
import {AutomationMethod} from './AutomationMethod'
import './AdaptiveRecommendation.css'
const fmt=(v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(v)
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
    const rows=(await fetchGuidePrograms()).filter(p=>p.config.deviceId===deviceId)
    const p=rows.find(p=>p.programId===id)??(rows.length===1?rows[0]:null)
    const next=p?{program:p,conversions:await fetchGuideEcConversions(p.programId),progress:await fetchAdaptiveProgress(p.programId)}:null
    if(active){setPrograms(rows);setData(next);setError('');setLoading(false)}
   }catch(e){if(active){setData(null);setError(e instanceof Error?e.message:'Gagal memuat rekomendasi.');setLoading(false)}}finally{inFlight=false}
  }
  void load();const timer=setInterval(()=>void load(),5000)
  return()=>{active=false;clearInterval(timer)}
 },[deviceId,id,retry])
 const p=data?.program
 const activities=p?.plan.activities??[]
 // Prefer the earliest unfinished kocor activity that is due; never add EC across days.
 const a=activities.find(a=>a.id===activityId)??activities.filter(a=>a.method.toLowerCase()==='kocor'&&a.hst!==null&&a.hst<=p!.hst&&!p!.completedActivityIds.includes(a.id)&&data!.progress.activities.find(v=>v.activityId===a.id)?.remainingMassG!==0).sort((a,b)=>a.hst!-b.hst!)[0]??activities[0]
 const conversion=data?.conversions.find(c=>c.activityId===a?.id),progress=data?.progress.activities.find(v=>v.activityId===a?.id)
 const session=progress?.sessions[0],t=session?.last_telemetry
 const age=t?Date.now()-Date.parse(t.timestamp):Infinity
 const live=age>=0&&age<=90000?t:null
 const currentEc=live?.filteredEc??(report?.deviceId===deviceId&&report.telemetryFresh?report.liquidEc.value:null)
 const target=conversion?.targetEcMsCm==null?null:conversion.targetEcMsCm*1000
 const kocor=a?.method.toLowerCase()==='kocor'
 const status=!a?'Belum ada kegiatan':!kocor?'Dikerjakan petani':progress?.requiresReconciliation?'Perlu diperiksa':session&&['queued','running','paused'].includes(session.status)?({queued:'Menunggu alat',running:live?'Sesi berjalan':'Menunggu data alat',paused:'Dijeda'}[session.status]):progress?.remainingMassG===0?'Jatah terpenuhi':a&&a.hst!==null&&p&&a.hst>p.hst?'Belum waktunya':conversion?.status==='ready'?'Target tersedia':'Konversi belum lengkap'
 return <div className="adaptive-recommendation" aria-busy={loading}>
  <label>Program tanaman<select value={p?.programId??''} onChange={e=>{setId(e.target.value);setActivityId('')}}><option value="">Pilih program</option>{programs.map(p=><option value={p.programId} key={p.programId}>{p.plan.cropName} · HST {p.hst}</option>)}</select></label>
  {error?<><p role="alert">{error}</p><button onClick={()=>setRetry(v=>v+1)}>Muat ulang</button></>:loading?<p>Memuat rekomendasi…</p>:!p?<p>{programs.length?'Pilih program untuk melihat hasil konversi.':'Belum ada program untuk perangkat ini.'}</p>:<>
   <label>Kegiatan<select value={a?.id??''} onChange={e=>setActivityId(e.target.value)}>{activities.map(a=><option key={a.id} value={a.id}>{a.title} · HST {a.hst??'—'} · {a.method}</option>)}</select></label>
   <div className="ar-status"><AutomationMethod method={a?.method??''}/><strong>{status}</strong></div>
   {kocor?<><div className="ar-grid">
    <section><h3>EC campuran</h3><strong>{fmt(currentEc)} <small>µS/cm</small></strong><p>Target konversi: {fmt(target)} µS/cm</p></section>
    <section><h3>Kebutuhan panduan</h3><strong>{fmt(progress?.targetMassG==null?null:progress.targetMassG/1000)} <small>kg pupuk</small></strong><p>{fmt(a?.waterL)} L larutan akhir</p></section>
   </div>
   {conversion?.status!=='ready'&&<p className="ar-notice">{conversion?.reason??'Hasil konversi belum tersedia.'}</p>}
   <section className="ar-progress"><h3>Progres pemupukan · lintas hari</h3><strong>{fmt(progress?.estimatedDeliveredMassG==null?null:progress.estimatedDeliveredMassG/1000)} / {fmt(progress?.targetMassG==null?null:progress.targetMassG/1000)} kg</strong>
    {progress?.targetMassG!=null&&progress.targetMassG>0&&<progress aria-label="Progres perkiraan massa pupuk" max={progress.targetMassG} value={Math.min(progress.targetMassG,progress.estimatedDeliveredMassG)}/>}
    <p>Sisa {fmt(progress?.remainingMassG==null?null:progress.remainingMassG/1000)} kg · estimasi dari debit pekatan</p>
   </section>
   {session?<section className="ar-progress"><h3>Sesi terakhir</h3><p>Target EC sesi: {fmt(session.command_snapshot.targetEcUs)} µS/cm</p><div className="ar-grid"><p>Air <strong>{fmt(session.water_volume_l)} / {fmt(session.command_snapshot.targetWaterVolumeL)} L</strong></p><p>Pekatan <strong>{fmt(session.fert_volume_l)} / {fmt(session.command_snapshot.targetFertVolumeL)} L</strong></p></div><p>Pompa air: {live?(live.waterPump?'ON':'OFF'):'Belum terkonfirmasi'} · pupuk: {live?(live.fertPump?'ON':'OFF'):'Belum terkonfirmasi'}</p>{session.reason&&<p>Alasan alat: {session.reason}</p>}</section>:<p>Belum ada sesi adaptif tercatat.</p>}
   <details><summary>Dasar konversi</summary><p>{fmt(conversion?.concentrationGPerL)} g/L · EC air baku {fmt(p.config.waterEcMsCm)} mS/cm</p><p>{conversion?.profile?.sourceReference??'Profil konversi belum tersedia.'}</p><p>Target EC larutan berasal dari panduan dan profil campuran. Progres dihitung dari pupuk, bukan penjumlahan EC.</p></details>
   </>:<p>{a?`Kegiatan ${a.method} dilakukan petani. Tidak dikirim ke pompa fertigasi.`:'Belum ada kegiatan pada program ini.'}</p>}
  </>}
  <button className="ar-open" onClick={onOpen}>Buka Program Fertigasi</button>
 </div>
}
