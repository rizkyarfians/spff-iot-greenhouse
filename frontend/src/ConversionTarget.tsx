import {useEffect,useState} from 'react'
import type {GuideEcConversion} from '@spff/contracts'
import {fetchGuideEcConversions} from './api'
import {conversionTarget} from './conversionTargetData'
import './ConversionTarget.css'

const fmt=(value:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(value)
type Props={programId:string;activityId:string;title:string;waterEcMsCm?:number}
type Loaded={programId:string;activityId:string;conversion?:GuideEcConversion;error?:string}

export function ConversionTargetView({title,activityId,conversion,waterEcMsCm,loading=false,error}:{title:string;activityId:string;conversion?:GuideEcConversion;waterEcMsCm?:number;loading?:boolean;error?:string}){
 const target=conversionTarget(activityId,conversion)
 const water=typeof waterEcMsCm==='number'&&Number.isFinite(waterEcMsCm)&&waterEcMsCm>=0?waterEcMsCm:null
 return <section className="conversion-target" aria-label="Hasil konversi EC" aria-busy={loading}>
  <h3>Hasil konversi EC</h3><p className="conversion-target-activity">{title}</p>
  <strong className="conversion-target-value">{target.ready?<>{fmt(target.targetMsCm!)} <small>mS/cm</small></>:'â€”'}</strong>
  {target.ready&&<p className="conversion-target-secondary">{fmt(target.targetUsCm!)} ÂµS/cm Â· target EC kegiatan</p>}
  <dl><div><dt>Konsentrasi larutan</dt><dd>{target.concentrationGPerL===null?'â€”':`${fmt(target.concentrationGPerL)} g/L`}</dd></div>
   <div><dt>EC air baku program</dt><dd>{water===null?'Belum diisi':`${fmt(water)} mS/cm`}</dd></div></dl>
  {loading?<p role="status">Memuat hasil konversiâ€¦</p>:error?<p role="alert">Hasil konversi belum dapat dimuat: {error}</p>:!target.ready?<p className="conversion-target-reason">{target.reason}</p>:<p className="conversion-target-note">Dari konversi program tersimpan. Belum berarti target ini sudah diterapkan ke alat.</p>}
 </section>
}

export function ConversionTarget({programId,activityId,title,waterEcMsCm}:Props){
 const [loaded,setLoaded]=useState<Loaded|null>(null)
 useEffect(()=>{
  let active=true
  // Convert manual and automatic guide activities alike. The server owns units,
  // profile checks and unavailable reasons; this read never starts a session.
  fetchGuideEcConversions(programId).then(rows=>{
   if(active)setLoaded({programId,activityId,conversion:rows.find(row=>row.activityId===activityId)})
  }).catch(error=>{if(active)setLoaded({programId,activityId,error:error instanceof Error?error.message:'Koneksi gagal.'})})
  return()=>{active=false}
 },[programId,activityId])
 const current=loaded?.programId===programId&&loaded.activityId===activityId?loaded:null
 return <ConversionTargetView title={title} activityId={activityId} waterEcMsCm={waterEcMsCm} conversion={current?.conversion} error={current?.error} loading={!current}/>
}
