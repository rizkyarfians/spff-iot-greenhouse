import { useEffect,useRef,useState } from 'react'
import type { ApiDevice,WaterInterlockView } from '@spff/contracts'
import { fetchWaterInterlock,saveWaterInterlock } from './api'

export function WaterInterlockSettings({devices,admin,connected}:{devices:ApiDevice[];admin:boolean;connected:boolean}){
  const [chosen,setChosen]=useState('')
  const deviceId=devices.some(d=>d.deviceId===chosen)?chosen:devices[0]?.deviceId??''
  const [view,setView]=useState<WaterInterlockView|null>(null)
  const [draft,setDraft]=useState(true)
  const [dirty,setDirty]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const dirtyRef=useRef(false),busyRef=useRef(false),generation=useRef(0),requestEpoch=useRef(0),draftRevision=useRef<number|null>(null)
  useEffect(()=>{
    const current=++generation.current
    let cancelled=false,running=false
    setView(null);setDirty(false);dirtyRef.current=false;draftRevision.current=null;setError('');setNotice('')
    if(!deviceId)return
    const refresh=async()=>{
      if(running||busyRef.current)return;running=true;const epoch=requestEpoch.current
      try{
        const next=await fetchWaterInterlock(deviceId)
        if(!cancelled&&current===generation.current&&epoch===requestEpoch.current){setView(next);setError('');if(!dirtyRef.current)setDraft(next.enabled)}
      }catch(e){if(!cancelled&&epoch===requestEpoch.current)setError(e instanceof Error?e.message:'Gagal membaca interlock')}
      finally{running=false}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000)
    return()=>{cancelled=true;clearInterval(timer)}
  },[deviceId])
  async function save(){
    if(!view||busyRef.current||!admin||!connected)return
    busyRef.current=true;requestEpoch.current++;setBusy(true);setError('');setNotice('')
    const current=generation.current
    try{
      const next=await saveWaterInterlock(deviceId,draftRevision.current??view.revision,draft)
      if(current!==generation.current)return
      setView(next);setDraft(next.enabled);setDirty(false);dirtyRef.current=false;draftRevision.current=null
      setNotice('Tersimpan di server. Status diterapkan menunggu konfirmasi perangkat.')
    }catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Gagal menyimpan interlock')}
    finally{busyRef.current=false;setBusy(false)}
  }
  const confirmed=view?.acknowledgementStatus==='applied'&&view.acknowledgedRevision===view.revision&&view.appliedEnabled===view.enabled
  const reported=view?.online&&view.reportedRevision===view.revision&&view.reportedEnabled===view.enabled
  return <article className="page-card settings-section" aria-label="Interlock tandon air CH3">
    <div className="page-card-header"><h2>Interlock tandon air · CH3</h2></div>
    <label className="field-label"><span>Perangkat</span><select value={deviceId} disabled={busy} onChange={e=>setChosen(e.target.value)}>
      {devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}
    </select></label>
    {!deviceId&&<p>Belum ada perangkat.</p>}
    {view&&<>
      <label style={{display:'flex',alignItems:'center',gap:10}}>
        <input type="checkbox" role="switch" aria-label="Aktifkan interlock tandon air CH3"
          checked={draft} disabled={!admin||!connected||busy||!!error}
          onChange={e=>{if(!dirtyRef.current)draftRevision.current=view.revision;setDraft(e.target.checked);setDirty(true);dirtyRef.current=true;setNotice('')}}/>
        Aktifkan interlock level tandon air
      </label>
      <p>Aktif: CH3 diblokir jika tinggi air ≤20 cm atau sensor tidak valid/terlambat. Terbuka kembali saat tinggi air ≥25 cm dan OFF sudah diverifikasi.</p>
      {!draft&&<p role="alert">Jika dinonaktifkan, proteksi level rendah dan sensor level tidak valid tidak memblokir CH3. Proteksi flow, batas durasi, dan fault output tetap berlaku.</p>}
      <p>Permintaan server: <strong>{view.enabled?'Enabled':'Disabled'}</strong> · revisi {view.revision}</p>
      <p role="status">{view.online&&view.reportedEnabled!==null&&!reported?'Konfigurasi perangkat berbeda; menunggu sinkronisasi':view.acknowledgementStatus==='rejected'?'Ditolak perangkat':confirmed&&reported?'Sudah diterapkan dan dilaporkan perangkat':confirmed?'Pernah dikonfirmasi; menunggu status perangkat terbaru':'Menunggu diterapkan'}
        {view.reason?` · ${view.reason}`:''}</p>
      {view.reportedEnabled!==null&&<p>Laporan perangkat saat ini: {view.reportedEnabled?'Enabled':'Disabled'} · revisi {view.reportedRevision??'—'}</p>}
      {!view.capable&&<p>Perangkat offline atau belum melaporkan dukungan setting ini. Perubahan akan menunggu firmware yang mendukung.</p>}
      {admin&&dirty&&<button type="button" disabled={busy} onClick={()=>{setDraft(view.enabled);setDirty(false);dirtyRef.current=false;draftRevision.current=null;setError('');setNotice('')}}>Batalkan perubahan</button>}
      {admin&&<button type="button" className="primary-button" disabled={!connected||busy||!dirty||!!error} onClick={()=>void save()}>{busy?'Menyimpan…':'Simpan interlock'}</button>}
    </>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </article>
}
