import { useEffect,useId,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiDevice,SoilEcExecutionView } from '@spff/contracts'
import { fetchSoilEcExecution,saveSoilEcExecution } from './api'
import { SettingsSwitchNotice } from './SettingsSwitchNotice'
import { switchSaveError,type SwitchNotice } from './settingsSwitchFeedback'
import './WaterInterlockSettings.css'

export function SoilEcExecutionSettings({devices,admin,connected}:{devices:ApiDevice[];admin:boolean;connected:boolean}) {
  const [chosen,setChosen]=useState('')
  const deviceId=devices.some(d=>d.deviceId===chosen)?chosen:devices[0]?.deviceId??''
  const [stored,setStored]=useState<SoilEcExecutionView|null>(null)
  const view=stored?.deviceId===deviceId?stored:null
  const [proposal,setProposal]=useState<{deviceId:string;revision:number;enabled:boolean}|null>(null)
  const [open,setOpen]=useState(false),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [saveError,setSaveError]=useState('')
  const [notice,setNotice]=useState<SwitchNotice|null>(null)
  const dialog=useRef<HTMLDialogElement>(null),busyRef=useRef(false),generation=useRef(0),epoch=useRef(0)
  const title=useId(),description=useId()
  useEffect(()=>{
    const current=++generation.current
    setStored(null);setError('');setSaveError('');setNotice(null);setProposal(null)
    if(!deviceId)return
    let running=false,cancelled=false
    async function refresh(){
      if(running||busyRef.current)return
      running=true;const request=epoch.current
      try {
        const next=await fetchSoilEcExecution(deviceId)
        if(!cancelled&&generation.current===current&&request===epoch.current){setStored(next);setError('')}
      }catch(e){if(!cancelled&&request===epoch.current)setError(e instanceof Error?e.message:'Gagal memuat pengaturan AI.')}
      finally{running=false}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000)
    return()=>{cancelled=true;clearInterval(timer)}
  },[deviceId])
  useEffect(()=>{
    if(!open)return
    const element=dialog.current;element?.showModal()
    return()=>element?.close()
  },[open])
  useEffect(()=>{
    if(open&&view&&!proposal&&!saved)setProposal({deviceId,revision:view.revision,enabled:!view.enabled})
  },[open,view,proposal,saved,deviceId])
  function show(){setProposal(view?{deviceId,revision:view.revision,enabled:!view.enabled}:null);setSaveError('');setSaved(false);setOpen(true)}
  function close(){if(!busyRef.current)setOpen(false)}
  async function confirm(){
    if(!proposal||proposal.deviceId!==deviceId||!admin||!connected||busyRef.current||saved)return
    busyRef.current=true;epoch.current++;setBusy(true);setSaveError('');setNotice(null)
    const current=generation.current
    try {
      const next=await saveSoilEcExecution(deviceId,proposal.revision,proposal.enabled)
      if(current===generation.current){
        setStored(next);setSaved(true)
        setNotice(next.enabled
          ?{kind:next.capable?'success':'warning',message:next.capable?'Izin AI berhasil diaktifkan. Sesi belum dimulai.':'AI diaktifkan. Perangkat belum siap memulai.'}
          :next.unconfirmedStopSessions>0
            ?{kind:'warning',message:'AI dinonaktifkan. Pompa belum terkonfirmasi berhenti; periksa alat.'}
            :{kind:'success',message:'AI dinonaktifkan. Sesi baru diblokir.'})
      }
    }catch(e){if(current===generation.current){const message=switchSaveError(e);setSaveError(message);setNotice({kind:'error',message:`Perubahan AI belum terkonfirmasi. ${message}`})}}
    finally{busyRef.current=false;setBusy(false)}
  }
  const action=proposal?.enabled?'Aktifkan':'Nonaktifkan'
  return <div className="setting-toggle-row">
    {!open&&notice&&createPortal(<SettingsSwitchNotice notice={notice} onClose={()=>setNotice(null)}/>,document.body)}
    <div><strong>AI Fertigasi EC Tanah</strong></div>
    <button type="button" className={`switch ${view?.enabled?'is-on':''}`} role="switch"
      aria-label="AI fertigasi EC tanah" aria-checked={view?.enabled??false} aria-busy={busy} aria-haspopup="dialog"
      disabled={!admin||!connected||!deviceId||busy} onClick={show}><span/></button>
    {open&&createPortal(<dialog ref={dialog} className="water-interlock-dialog" aria-labelledby={title} aria-describedby={description}
      onCancel={event=>{if(busyRef.current)event.preventDefault();else setOpen(false)}}
      onClick={event=>{if(event.target===event.currentTarget)close()}}>
      <SettingsSwitchNotice notice={notice} onClose={()=>setNotice(null)}/>
      <h2 id={title}>{saved?'AI Fertigasi EC Tanah':`${action} AI fertigasi?`}</h2>
      {devices.length>1&&!saved&&<label className="field-label"><span>Perangkat</span>
        <select disabled={busy} value={deviceId} onChange={e=>{setChosen(e.target.value);setProposal(null)}}>
          {devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}
        </select></label>}
      <p id={description}>{saved
        ?view?.enabled?'AI aktif. Mulai sesi dari Program Fertigasi.':'AI nonaktif. Pastikan pompa sudah berhenti.'
        :proposal?.enabled?'Izinkan pemupukan otomatis. Mengaktifkan izin ini belum menyalakan pompa.':'Hentikan sesi aktif dan blokir sesi baru. Tunggu konfirmasi pompa berhenti.'}</p>
      <p className="water-interlock-device">{devices.find(d=>d.deviceId===deviceId)?.displayName??deviceId}</p>
      {!view&&!error&&<p role="status">Memuat pengaturan…</p>}
      {view&&!view.installed&&<p>Fitur belum siap. Hubungi pengelola.</p>}
      {view&&!view.serverAvailable&&<p>Pemupukan otomatis belum tersedia. Hubungi pengelola.</p>}
      {view&&!view.capable&&<p>Perangkat belum siap. Periksa koneksi alat.</p>}
      {!!view?.unconfirmedStopSessions&&<p role="status">{view.unconfirmedStopSessions} sesi belum terkonfirmasi berhenti. Periksa pompa pada alat.</p>}
      {error&&<p role="alert">{error}</p>}
      {saveError&&<p role="alert">{saveError}</p>}
      <div className="water-interlock-dialog-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={close}>{saved?'Tutup':'Batal'}</button>
        {!saved&&<button className="primary-button" type="button" onClick={()=>void confirm()}
          disabled={busy||!connected||!view||!proposal||!view.installed||!!error||(proposal.enabled&&!view.serverAvailable)}>
          {busy?'Menyimpan…':`${action} AI`}</button>}
      </div>
    </dialog>,document.body)}
  </div>
}
