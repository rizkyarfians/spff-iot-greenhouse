import { useEffect, useRef, useState } from 'react'
import type { FertigationRecipe } from '@spff/contracts'
import { fetchSoilEcPulseSessions, stopSoilEcPulseSession, releaseSoilEcPulseSession, type SoilEcSessionView } from './api'

const reasons:Record<string,string> = {
  schedule_priority:'Menunggu jadwal aktif selesai',automatic_session_started:'Sesi AI otomatis dimulai',
  waiting_new_samples:'Menunggu sampel tanah baru', settling:'Menunggu larutan meresap',
  target_confirmation:'Menunggu semua sampel masuk toleransi target', soil_ec_unstable:'Pembacaan EC belum stabil', soil_ec_above_start_threshold:'EC belum di bawah batas mulai',
  soil_ec_already_sufficient:'EC tanah sudah cukup; AI tidak perlu menyalakan pompa pupuk',
  soil_ec_target_stable:'Target EC tanah tercapai dan stabil', soil_ec_below_target:'Menyiapkan pemberian pupuk',
  pulse_outcome_unknown:'Hasil pemberian belum dapat dipastikan; sesi dihentikan',
  operator_stop:'Dihentikan operator; periksa konfirmasi OFF', pulse_budget_limit:'Batas pemberian tercapai',
  soil_ec_no_response:'EC tanah tidak merespons', soil_ec_overshoot:'EC melewati toleransi target',
  soil_ec_high:'EC melewati batas tinggi', moisture_outside_calibrated_range:'Kelembapan di luar rentang kalibrasi',
  rule_mode_schedule_or_device_changed:'Aturan, mode, jadwal, atau perangkat tidak lagi siap',
  soil_sensor_invalid_or_stale:'Sensor tanah tidak valid atau terlambat', device_rejected_or_fault:'Perangkat menolak atau melaporkan fault',
}
export function SoilEcPulsePanel({deviceId,admin,operator}:{recipe:FertigationRecipe;deviceId:string;admin:boolean;operator:boolean;dirty:boolean}) {
  const [sessions,setSessions]=useState<SoilEcSessionView[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const busyRef=useRef(false)
  const generation=useRef(0)
  useEffect(()=>{
    const current=++generation.current
    setSessions([]);setError('')
    if(!deviceId)return
    let pending=false
    async function refresh(){
      if(pending)return
      pending=true
      try{const data=await fetchSoilEcPulseSessions(deviceId)
        if(generation.current===current){setSessions(data.sessions);setError('')}
      }catch{if(generation.current===current)setError('Riwayat sesi belum tersedia.')}
      finally{pending=false}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000)
    return()=>{clearInterval(timer);generation.current++}
  },[deviceId])
  async function stop(id:string,release=false){
    if(busyRef.current)return
    busyRef.current=true;setBusy(true);setError('')
    const current=generation.current
    try{
      await (release?releaseSoilEcPulseSession(id):stopSoilEcPulseSession(id))
      const data=await fetchSoilEcPulseSessions(deviceId)
      if(generation.current===current)setSessions(data.sessions)
    }catch(e){if(generation.current===current)setError(e instanceof Error?e.message:'Gagal menghentikan sesi')}
    finally{busyRef.current=false;setBusy(false)}
  }
  if(!sessions.length&&!error)return null
  return <section className="ft-field-group" aria-label="Riwayat sesi AI"><h3>Riwayat sesi AI</h3>
    {error&&<p role="alert">{error}</p>}
    {sessions.map(s=><article className="ft-result" key={s.session_id}>
      <strong>{{waiting:'Menunggu',in_flight:'Sedang berjalan',completed:'Selesai',cancelled:'Dihentikan',fault:'Perlu diperiksa'}[s.status]??'Menunggu konfirmasi'}</strong>
      <p>{reasons[s.reason]??s.reason}</p><p>Durasi pemberian: {Number(s.total_on_ms)/1000} detik</p>
      {admin&&['completed','cancelled','fault'].includes(s.status)&&<button type="button" disabled={busy} onClick={()=>void stop(s.session_id,true)}>Akhiri kontrol sesi</button>}
      {operator&&['waiting','in_flight','fault'].includes(s.status)&&<button type="button" disabled={busy} onClick={()=>void stop(s.session_id)}>Hentikan sesi</button>}
    </article>)}
  </section>
}
