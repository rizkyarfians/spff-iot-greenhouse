import { useEffect,useId,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiDevice,WaterInterlockView } from '@spff/contracts'
import { fetchWaterInterlock,saveWaterInterlock } from './api'
import { SettingsSwitchNotice } from './SettingsSwitchNotice'
import { switchSaveError,type SwitchNotice } from './settingsSwitchFeedback'
import './WaterInterlockSettings.css'

type Proposal={deviceId:string;revision:number;enabled:boolean}
export function WaterInterlockSettings({devices,admin,connected}:{devices:ApiDevice[];admin:boolean;connected:boolean}){
  const [chosen,setChosen]=useState('')
  const deviceId=devices.some(d=>d.deviceId===chosen)?chosen:devices[0]?.deviceId??''
  const [storedView,setView]=useState<WaterInterlockView|null>(null)
  const view=storedView?.deviceId===deviceId?storedView:null
  const [open,setOpen]=useState(false)
  const [proposal,setProposal]=useState<Proposal|null>(null)
  const [saved,setSaved]=useState(false)
  const [busy,setBusy]=useState(false)
  const [loadError,setLoadError]=useState('')
  const [saveError,setSaveError]=useState('')
  const [notice,setNotice]=useState<SwitchNotice|null>(null)
  const notified=useRef('')
  const dialog=useRef<HTMLDialogElement>(null)
  const busyRef=useRef(false),generation=useRef(0),requestEpoch=useRef(0)
  const titleId=useId(),descriptionId=useId()
  const deviceName=devices.find(d=>d.deviceId===deviceId)?.displayName??deviceId

  useEffect(()=>{
    const current=++generation.current
    let cancelled=false,running=false
    setView(null);setLoadError('');setNotice(null);notified.current=''
    if(!deviceId)return
    const refresh=async()=>{
      if(running||busyRef.current)return
      running=true;const epoch=requestEpoch.current
      try{
        const next=await fetchWaterInterlock(deviceId)
        if(!cancelled&&current===generation.current&&epoch===requestEpoch.current){setView(next);setLoadError('')}
      }catch(e){if(!cancelled&&epoch===requestEpoch.current)setLoadError(e instanceof Error?e.message:'Gagal membaca pengaturan interlock.')}
      finally{running=false}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000)
    return()=>{cancelled=true;clearInterval(timer)}
  },[deviceId])

  useEffect(()=>{
    if(open&&view&&!proposal&&!saved)setProposal({deviceId,revision:view.revision,enabled:!view.enabled})
  },[open,view,proposal,saved,deviceId])

  useEffect(()=>{
    if(!open)return
    const element=dialog.current
    element?.showModal()
    return()=>{element?.close()}
  },[open])

  function show(){
    setProposal(view?{deviceId,revision:view.revision,enabled:!view.enabled}:null)
    setSaved(false);setSaveError('');setOpen(true)
  }
  function close(){if(!busyRef.current)setOpen(false)}
  async function confirm(){
    if(!proposal||proposal.deviceId!==deviceId||!admin||!connected||busyRef.current||saved)return
    busyRef.current=true;requestEpoch.current++;setBusy(true);setSaveError('');setNotice(null);notified.current=''
    const current=generation.current
    try{
      const next=await saveWaterInterlock(deviceId,proposal.revision,proposal.enabled)
      if(current===generation.current){setView(next);setSaved(true)}
    }catch(e){if(current===generation.current){const message=switchSaveError(e);setSaveError(message);setNotice({kind:'error',message:`Perubahan interlock belum terkonfirmasi. ${message}`})}}
    finally{busyRef.current=false;setBusy(false)}
  }
  const confirmed=view?.acknowledgementStatus==='applied'&&view.acknowledgedRevision===view.revision&&view.appliedEnabled===view.enabled
  const reported=view?.online&&view.reportedRevision===view.revision&&view.reportedEnabled===view.enabled
  const rejected=view?.acknowledgementStatus==='rejected'
  useEffect(()=>{
    if(!saved||!view)return
    const state=rejected?'rejected':confirmed&&reported?'applied':'pending'
    const key=`${deviceId}:${view.revision}:${state}`
    if(notified.current===key)return
    notified.current=key
    setNotice(rejected
      ?{kind:'error',message:`Firmware menolak perubahan interlock. ${view.reason??'Periksa perangkat.'}`}
      :confirmed&&reported
        ?{kind:'success',message:`Interlock tandon air ${view.enabled?'aktif':'nonaktif'}; perangkat sudah mengonfirmasi.`}
        :{kind:'warning',message:'Pengaturan interlock tersimpan. Menunggu konfirmasi perangkat; perubahan belum dianggap diterapkan.'})
  },[saved,view,deviceId,rejected,confirmed,reported])
  const status=rejected?'Perangkat menolak perubahan.':confirmed&&reported?'Perubahan sudah diterapkan pada perangkat.':'Tersimpan. Menunggu konfirmasi perangkat.'
  const action=proposal?.enabled?'Aktifkan':'Nonaktifkan'
  return <div className="setting-toggle-row">
    {!open&&notice&&createPortal(<SettingsSwitchNotice notice={notice} onClose={()=>setNotice(null)}/>,document.body)}
    <div><strong>Interlock Tandon Air</strong></div>
    <button className={`switch ${view?.enabled!==false?'is-on':''}`} type="button" role="switch"
      aria-label="Interlock tandon air" aria-checked={view?.enabled??true} aria-busy={busy}
      aria-haspopup="dialog" disabled={!admin||!connected||!deviceId||busy} onClick={show}><span/></button>
    {open&&createPortal(<dialog ref={dialog} className="water-interlock-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event=>{if(busyRef.current)event.preventDefault();else setOpen(false)}}
      onClick={event=>{if(event.target===event.currentTarget)close()}}>
      <SettingsSwitchNotice notice={notice} onClose={()=>setNotice(null)}/>
      <h2 id={titleId}>{saved?'Interlock Tandon Air':`${action} interlock tandon air?`}</h2>
      {devices.length>1&&!saved&&<label className="field-label"><span>Perangkat</span>
        <select value={deviceId} disabled={busy} onChange={event=>{setChosen(event.target.value);setProposal(null);setSaveError('')}}>
          {devices.map(device=><option key={device.deviceId} value={device.deviceId}>{device.displayName}</option>)}
        </select></label>}
      <p id={descriptionId}>{saved?status:proposal?.enabled
        ?'Proteksi level tandon air akan diaktifkan. Pompa yang sedang berjalan akan dihentikan saat perubahan diterapkan.'
        :'Pompa air bisa menyala meskipun tandon kosong atau sensor level tidak terbaca. Pompa yang sedang berjalan akan dihentikan saat perubahan diterapkan.'}</p>
      <p className="water-interlock-device">{deviceName}</p>
      {!saved&&view&&!view.capable&&<p>Perangkat belum tersambung atau belum mendukung pengaturan ini. Perubahan akan menunggu perangkat siap.</p>}
      {!view&&!loadError&&<p role="status">Memuat pengaturan…</p>}
      {loadError&&<p role="alert">{loadError}</p>}
      {saveError&&<p role="alert">{saveError}</p>}
      {saved&&<p role="status" aria-live="polite">{rejected?'Periksa perangkat sebelum mencoba kembali.':confirmed&&reported?'Interlock '+(view?.enabled?'aktif.':'nonaktif.'):'Switch belum dianggap diterapkan sampai perangkat mengonfirmasi.'}</p>}
      <div className="water-interlock-dialog-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={close}>{saved?'Tutup':'Batal'}</button>
        {!saved&&<button className="primary-button" type="button" disabled={busy||!connected||!view||!proposal||!!loadError}
          onClick={()=>void confirm()}>{busy?'Menyimpan…':`${action} interlock`}</button>}
      </div>
    </dialog>,document.body)}
  </div>
}
