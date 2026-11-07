import {useEffect,useRef,useState} from 'react';
import type {ApiDevice,EcDoseSettings as Settings} from '@spff/contracts';
import {fetchEcDoseSettings,saveEcDoseSettings} from './api';

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
  return <article className="page-card" aria-label="Estimasi gram pupuk berbasis EC">
    <h3>Estimasi gram pupuk dari EC</h3>
    <p>EC air, EC campuran, flow, dan waktu dari sensor. Target gram dan jumlah tanaman dari program HST.</p>
    <form className="settings-form" onSubmit={e=>void save(e)}>
      <fieldset disabled={busy||!editable}>
        <label>Perangkat<select value={device} onChange={e=>setSelected(e.target.value)}>
          {devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.deviceId}</option>)}
        </select></label>
        <label>Formulasi pupuk<select value={product} onChange={e=>setProduct(e.target.value)}>
          <option>Phonska</option><option>Phonska plus</option>
        </select></label>
        <label>Koefisien K — (µS/cm)/(g/L)<input type="number" min="0.000001" step="any" required
          disabled={loading} placeholder="Contoh eksperimen dokumen: 6400" value={coefficient} onChange={e=>setCoefficient(e.target.value)}/></label>
        <label>Referensi kalibrasi<input maxLength={500} disabled={loading} value={reference} onChange={e=>setReference(e.target.value)}/></label>
        <label><input type="checkbox" checked={validated} disabled={loading} onChange={e=>setValidated(e.target.checked)}/>
          Kalibrasi formulasi ini sudah diverifikasi; estimasi boleh menentukan fase terpenuhi.</label>
      </fieldset>
      <small>K 6400 di dokumen masih contoh satu titik. Tanpa verifikasi, hasil ditampilkan sebagai estimasi.</small>
      <p>Baseline otomatis membutuhkan 3 pembacaan EC stabil saat air mengalir dan pupuk OFF sebelum sesi.</p>
      {data?.baseline&&<p>Baseline sesi terakhir: {data.baseline.ecUsCm.toLocaleString('id-ID')} µS/cm · {new Date(data.baseline.recordedAt).toLocaleString('id-ID')}</p>}
      <small>K dibekukan saat estimasi fase dimulai. Perubahan K berlaku fase berikutnya; verifikasi K yang sama bisa diterapkan pada fase berjalan.</small>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {editable&&<button type="submit" disabled={busy||loading||!data}>{busy?'Menyimpan…':'Simpan kalibrasi EC'}</button>}
    </form>
  </article>;
}
