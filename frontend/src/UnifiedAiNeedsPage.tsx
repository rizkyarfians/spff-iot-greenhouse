import {useEffect, useState} from 'react';
import {Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock3, Droplets, FlaskConical, Leaf, RefreshCw, ShieldAlert} from 'lucide-react';
import type {UnifiedAiDashboard} from '@spff/contracts';
import {fetchUnifiedAiDashboard} from './api';
import './UnifiedAiNeedsPage.css';

const nf = new Intl.NumberFormat('id-ID',{maximumFractionDigits:2});
const show = (n:number|null|undefined,unit='') =>
  typeof n==='number'&&Number.isFinite(n)?`${nf.format(n)}${unit?' '+unit:''}`:'—';
const when = (value:string|null|undefined) => {
  if(!value)return 'Belum ada';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'Waktu tidak valid':new Intl.DateTimeFormat('id-ID',{
    timeZone:'Asia/Jakarta',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit'
  }).format(parsed)+' WIB';
};
const labels:Record<string,string>={
  manual_mode_blocks_automatic_start:'Selector masih Manual; AI tidak boleh menjalankan pompa',
  firmware_external_volume_only_authority_not_implemented:'Kontrol volume pompa eksternal belum tervalidasi',
  validated_planning_configuration_missing:'Profil perhitungan operasional belum dikalibrasi',
  planning_configuration_is_simulation_only:'Profil masih untuk simulasi',
  verified_stock_concentration_missing:'Konsentrasi stok pupuk belum diverifikasi',
  execution_feedback_stale:'Feedback pompa tidak segar',
  execution_feedback_boot_mismatch:'Boot ID feedback tidak cocok',
  execution_feedback_boot_unavailable:'Boot ID belum tersedia',
  execution_feedback_output_unknown:'Status output pompa tidak diketahui',
  execution_feedback_unavailable:'Belum ada feedback pompa',
  device_busy_faulted_or_pumps_not_verified_off:'Controller sibuk/fault atau pompa belum terkonfirmasi OFF',
  sensor_data_stale_or_missing:'Data sensor terlambat atau tidak tersedia',
  device_status_stale_or_offline:'Status ESP32 terlambat atau offline',
  outstanding_obligation_requires_review:'Kewajiban pemupukan perlu rekonsiliasi',
  guide_program_source_not_ready:'Program tanaman belum tersedia atau belum kompatibel',
  invalid_water_level_sensor:'Sensor tandon air belum valid',
};
const reasonLabel=(value:string)=>labels[value]??value.replaceAll('_',' ');

export function UnifiedAiNeedsPage(){
  const [data,setData]=useState<UnifiedAiDashboard|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [programId,setProgramId]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    let pending=false;
    async function refresh(){
      if(pending)return;
      pending=true;
      try{
        const response=await fetchUnifiedAiDashboard(abort.signal);
        if(abort.signal.aborted)return;
        setData(response);
        setError('');
      }catch(e){
        if(abort.signal.aborted)return;
        // A failed refresh must never leave the previous sample looking live.
        setData(null);
        setError(e instanceof Error?e.message:'Laporan Unified AI tidak dapat dimuat.');
      }finally{
        pending=false;
        if(!abort.signal.aborted)setLoading(false);
      }
    }
    void refresh();
    const interval=setInterval(()=>void refresh(),15000);
    return()=>{abort.abort();clearInterval(interval)};
  },[retry]);

  const current=data?.status==='CURRENT';
  const selected=data?.programs.find(p=>p.program_id===programId)??data?.programs[0];
  const plan=data?.calculation;
  const feedback=data?.feedback;
  return <section className="secondary-page ai-needs-page" aria-label="AI dan kebutuhan tanaman">
    <div className="ain-hero">
      <div>
        <span className="ain-eyebrow"><Leaf size={14}/> UNIFIED ADAPTIVE AI</span>
        <h2>AI &amp; Kebutuhan Tanaman</h2>
        <p>Rekomendasi dan kebutuhan dari program SPFF serta perhitungan Python AI. Hasil ini bukan perintah ke pompa.</p>
      </div>
      <div className="ain-hero-side">
        <span className="ain-mode"><ShieldAlert size={14}/> SHADOW MODE · Tidak mengontrol pompa</span>
        <button type="button" className="ain-refresh" onClick={()=>{setLoading(true);setRetry(n=>n+1)}}><RefreshCw size={16}/> Muat ulang</button>
      </div>
    </div>

    {loading&&!data&&!error?<div className="ain-notice" role="status">Memuat data dan perhitungan AI…</div>:null}
    {error?<div className="ain-notice ain-error" role="alert"><AlertTriangle size={17}/> {error} <span>Pastikan API dan service AI lokal berjalan.</span></div>:null}
    {!error&&data&&data.status!=='CURRENT'?<div className="ain-notice ain-warning" role="status">
      <AlertTriangle size={17}/>
      {data?.status==='STALE'?'Keputusan AI terakhir sudah stale. Nilai di bawah adalah histori, bukan kondisi saat ini.':'Belum ada keputusan SHADOW dari data SPFF asli. Aktifkan polling sumber hanya setelah konfigurasi diuji.'}
    </div>:null}
    {data&&<>
      <div className="ain-headline-meta">
        <span><Clock3 size={15}/> Keputusan: {when(data.evaluated_at)}</span>
        <span className={current?'ain-state ain-state-good':'ain-state ain-state-warn'}>
          {current?'Data keputusan segar':data.status==='STALE'?'Data keputusan lama':'Belum ada keputusan'}
        </span>
      </div>
      <div className="ain-stat-grid">
        <article className="ain-stat"><span><Droplets size={17}/> Usulan kebutuhan air</span><strong>{show(plan?.water_l,'L')}</strong><small>{current&&plan?.water_l!=null?'Estimasi rencana AI, belum disalurkan':'Belum ada rencana air yang tervalidasi'}</small></article>
        <article className="ain-stat"><span><FlaskConical size={17}/> Usulan larutan stok</span><strong>{show(plan?.stock_l,'L')}</strong><small>{current&&plan?.stock_l!=null?'Dari profil stok yang diverifikasi':'Belum tersedia / konfigurasi HOLD'}</small></article>
        <article className="ain-stat"><span><Leaf size={17}/> Massa pupuk terencana</span><strong>{show(plan?.fertilizer_mass_g,'g')}</strong><small>Perhitungan dosis rencana, bukan realisasi</small></article>
        <article className="ain-stat"><span><Clock3 size={17}/> Estimasi durasi</span><strong>{plan?.duration_seconds==null?'—':show(plan.duration_seconds/60,'menit')}</strong><small>Memerlukan debit pompa terkalibrasi</small></article>
      </div>

      <div className="ain-columns">
        <div className="ain-main-column">
          <article className="ain-panel">
            <div className="ain-panel-heading"><h3><CalendarDays size={18}/> Profil &amp; Jadwal Tanaman</h3><span>Data Panduan SPFF</span></div>
            {data.programs.length?<label className="ain-selector">Program tanaman
              <select value={selected?.program_id??''} onChange={e=>setProgramId(e.target.value)}>
                {data.programs.map(p=><option key={p.program_id} value={p.program_id}>{p.crop_name} · {p.program_id.slice(0,8)}</option>)}
              </select>
            </label>:<p className="ain-muted">Belum ada program Panduan yang tersedia untuk perangkat ini.</p>}
            {selected&&<>
              <div className="ain-profile-grid">
                <div><small>Tanaman</small><strong>{selected.crop_name}</strong></div>
                <div><small>Umur tanaman</small><strong>{selected.current_hst==null?'—':`HST ${selected.current_hst}`}</strong></div>
                <div><small>Populasi</small><strong>{show(selected.plant_count,'tanaman')}</strong></div>
                <div><small>Tanggal tanam</small><strong>{selected.planting_date??'—'}</strong></div>
              </div>
              <div className="ain-activities">
                <h4>Kebutuhan per kegiatan</h4>
                {selected.activities.length===0?<p className="ain-muted">Kegiatan budidaya belum tersedia.</p>:selected.activities.map(a=><div className="ain-activity" key={a.activity_id}>
                  <div className="ain-activity-top"><strong>{a.title}</strong><span>{a.hst==null?'HST belum diatur':`HST ${a.hst}`} · {a.calendar_status}</span></div>
                  <div className="ain-activity-meta">{a.method??'Metode belum dicatat'} · {a.application_date??'Belum dijadwalkan'}</div>
                  {a.reference_water_l!=null&&<p>Air referensi panduan: <strong>{show(a.reference_water_l,'L')}</strong> (bukan hasil Fuzzy)</p>}
                  {a.manually_completed&&<p className="ain-note">Dicatat selesai manual; volume dan dosis fisik belum otomatis terbukti.</p>}
                  {a.products.length===0?<p className="ain-muted">Produk belum tersedia.</p>:a.products.map((product,i)=><div className="ain-product" key={`${a.activity_id}-${product.source_row??i}`}>
                    <div><strong>{product.product}</strong><small>{product.is_fertilizer?'Pupuk':'Produk panduan lain'}</small></div>
                    <div><small>Kebutuhan panduan</small><strong>{show(product.amount,product.unit??'')}</strong></div>
                    <div><small>Kredit AI terverifikasi*</small><strong>{product.credited_mass_g==null?'Belum ada bukti':show(product.credited_mass_g,'g')}</strong></div>
                    <div><small>Sisa terukur</small><strong>{product.remaining_mass_g==null?'Belum pasti':show(product.remaining_mass_g,'g')}</strong></div>
                    {product.credited_mass_g!=null&&product.target_mass_g!=null&&product.target_mass_g>0&&!product.requires_review&&
                      <div className="ain-progress" aria-label={`Progres kredit sesi AI untuk ${product.product}`}>
                        <progress max={product.target_mass_g} value={Math.min(product.target_mass_g,product.credited_mass_g)}/>
                        <small>{show(product.credited_mass_g/product.target_mass_g*100,'%')} dari target terkredit di ledger AI, bukan bukti pompa fisik</small>
                      </div>}
                    {product.requires_review&&<p className="ain-note">Perlu rekonsiliasi; jangan menganggap program sudah terpenuhi.</p>}
                  </div>)}
                </div>)}
              </div>
              <p className="ain-footnote">* Kredit berasal dari sesi yang terikat dan lolos pemeriksaan AI, bukan catatan manual atau telemetry kumulatif. Nol tidak dianggap terbukti bila sesi belum terverifikasi.</p>
            </>}
          </article>
        </div>
        <div className="ain-side-column">
          <article className="ain-panel">
            <div className="ain-panel-heading"><h3><Activity size={18}/> Kondisi &amp; Keputusan AI</h3></div>
            <div className="ain-decision">
              <small>Rekomendasi</small><strong>{data.decision.proposed_action??'Belum ada'}</strong>
              <small>Hasil final</small><b>{current?data.decision.type??'HOLD':'HOLD · Data tidak segar'}</b>
            </div>
            <h4>Alasan / hambatan</h4>
            {data.decision.hold_reasons.length?<ul className="ain-reasons">{data.decision.hold_reasons.map(reason=><li key={reason}>{reasonLabel(reason)}</li>)}</ul>:<p className="ain-muted">Belum ada alasan tersimpan. AI tetap tidak memiliki akses dispatch.</p>}
          </article>
          <article className="ain-panel">
            <div className="ain-panel-heading"><h3><CheckCircle2 size={18}/> Sensor &amp; Feedback</h3></div>
            <dl className="ain-details">
              <div><dt>Kelembapan tanah 1</dt><dd>{data.sensors.soil_1_valid===true?show(data.sensors.soil_moisture_pct,'%'):data.sensors.soil_1_valid===false?'Tidak valid / stale':'Belum terverifikasi'}</dd></div>
              <div><dt>Kelembapan tanah 2</dt><dd>{data.sensors.soil_2_valid===true?show(data.sensors.soil_2_moisture_pct,'%'):data.sensors.soil_2_valid===false?'Tidak valid / stale':'Belum terverifikasi'}</dd></div>
              <div><dt>Sumber kontrol air</dt><dd>{data.sensors.control_moisture_source==='soil_1_moisture'?'Sensor tanah 1':data.sensors.control_moisture_source==='soil_2_moisture'?'Sensor tanah 2':'Belum terkonfirmasi'}</dd></div>
              <div><dt>Tandon air</dt><dd>{show(data.sensors.water_tank_pct,'%')}</dd></div>
              <div><dt>Tandon pupuk</dt><dd>{show(data.sensors.stock_tank_pct,'%')}</dd></div>
              <div><dt>Mode selector</dt><dd>{data.sensors.device_mode??'Tidak diketahui'}</dd></div>
              <div><dt>Feedback</dt><dd>{current?feedback?.status??'Tidak tersedia':'Stale / tidak ada'}</dd></div>
              <div><dt>Boot cocok</dt><dd>{current&&feedback?.boot_matches?'Ya':'Belum terverifikasi'}</dd></div>
              <div><dt>Pompa air</dt><dd>{current&&(feedback?.water_pump===true||feedback?.water_pump===false)?(feedback?.water_pump?'Reported ON':'Reported OFF'):'Tidak diketahui'}</dd></div>
              <div><dt>Pompa pupuk</dt><dd>{current&&(feedback?.fert_pump===true||feedback?.fert_pump===false)?(feedback?.fert_pump?'Reported ON':'Reported OFF'):'Tidak diketahui'}</dd></div>
              <div><dt>Sensor tercatat</dt><dd>{when(data.sensors.recorded_at)}</dd></div>
            </dl>
            <p className="ain-footnote">Sensor valid berarti lolos diagnostik sumber pada snapshot keputusan, bukan jaminan data masih segar sekarang. Sensor 2 tidak otomatis menggantikan Sensor 1 untuk kontrol. Status pompa berasal dari laporan output ESP32, bukan sensor kontak relay independen.</p>
          </article>
          <article className="ain-panel">
            <div className="ain-panel-heading"><h3>Dasar perhitungan</h3></div>
            <dl className="ain-details">
              <div><dt>Fuzzy score</dt><dd>{show(plan?.fuzzy_score)}</dd></div>
              <div><dt>Profil perhitungan</dt><dd>{data.decision.configuration_version??'Belum dikalibrasi'}</dd></div>
              <div><dt>Sumber data</dt><dd>PostgreSQL lokal</dd></div>
              <div><dt>Status eksekusi</dt><dd>Tidak diizinkan</dd></div>
            </dl>
            <p className="ain-footnote">{data.note}</p>
          </article>
        </div>
      </div>
    </>}
  </section>;
}
