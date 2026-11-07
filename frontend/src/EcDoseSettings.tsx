import {useEffect,useRef,useState} from 'react';
import type {ApiDevice,EcDoseSettings as Settings} from '@spff/contracts';
import {fetchEcDoseSettings,saveEcDoseSettings} from './api';
import {Check, ChevronDown, FlaskConical, Save, SlidersHorizontal} from 'lucide-react';
import './EcDoseSettings.css';
import {SettingChoice} from './SettingChoice';

export function EcDoseSettings({devices,editable}:{devices:ApiDevice[];editable:boolean}) {
  const [selected,setSelected]=useState('');
  const device=devices.some(d=>d.deviceId===selected)?selected:devices[0]?.deviceId??'';
  const [product,setProduct]=useState('Phonska plus');
  const [data,setData]=useState<Settings|null>(null);
  const [coefficient,setCoefficient]=useState('');
  const [reference,setReference]=useState('');
  const [validated,setValidated]=useState(false);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),saving=useRef(false);
  useEffect(()=>{
    const current=++generation.current,abort=new AbortController();
    setData(null);setCoefficient('');setReference('');setValidated(false);setError('');setNotice('');
    if(!device)return;
    setLoading(true);
    void fetchEcDoseSettings(device,product,abort.signal).then(next=>{
      if(generation.current!==current||abort.signal.aborted)return;
      setData(next);setCoefficient(next.profile?String(next.profile.coefficient):'');
      setReference(next.profile?.calibrationReference??'');setValidated(next.profile?.validated??false);
    }).catch(e=>{if(!abort.signal.aborted&&generation.current===current)setError(e instanceof Error?e.message:'Gagal memuat kalibrasi.');})
      .finally(()=>{if(generation.current===current&&!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[device,product]);
  async function save(e:React.FormEvent) {
    e.preventDefault();if(saving.current||!editable||!data||loading)return;
    saving.current=true;setBusy(true);setError('');setNotice('');
    const current=generation.current;
    try {
      const k=Number(coefficient);
      if(!coefficient.trim()||!Number.isFinite(k)||k<=0)throw new Error('Isi K dengan angka positif.');
      if(validated&&!reference.trim())throw new Error('Isi referensi hasil kalibrasi.');
      const next=await saveEcDoseSettings(device,{product,coefficient:k,validated,calibrationReference:reference,
        expectedRevision:data.profile?.revision??0});
      if(generation.current===current){setData(next);setNotice('Kalibrasi tersimpan.');}
    }catch(e){if(generation.current===current)setError(e instanceof Error?e.message:'Gagal menyimpan kalibrasi.');}
    finally{saving.current=false;setBusy(false);}
  }
  return <article className="page-card ecd-card" aria-label="Estimasi gram pupuk berbasis EC">
    <header className="ecd-header">
      <span className="ecd-icon"><FlaskConical size={23}/></span>
      <div><h3>Kalibrasi dosis pupuk</h3><p>Estimasi gram dari EC dan aliran sensor.</p></div>
      <span className={`ecd-badge ${data?.profile?.validated?'is-verified':''}`}>
        {loading?'Memuat…':data?.profile?.validated?'Terverifikasi':'Estimasi'}
      </span>
    </header>
    <form className="ecd-form" onSubmit={e=>void save(e)}>
      <fieldset disabled={busy||!editable}>
        <legend className="ecd-sr-only">Profil kalibrasi EC</legend>
        <div className="ecd-grid">
        <label>Perangkat<select value={device} onChange={e=>setSelected(e.target.value)}>
          {devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.deviceId}</option>)}
        </select></label>
        <label>Formulasi pupuk<select value={product} onChange={e=>setProduct(e.target.value)}>
          <option>Phonska</option><option>Phonska plus</option>
        </select></label>
        <label>Koefisien K<input type="number" min="0.000001" step="any" required
          disabled={loading} placeholder="Contoh: 6400" value={coefficient} onChange={e=>setCoefficient(e.target.value)}/><small>(µS/cm)/(g/L) · sesuai hasil kalibrasi</small></label>
        <label>Referensi kalibrasi<input maxLength={500} disabled={loading} placeholder="Dokumen atau catatan pengujian" value={reference} onChange={e=>setReference(e.target.value)}/></label>
        </div>
        <div className="ecd-verification">
          <span><strong>Kalibrasi terverifikasi</strong><small>Izinkan estimasi menentukan fase pupuk terpenuhi.</small></span>
          <SettingChoice label="Kalibrasi terverifikasi" value={validated} disabled={loading||busy||!editable} onChange={setValidated}/>
        </div>
      </fieldset>
      {data?.baseline&&<div className="ecd-baseline"><span>Baseline EC terakhir</span><strong>{data.baseline.ecUsCm.toLocaleString('id-ID')} <small>µS/cm</small></strong><time>{new Date(data.baseline.recordedAt).toLocaleString('id-ID')}</time></div>}
      <details className="ecd-details"><summary><SlidersHorizontal size={16}/> Cara perhitungan <ChevronDown size={16}/></summary>
        <div><p>EC, flow, dan waktu dari sensor. Target gram dan jumlah tanaman dari program HST.</p>
        <p>Baseline memakai 3 pembacaan EC stabil saat air mengalir dan pupuk OFF sebelum sesi.</p>
        <p>K 6400 pada dokumen adalah contoh satu titik. Gunakan hasil kalibrasi yang sesuai; tanpa verifikasi, hasil hanya estimasi.</p>
        <p>Perubahan K berlaku untuk fase berikutnya. Verifikasi K yang sama dapat diterapkan pada fase berjalan.</p></div>
      </details>
      {error&&<p className="ecd-message is-error" role="alert">{error}</p>}{notice&&<p className="ecd-message" role="status"><Check size={16}/>{notice}</p>}
      <footer className="ecd-footer"><span>{!editable?'Hanya admin dapat mengubah kalibrasi.':'Disimpan per perangkat dan formulasi pupuk.'}</span>
      {editable&&<button className="ecd-save" type="submit" disabled={busy||loading||!data}><Save size={17}/>{busy?'Menyimpan…':'Simpan kalibrasi'}</button>}</footer>
    </form>
  </article>;
}
