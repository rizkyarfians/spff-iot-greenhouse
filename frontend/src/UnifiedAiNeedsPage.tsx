import {useEffect, useState} from 'react';
import {Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock3, Droplets, FlaskConical, Leaf, RefreshCw, ShieldAlert} from 'lucide-react';
import type {UnifiedAiDashboard} from '@spff/contracts';
import {fetchUnifiedAiDashboard} from './api';
import {aiCalculationReadiness} from './aiCalculationReadiness';
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
const fuzzyPreviewReasons:Record<string,string>={
  no_source_decision:'Belum ada keputusan sumber asli yang tersimpan.',
  simulation_profile_unavailable:'Profil simulasi Fuzzy belum tersedia atau bukan profil simulasi.',
  control_source_not_selected:'Konfigurasi sensor pengendali air belum dapat ditentukan.',
  selected_sensor_value_missing:'Nilai sensor terpilih kosong atau tidak berada dalam rentang 0–100%.',
  selected_sensor_health_invalid:'Diagnostik sensor terpilih belum menandainya valid.',
  sensor_control_diagnostic_rejected:'Sensor tidak lulus diagnostik untuk kontrol.',
  sensor_raw_poll_not_verified:'Bukti pembacaan Modbus terbaru belum lengkap: rawFresh/lastPollOk.',
  sensor_poll_boot_missing:'Identitas boot pembacaan sensor belum tersedia.',
  sensor_raw_value_unverified:'Nilai register mentah tidak tersedia atau tidak cocok dengan nilai kelembapan.',
  sensor_raw_age_unverified:'Umur pembacaan register mentah tidak tersedia atau lebih dari 60 detik.',
  control_config_not_acknowledged:'Revisi konfigurasi sumber sensor belum dikonfirmasi perangkat.',
  sensor_timestamp_missing:'Timestamp sensor tidak tersedia atau tidak valid.',
  simulation_rules_invalid:'Aturan atau fungsi Fuzzy simulasi gagal dihitung.'
};

export function UnifiedAiNeedsPage(){
  const [data,setData]=useState<UnifiedAiDashboard|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [programId,setProgramId]=useState('');
  const [activityId,setActivityId]=useState('');
  const [productRow,setProductRow]=useState('');
  const [concentrationText,setConcentrationText]=useState('');
  const [waterText,setWaterText]=useState('');
  const activeProgram=data?.programs.find(p=>p.program_id===programId)??data?.programs[0];
  const activeActivity=activeProgram?.activities.find(a=>a.activity_id===activityId)??activeProgram?.activities[0];
  const activeProgramId=activeProgram?.program_id;
  const activeActivityId=activeActivity?.activity_id;
  const waterInputValid=waterText.trim()!==''&&Number.isFinite(Number(waterText))&&Number(waterText)>0&&Number(waterText)<=1000000;
  useEffect(()=>{
    const abort=new AbortController();
    let pending=false;
    async function refresh(){
      if(pending)return;
      pending=true;
      try{
        const concentration=Number(concentrationText);
        const validConcentration=concentrationText.trim()!==''&&Number.isFinite(concentration)&&concentration>=0.000001&&concentration<=1000000;
        const temporaryWater=waterInputValid&&activeActivity?.reference_water_l==null&&activeProgramId&&activeActivityId
          ?{liters:Number(waterText),programId:activeProgramId,activityId:activeActivityId}
          :undefined;
        const response=await fetchUnifiedAiDashboard(
          abort.signal, validConcentration?concentration:undefined, temporaryWater
        );
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
  },[retry,concentrationText,waterText,waterInputValid,activeProgramId,activeActivityId,activeActivity?.reference_water_l]);

  const current=data?.status==='CURRENT';
  const selected=data?.programs.find(p=>p.program_id===programId)??data?.programs[0];
  const plan=data?.calculation;
  const selectedActivity=selected?.activities.find(a=>a.activity_id===activityId)??selected?.activities[0];
  const guideCalc=selectedActivity?.planning_preview;
  const hasGuide=!!selectedActivity;
  const productOptions=guideCalc?.product_options??[];
  const chosenProduct=productOptions.find(p=>String(p.source_row)===productRow)??(productOptions.length===1?productOptions[0]:undefined);
  const isFoliar=selectedActivity?.method?.toLowerCase().includes('semprot')||selectedActivity?.title?.toLowerCase().includes('foliar');
  const waterInvalid=waterText.trim()!==''&&!waterInputValid;
  const concentrationInvalid=concentrationText.trim()!==''&&(!Number.isFinite(Number(concentrationText))||Number(concentrationText)<0.000001||Number(concentrationText)>1000000);
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
      <article className="ain-panel ain-planning-controls" aria-label="Kalkulator kebutuhan dari Panduan">
        <div className="ain-panel-heading">
          <h3><CalendarDays size={18}/> Kalkulator kebutuhan dari Panduan SPFF</h3>
          <span>PERENCANAAN · Tidak mengendalikan pompa</span>
        </div>
        <div className="ain-planning-fields">
          <label>Program tanaman
            <select value={selected?.program_id??''} onChange={e=>{setProgramId(e.target.value);setActivityId('');setProductRow('')}}>
              {data.programs.map(p=><option key={p.program_id} value={p.program_id}>{p.crop_name}</option>)}
            </select>
          </label>
          <label>Kegiatan
            <select value={selectedActivity?.activity_id??''} onChange={e=>{setActivityId(e.target.value);setProductRow('')}} disabled={!selected?.activities.length}>
              {(selected?.activities??[]).map(a=><option key={a.activity_id} value={a.activity_id}>{a.title} · HST {a.hst??'—'}</option>)}
            </select>
          </label>
          <label>Produk pupuk (satu per perhitungan)
            <select value={chosenProduct?.source_row==null?'':String(chosenProduct.source_row)} onChange={e=>setProductRow(e.target.value)} disabled={!productOptions.length}>
              {productOptions.length!==1&&<option value="">Pilih satu pupuk</option>}
              {productOptions.map((p,i)=><option key={p.source_row??i} value={p.source_row??''}>{p.product} · {show(p.mass_g,'g')}</option>)}
            </select>
          </label>
          {selectedActivity?.reference_water_l==null&&<label>Volume larutan akhir rencana (L)
            <input type="number" min="0.001" max="1000000" step="any" value={waterText}
              onChange={e=>setWaterText(e.target.value)} placeholder="Isi volume rencana untuk kegiatan ini"/>
          </label>}
          <label>Konsentrasi larutan stok (g/L)
            <input type="number" min="0.000001" max="1000000" step="any" value={concentrationText} onChange={e=>setConcentrationText(e.target.value)} placeholder="Isi konsentrasi stok aktual"/>
          </label>
        </div>
        {waterInvalid&&<p className="ain-note">Volume rencana harus angka positif maksimal 1.000.000 L; nilai tidak valid tidak dikirim.</p>}
        {concentrationInvalid&&<p className="ain-note">Konsentrasi harus angka positif maksimal 1.000.000 g/L. Nilai tidak valid tidak dikirim.</p>}
        {productOptions.length>1&&<p className="ain-note">Kegiatan ini berisi beberapa jenis pupuk. Pilih satu produk untuk menghitung dosis; tidak digabung sebagai campuran.</p>}
        {isFoliar&&<p className="ain-note">Kegiatan ini menggunakan metode foliar/semprot di Panduan. Nilai hanya referensi matematika, bukan perintah mengalihkan aplikasi semprot menjadi fertigasi Venturi.</p>}
        <p className="ain-footnote">Jika Panduan belum punya volume air, isian volume di sini hanya asumsi perencanaan untuk kegiatan yang dipilih, bukan data Panduan dan tidak disimpan. Hitungan lain berasal dari kebutuhan per kegiatan pada Panduan. Estimasi waktu menggunakan histori counter flowmeter yang belum dikalibrasi. Nilai konsentrasi hanya digunakan untuk kalkulasi sesaat dan tidak disimpan. Tidak ada perintah pompa atau perubahan dosis di ledger.</p>
      </article>
      <div className="ain-stat-grid">
        <article className="ain-stat"><span><Droplets size={17}/> {hasGuide?'Larutan akhir Panduan':'Usulan kebutuhan air'}</span><strong>{show(hasGuide?guideCalc?.water_l:plan?.water_l,'L')}</strong><small>{hasGuide?(guideCalc?.water_source==='OPERATOR_INPUT'?'Volume sementara yang lo isi; bukan data Panduan': 'Volume referensi per kegiatan; belum tersalurkan'):current&&plan?.water_l!=null?'Rencana AI, belum disalurkan':'Belum tersedia'}</small></article>
        <article className="ain-stat"><span><FlaskConical size={17}/> Volume stok terhitung</span><strong>{show(hasGuide?chosenProduct?.stock_l:plan?.stock_l,'L')}</strong><small>{hasGuide?'Massa pupuk ÷ konsentrasi yang diisi; bukan volume aktual':'Belum tersedia / HOLD'}</small></article>
        <article className="ain-stat"><span><Leaf size={17}/> Massa pupuk Panduan</span><strong>{show(hasGuide?chosenProduct?.mass_g:plan?.fertilizer_mass_g,'g')}</strong><small>{hasGuide?'Target satu pupuk pada kegiatan, bukan sisa atau realisasi':'Rencana AI, bukan realisasi'}</small></article>
        <article className="ain-stat"><span><Clock3 size={17}/> Estimasi waktu aliran air</span><strong>{show(hasGuide?guideCalc?.water_duration_minutes:plan?.duration_seconds==null?null:plan.duration_seconds/60,'menit')}</strong><small>{hasGuide?'Hanya estimasi dari debit historis, bukan waktu pompa tervalidasi':'Memerlukan debit terkalibrasi'}</small></article>
      </div>
      {hasGuide&&<article className="ain-panel ain-planning-evidence" aria-label="Bukti perhitungan referensi">
        <div className="ain-panel-heading"><h3><Activity size={18}/> Dasar hitungan</h3><span>HISTORI · BELUM KALIBRASI</span></div>
        <div className="ain-fuzzy-preview-grid">
          <div><small>Referensi debit air</small><strong>{show(guideCalc?.flow_reference?.water_lpm,'L/menit')}</strong><small>Dari interval positif historis</small></div>
          <div><small>Referensi debit stok</small><strong>{show(guideCalc?.flow_reference?.stock_lpm,'L/menit')}</strong><small>Bukan nilai hisap Venturi terkalibrasi</small></div>
          <div><small>Estimasi waktu hisap stok</small><strong>{show(chosenProduct?.stock_duration_minutes,'menit')}</strong><small>Dihitung terpisah, bukan dijumlahkan dengan waktu air</small></div>
        </div>
        {guideCalc?.flow_reference&&<p className="ain-footnote">Referensi dari {when(guideCalc.flow_reference.started_at)} sampai {when(guideCalc.flow_reference.ended_at)}, {guideCalc.flow_reference.interval_count} interval. Volume air dan stok belum dibuktikan lewat pengukuran fisik.</p>}
        {!!guideCalc?.reasons.length&&<ul className="ain-reasons">{guideCalc.reasons.map(reason=><li key={reason}>{({
          fertilizer_mass_needs_review:'Kebutuhan massa pupuk perlu ditinjau.',
          multiple_fertilizers_not_combined:'Ada beberapa pupuk; dosis tidak digabung.',
          no_fertilizer_product:'Kegiatan ini tidak mencantumkan pupuk.',
          guide_reference_water_missing:'Panduan belum memiliki volume larutan akhir.',
          historical_water_rate_unavailable:'Belum ada referensi debit air historis yang memenuhi syarat.',
          historical_stock_rate_unavailable:'Belum ada referensi debit stok historis yang memenuhi syarat.',
          stock_concentration_not_provided:'Isi konsentrasi stok untuk menghitung volume larutan.'
        } as Record<string,string>)[reason]??reason}</li>)}</ul>}
      </article>}
      {data.fuzzy_preview&&<article className="ain-panel ain-fuzzy-preview" aria-label="Pratinjau Fuzzy simulasi">
        <div className="ain-panel-heading">
          <h3><Activity size={18}/> Hasil hitung Fuzzy — simulasi</h3>
          <span>SIMULASI · Bukan rekomendasi operasional</span>
        </div>
        <div className="ain-fuzzy-preview-grid">
          <div><small>Kelembapan sumber</small><strong>{show(data.fuzzy_preview.moisture_pct,'%')}</strong><small>{data.fuzzy_preview.input_key==='soil_2_moisture'?'Sensor Tanah 2':'Sensor Tanah 1'}</small></div>
          <div><small>Skor centroid Mamdani</small><strong>{show(data.fuzzy_preview.score)}</strong><small>Skala 0–1</small></div>
          <div><small>Volume ilustratif model</small><strong>{show(data.fuzzy_preview.illustrative_water_l,'L')}</strong><small>Bukan volume siram yang disetujui</small></div>
        </div>
        <p className="ain-footnote">Dihitung memakai profil {data.fuzzy_preview.config_version}, dengan batas model {show(data.fuzzy_preview.model_max_irrigation_l,'L')}; input sensor tercatat {when(data.fuzzy_preview.recorded_at)}. Hanya untuk memeriksa fungsi matematis Fuzzy. Tidak memperhitungkan kesiapan pompa, debit aktual, kebutuhan agronomis terkalibrasi, atau kewajiban pemupukan. Status keputusan tetap {data.status}; tidak mengubah HOLD dan tidak mengirim perintah.</p>
      </article>}
      {!data.fuzzy_preview&&<article className="ain-panel ain-fuzzy-preview" aria-label="Status pratinjau Fuzzy">
        <div className="ain-panel-heading">
          <h3><Activity size={18}/> Hasil hitung Fuzzy — simulasi</h3>
          <span>SIMULASI · Tidak untuk kontrol pompa</span>
        </div>
        <p className="ain-muted">Angka belum bisa dihitung dari snapshot keputusan ini. Berikut pemeriksaan input dan alasan yang tercatat:</p>
        <ul className="ain-reasons">
          {data.fuzzy_preview_blockers.length>0?
            data.fuzzy_preview_blockers.map(reason=><li key={reason}>{fuzzyPreviewReasons[reason]??reason}</li>):
            <li>Belum ada alasan terperinci; periksa versi Python AI staging dan shared contract.</li>}
        </ul>
        <p className="ain-footnote">Status {data.status}. Pemeriksaan ini hanya membaca data tersimpan; tidak mengaktifkan Fuzzy operasional, mengubah mode Manual, atau menjalankan pompa.</p>
      </article>}
      {aiCalculationReadiness(data).length>0&&<article className="ain-notice ain-calculation-explanation" aria-label="Mengapa perhitungan belum tersedia">
        <div className="ain-calculation-intro"><AlertTriangle size={17}/><strong>Mengapa nilai AI belum muncul?</strong></div>
        <ul className="ain-reasons">{aiCalculationReadiness(data).map(reason=><li key={reason}>{reason}</li>)}</ul>
        <p>Data sensor yang valid dan kebutuhan dalam Panduan bukan otomatis bukti adanya hasil Fuzzy atau rencana dosis. Angka akan ditampilkan hanya setelah dihitung dan tersimpan dengan sumber yang jelas.</p>
      </article>}

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
