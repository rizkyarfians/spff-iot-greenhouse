import { useEffect, useRef, useState } from 'react'
import { soilEcPulseProfileSchema, type FertigationRecipe } from '@spff/contracts'
import { fetchSoilEcPulseSessions, startSoilEcPulseSession, stopSoilEcPulseSession, releaseSoilEcPulseSession, type SoilEcSessionView } from './api'

const numericFields = [
  ['kpMsPerUsCm','Faktor pulse (ms per selisih µS/cm)'],
  ['minOnMs','Pulse minimum (ms, minimal 1500)'],['maxOnMs','Pulse maksimum (ms, maksimal 30000)'],
  ['settleMs','Waktu meresap sebelum pembacaan baru (ms)'],['maxSessionMs','Batas durasi seluruh sesi (ms)'],
  ['maxTotalOnMs','Batas total pompa ON per sesi (ms)'],['maxDailyOnMs','Batas total pompa ON per hari (ms)'],
  ['maxCycles','Batas jumlah cycle'],['stableSamples','Jumlah sampel stabil (2–10)'],
  ['stableSpreadUsCm','Selisih maksimum antar sampel stabil (µS/cm)'],['toleranceUsCm','Toleransi target EC (µS/cm)'],
  ['minimumRiseUsCm','Kenaikan EC minimum setelah pulse (µS/cm)'],['maxNoResponseCycles','Batas cycle tanpa respons'],
  ['moistureMinPercent','Moisture minimum evaluasi (%)'],['moistureMaxPercent','Moisture maksimum evaluasi (%)'],
  ['cooldownMs','Jeda minimum antar sesi (ms)'],['minFlowLpm','Debit penggerak minimum (L/min)'],
] as const
const reasons:Record<string,string> = {
  waiting_new_samples:'Menunggu sampel tanah baru', settling:'Menunggu larutan meresap',
  target_confirmation:'Menunggu semua sampel masuk toleransi target', soil_ec_unstable:'Pembacaan EC belum stabil', soil_ec_above_start_threshold:'EC belum di bawah batas mulai',
  soil_ec_target_stable:'Target EC tanah tercapai dan stabil', soil_ec_below_target:'Pulse disiapkan dari selisih EC tanah',
  pulse_outcome_unknown:'Hasil pulse belum dapat dipastikan; sesi dihentikan',
  operator_stop:'Dihentikan operator; periksa konfirmasi OFF', pulse_budget_limit:'Batas pemberian tercapai',
  soil_ec_no_response:'EC tanah tidak merespons', soil_ec_overshoot:'EC melewati toleransi target',
  soil_ec_high:'EC melewati batas tinggi', moisture_outside_calibrated_range:'Moisture di luar rentang kalibrasi',
  rule_mode_schedule_or_device_changed:'Aturan, mode, jadwal, atau perangkat tidak lagi siap',
  soil_sensor_invalid_or_stale:'Sensor tanah tidak valid atau terlambat', device_rejected_or_fault:'Perangkat menolak atau melaporkan fault',
}
export function SoilEcPulsePanel({recipe,deviceId,admin,operator,dirty}:{recipe:FertigationRecipe;deviceId:string;admin:boolean;operator:boolean;dirty:boolean}) {
  const [values,setValues]=useState<Record<string,string>>({})
  const [reference,setReference]=useState('')
  const [confirmed,setConfirmed]=useState(false)
  const [water,setWater]=useState(false)
  const [flowKey,setFlowKey]=useState<'flow_water_lpm'|'flow_fert_lpm'>('flow_fert_lpm')
  const [enabled,setEnabled]=useState(false)
  const [executionEnabled,setExecutionEnabled]=useState(false)
  const [sessions,setSessions]=useState<SoilEcSessionView[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const requestId=useRef<string|null>(null)
  const busyRef=useRef(false)
  const generation=useRef(0)
  useEffect(()=>{requestId.current=null;setSessions([]);setEnabled(false);setExecutionEnabled(false);setError('');setConfirmed(false)
    const current=++generation.current
    if(!deviceId)return
    let running=false
    const refresh=async()=>{if(running)return;running=true;try{
      const data=await fetchSoilEcPulseSessions(deviceId)
      if(generation.current===current){setEnabled(data.enabled);setExecutionEnabled(data.executionEnabled);setSessions(data.sessions)}
    }catch(e){if(generation.current===current){setEnabled(false);setError(e instanceof Error?e.message:'Gagal memuat sesi')}}finally{running=false}}
    void refresh();const timer=setInterval(()=>void refresh(),5000)
    return()=>{clearInterval(timer);generation.current++}
  },[deviceId,recipe.recipeId])
  async function start(){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('')
    try{
      if(!confirmed)throw new Error('Verifikasi kalibrasi dan susunan aliran terlebih dahulu.')
      const profile=soilEcPulseProfileSchema.parse({...Object.fromEntries(numericFields.map(([k])=>[k,values[k]?.trim()?Number(values[k]):null])),
        calibrationReference:reference,soilEcTargetsVerified:true,hydraulicsVerified:true,waterWithPulse:water,flowSensorKey:flowKey})
      requestId.current??=crypto.randomUUID()
      await startSoilEcPulseSession({requestId:requestId.current,recipeId:recipe.recipeId,deviceId,profile})
      const data=await fetchSoilEcPulseSessions(deviceId);setSessions(data.sessions)
    }catch(e){setError(e instanceof Error?e.message:'Gagal memulai sesi')}
    finally{busyRef.current=false;setBusy(false)}
  }
  async function stop(id:string,release=false){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{
    await (release?releaseSoilEcPulseSession(id):stopSoilEcPulseSession(id));const data=await fetchSoilEcPulseSessions(deviceId);setSessions(data.sessions)
  }catch(e){setError(e instanceof Error?e.message:'Gagal menghentikan sesi')}finally{busyRef.current=false;setBusy(false)}}
  const active=sessions.some(s=>['waiting','in_flight','fault'].includes(s.status))
  return <section className="ft-field-group" aria-label="Sesi pulse EC tanah"><h3>Sesi pulse EC tanah</h3>
    <p>Server menghitung durasi ON dari selisih EC tanah zona 1. Perangkat menjalankan satu pulse, OFF sendiri, lalu server menunggu pembacaan baru. Tidak menghitung liter stok pupuk.</p>
    <p>Nonaktifkan fertilizer sensor legacy dan tunggu konfigurasi diterapkan sebelum memulai. Target aturan: {recipe.ecTargetUsCm??'belum diisi'} µS/cm. Menjalankan sesi akan menahan kontrol sensor otomatis lama sampai strategi dilepas secara eksplisit.</p>
    {!deviceId?<p>Pilih perangkat terlebih dahulu.</p>:!enabled?<p>Eksekusi pulse belum tersedia pada server atau koneksi status gagal. Evaluasi rekomendasi tetap terpisah.</p>:null}
    {enabled&&!executionEnabled&&<p>Aktifkan AI Fertigasi EC Tanah di Settings sebelum memulai sesi.</p>}
    {error&&<p className="ft-error" role="alert">{error}</p>}
    {enabled&&admin&&<details><summary>Kalibrasi dan batas sesi</summary>
      <fieldset disabled={busy||active||dirty}><div className="ft-fields">
        <label>Referensi hasil kalibrasi<input value={reference} onChange={e=>{setReference(e.target.value);requestId.current=null;setConfirmed(false)}}/></label>
        {numericFields.map(([key,label])=><label key={key}>{label}<input type="number" step="any" value={values[key]??''}
          onChange={e=>{setValues({...values,[key]:e.target.value});requestId.current=null;setConfirmed(false)}}/></label>)}
        <label>Flow meter penggerak yang sudah diverifikasi<select value={flowKey} onChange={e=>{setFlowKey(e.target.value as typeof flowKey);requestId.current=null;setConfirmed(false)}}>
          <option value="flow_fert_lpm">Flow jalur pupuk/Venturi</option><option value="flow_water_lpm">Flow jalur air</option></select></label>
        <label className="ft-pulse-check"><input type="checkbox" checked={water} onChange={e=>{setWater(e.target.checked);requestId.current=null;setConfirmed(false)}}/>CH3 perlu menyala bersama CH1 saat pulse, sesuai hasil uji jalur air</label>
        <label className="ft-pulse-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Target dataset sudah diverifikasi untuk sensor EC tanah ini; respons pulse, waktu meresap, dan aliran Venturi sudah dikalibrasi.</label>
      </div></fieldset>
      <button type="button" className="ft-primary" disabled={busy||active||dirty||!confirmed||!deviceId||!executionEnabled} onClick={()=>void start()}>Mulai sesi pulse</button>
    </details>}
    {sessions.map(s=><article className="ft-result" key={s.session_id}><strong>{s.status}</strong>
      <p>{reasons[s.reason]??s.reason}</p><p>Cycle: {s.cycles} · waktu ON diperintahkan: {Number(s.total_on_ms)/1000} detik · EC sebelum pulse terakhir: {s.previous_ec??'—'} µS/cm</p>
      <p>ACK pulse terakhir: {s.commands.filter(c=>c.operation==='pulse').at(-1)?.status??'belum ada'}</p>
      {admin&&['completed','cancelled','fault'].includes(s.status)&&<button type="button" disabled={busy} onClick={()=>void stop(s.session_id,true)}>Lepas strategi pulse (setelah mode Manual diterapkan)</button>}
      {operator&&['waiting','in_flight','fault'].includes(s.status)&&<button type="button" disabled={busy} onClick={()=>void stop(s.session_id)}>Hentikan sesi / tangani fault</button>}
    </article>)}
  </section>
}
