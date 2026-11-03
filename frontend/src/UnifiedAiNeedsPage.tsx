import {useEffect, useState} from 'react';
import {Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock3, Droplets, FlaskConical, Leaf, RefreshCw, ShieldAlert} from 'lucide-react';
import type {UnifiedAiDashboard} from '@spff/contracts';
import {fetchUnifiedAiDashboard} from './api';
import {aiCalculationReadiness} from './aiCalculationReadiness';
import './UnifiedAiNeedsPage.css';
import { AiOperatorAccPanel } from './AiOperatorAccPanel';

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
  sensor_snapshot_stale:'Telemetry sensor yang tersimpan sudah lama; tidak digunakan untuk menghasilkan angka Fuzzy baru.',
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
  const selectedActivity=selected?.activities.find(a=>a.activity_id===activityId)??selected?.activities[0];
  const guideCalc=selectedActivity?.planning_preview;
  const hasGuide=!!selectedActivity;
  const productOptions=guideCalc?.product_options??[];
  const chosenProduct=productOptions.find(p=>String(p.source_row)===productRow)??(productOptions.length===1?productOptions[0]:undefined);
  const isFoliar=selectedActivity?.method?.toLowerCase().includes('semprot')||selectedActivity?.title?.toLowerCase().includes('foliar');
  const fuzzyWater=data?.fuzzy_preview?.illustrative_water_l;
  const waterRate=data?.flow_reference?.water_lpm;
  const fuzzyDuration=fuzzyWater!=null&&waterRate!=null&&waterRate>0?fuzzyWater/waterRate:null;
  const tank=data?.tank_preview;
  const tankReady=tank?.level_status==='ESTIMATED';
  const tankStatusText=tank?.level_status==='ESTIMATED'?'Estimasi volume tersedia':
    tank?.level_status==='STALE'?'Telemetry tandon sudah lama':
    tank?.level_status==='OUT_OF_RANGE'?'Persentase level di luar batas':
    tank?.level_status==='UNVERIFIED'?'Sensor level belum tervalidasi':
    tank?.level_status==='ORIENTATION_CONFLICT'?'Persentase level tidak cocok dengan tinggi cairan yang dikirim MQTT Worker':
    'Data tandon belum tersedia';
  const fertilizerTank=data?.fertilizer_tank_preview;
  const fertilizerTankReady=fertilizerTank?.level_status==='ESTIMATED';
  const irrigationSchedule=data?.irrigation_schedule_preview;
  const dateLabel=(date:string|undefined)=>date?new Intl.DateTimeFormat('id-ID',{
    day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'
  }).format(new Date(`${date}T12:00:00+07:00`)):'—';
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

    <AiOperatorAccPanel report={data}/>
    {loading&&!data&&!error?<div className="ain-notice" role="status">Memuat data dan perhitungan AI…</div>:null}
    {error?<div className="ain-notice ain-error" role="alert"><AlertTriangle size={17}/> {error} <span>Pastikan API dan service AI lokal berjalan.</span></div>:null}
    {!error&&data&&data.status!=='CURRENT'?<div className="ain-notice ain-warning" role="status">
      <AlertTriangle size={17}/>
      {data?.status==='STALE'?'Keputusan kontrol AI terakhir sudah lama. Perencanaan hanya memakai telemetry PostgreSQL terbaru yang lolos pemeriksaan terpisah.':'Belum ada keputusan SHADOW tersimpan. Perhitungan simulasi yang tersedia tetap terpisah dari keputusan kontrol.'}
    </div>:null}
      {data&&data.planning_status!=='CURRENT'&&<div className="ain-notice ain-warning" role="status"><AlertTriangle size={16}/> Telemetry untuk perencanaan {data.planning_status==='STALE'?'sudah lama':'belum tersedia'}. Hasil Fuzzy tidak akan diganti dengan data sensor lama.</div>}
    {data&&<>
      <div className="ain-headline-meta">
        <span><Clock3 size={15}/> Sensor perencanaan: {when(data.planning_recorded_at)} · {data.planning_source==='POSTGRES_READ_ONLY'?'PostgreSQL lokal':'Snapshot keputusan'}</span>
      </div>
      <div className="ain-headline-meta">
        <span><Clock3 size={15}/> Keputusan: {when(data.evaluated_at)}</span>
        <span className={current?'ain-state ain-state-good':'ain-state ain-state-warn'}>
          {current?'Data keputusan segar':data.status==='STALE'?'Data keputusan lama':'Belum ada keputusan'}
        </span>
      </div>
      {(tank?.capacity_l!==5000||fertilizerTank?.capacity_l!==500)&&<div className="ain-notice ain-warning" role="alert">
        <AlertTriangle size={17}/> Kapasitas konfigurasi AI staging belum sesuai konfirmasi operator (air baku 5.000 L, pupuk 500 L). Periksa variabel AI_TANK_CAPACITY_L dan AI_FERT_TANK_CAPACITY_L pada environment service, tanpa mengubah konfigurasi pompa ESP32.
      </div>}
      <article className="ain-panel ain-irrigation-summary" aria-label="Kebutuhan penyiraman Fuzzy terpisah">
        <div className="ain-panel-heading">
          <h3><Droplets size={18}/> Penyiraman · Fuzzy Mamdani</h3>
          <span>SIMULASI · Bukan perintah pompa</span>
        </div>
        {data.fuzzy_preview?
          <>
            <div className="ain-stat-grid">
              <article className="ain-stat"><span><Droplets size={17}/> Volume ilustratif air</span><strong>{show(fuzzyWater,'L')}</strong><small>Tidak otomatis menjadi volume campuran pupuk</small></article>
              <article className="ain-stat"><span><Leaf size={17}/> Kelembapan sumber</span><strong>{show(data.fuzzy_preview.moisture_pct,'%')}</strong><small>{data.fuzzy_preview.input_key==='soil_2_moisture'?'Sensor Tanah 2':'Sensor Tanah 1'}</small></article>
              <article className="ain-stat"><span><Activity size={17}/> Skor Fuzzy</span><strong>{show(data.fuzzy_preview.score)}</strong><small>Centroid Mamdani · Skala 0–1</small></article>
              <article className="ain-stat"><span><Clock3 size={17}/> Estimasi durasi air</span><strong>{show(fuzzyDuration,'menit')}</strong><small>Debit historis belum terkalibrasi, bukan waktu kontrol</small></article>
            </div>
            <p className="ain-footnote">Profil {data.fuzzy_preview.config_version} · data {when(data.fuzzy_preview.recorded_at)}. Ini perkiraan penyiraman mandiri, bukan volume pengencer pupuk. Batas model {show(data.fuzzy_preview.model_max_irrigation_l,'L')}.</p>
          </>:
          <p className="ain-muted">Hasil Fuzzy tidak tersedia dari telemetry yang memenuhi syarat. Alasan ditampilkan pada pemeriksaan input di bawah.</p>}
      </article>
      <article className="ain-panel ain-tank-preview" aria-label="Ketersediaan air baku tandon">
        <div className="ain-panel-heading">
          <h3><Droplets size={18}/> Tandon Air · Estimasi Ketersediaan</h3>
          <span>DATA SENSOR · ESTIMASI LINEAR</span>
        </div>
        <div className="ain-tank-layout">
          <div className="ain-tank-gauge">
            <div className="ain-tank-gauge-head">
              <strong>{show(tank?.reported_level_pct,'%')}</strong>
              <small>Level air dilaporkan</small>
            </div>
            <div className="ain-tank-track" role="img" aria-label={tankReady?`Estimasi level tandon ${show(tank?.reported_level_pct,'%')}`:'Level tandon belum tervalidasi'}>
              {tankReady&&<div className="ain-tank-fill" style={{height:`${tank?.reported_level_pct??0}%`}}/>}
            </div>
            <small className="ain-tank-gauge-caption">{tankStatusText}</small>
          </div>
          <div className="ain-tank-metrics">
            <div><small>Kapasitas nominal</small><strong>{show(tank?.capacity_l,'L')}</strong></div>
            <div><small>Tinggi tandon</small><strong>{show(tank?.tank_height_cm,'cm')}</strong></div>
            <div><small>Estimasi tinggi air</small><strong>{show(tank?.estimated_water_height_cm,'cm')}</strong></div>
            <div><small>Estimasi air tersedia</small><strong>{show(tank?.estimated_available_l,'L')}</strong></div>
            <div><small>Kebutuhan air Fuzzy</small><strong>{show(tank?.fuzzy_demand_l,'L')}</strong></div>
            <div><small>Selisih teoretis setelah Fuzzy</small><strong>{show(tank?.theoretical_balance_l,'L')}</strong></div>
          </div>
        </div>
        {tank?.comparison_status==='ENOUGH_ESTIMATE'&&
          <p className="ain-tank-result"><CheckCircle2 size={17}/> Estimasi air tandon lebih besar atau sama dengan volume Fuzzy. Ini belum berarti aman untuk satu kali siram.</p>}
        {tank?.comparison_status==='BELOW_ESTIMATE'&&
          <p className="ain-note"><AlertTriangle size={16}/> Estimasi air tandon kurang dari ilustrasi kebutuhan Fuzzy. Perlu mempertimbangkan pengisian ulang atau rencana bertahap; tidak ada perintah otomatis ke pompa.</p>}
        {!tankReady&&<p className="ain-note">Perhitungan liter tidak ditampilkan karena {tankStatusText.toLowerCase()}. Persentase yang dilaporkan tidak diperlakukan sebagai volume aktual.</p>}
        <p className="ain-footnote">Kapasitas nominal yang dipakai kalkulasi: {show(tank?.capacity_l,'L')}. Tinggi referensi {show(tank?.tank_height_cm,'cm')} masih mengikuti MQTT Worker dan harus dikonfirmasi di lokasi. Field legacy *_distance_cm berarti tinggi cairan dari dasar, bukan jarak mentah sensor ultrasonik. Konversi ke liter mengasumsikan penampang seragam; tinggi/kapasitas fisik dan dead volume belum dikalibrasi. Bentuk tandon, volume mati, batas cadangan, serta kalibrasi belum diverifikasi. Bukan bukti volume aman untuk pompa.</p>
      </article>
      <article className="ain-panel ain-tank-preview" aria-label="Isi cairan tandon pupuk 500 liter">
        <div className="ain-panel-heading">
          <h3><FlaskConical size={18}/> Tandon Pupuk · Estimasi Isi Cairan</h3>
          <span>DATA SENSOR · BUKAN VOLUME DOSIS PUPUK</span>
        </div>
        <div className="ain-tank-layout">
          <div className="ain-tank-gauge">
            <div className="ain-tank-gauge-head">
              <strong>{show(fertilizerTank?.reported_level_pct,'%')}</strong>
              <small>Level tandon pupuk dilaporkan</small>
            </div>
            <div className="ain-tank-track" role="img" aria-label={fertilizerTankReady?`Estimasi isi tandon pupuk ${show(fertilizerTank?.reported_level_pct,'%')}`:'Level tandon pupuk belum tervalidasi'}>
              {fertilizerTankReady&&<div className="ain-tank-fill" style={{height:`${fertilizerTank?.reported_level_pct??0}%`}}/>}
            </div>
            <small className="ain-tank-gauge-caption">{fertilizerTankReady?'Estimasi isi cairan':'Data tidak tersedia atau belum konsisten'}</small>
          </div>
          <div className="ain-tank-metrics">
            <div><small>Kapasitas nominal</small><strong>{show(fertilizerTank?.capacity_l,'L')}</strong></div>
            <div><small>Tinggi referensi sensor</small><strong>{show(fertilizerTank?.tank_height_cm,'cm')}</strong></div>
            <div><small>Estimasi tinggi cairan</small><strong>{show(fertilizerTank?.estimated_liquid_height_cm,'cm')}</strong></div>
            <div><small>Estimasi isi cairan</small><strong>{show(fertilizerTank?.estimated_liquid_volume_l,'L')}</strong></div>
            <div><small>Validitas data</small><strong>{fertilizerTank?.level_status??'NO_DATA'}</strong></div>
          </div>
        </div>
        {!fertilizerTankReady&&<p className="ain-note">Volume tandon pupuk tidak dihitung jika telemetry terlambat, sensor tidak valid, atau tinggi cairan bertentangan dengan persentase.</p>}
        <p className="ain-footnote">Kapasitas nominal pada perhitungan: {show(fertilizerTank?.capacity_l,'L')}. Tinggi referensi {show(fertilizerTank?.tank_height_cm,'cm')} mengikuti MQTT Worker, belum dikonfirmasi terhadap fisik tandon. Ini hanya perkiraan jumlah cairan di tandon, <strong>bukan</strong> volume larutan stok yang harus didosis, bukan massa pupuk, dan tidak membuktikan konsentrasi g/L. Rumus linear memerlukan kalibrasi. Tidak mengontrol pompa.</p>
      </article>
      <article className="ain-panel ain-irrigation-schedule" aria-label="Usulan penyiraman hari ini dan besok">
        <div className="ain-panel-heading">
          <h3><CalendarDays size={18}/> Penyiraman Bertahap · Hari Ini &amp; Besok</h3>
          <span>ILUSTRASI · Belum menjadi jadwal ESP32</span>
        </div>
        <p className="ain-muted">Jika kebutuhan Fuzzy lebih besar daripada volume air yang mungkin tersedia, kekurangannya menjadi <strong>calon kebutuhan besok</strong>, bukan perintah otomatis menyiram. Besok AI harus membaca ulang kelembapan tanah, level tandon, dan status pompa.</p>
        <div className="ain-irrigation-days">
          <div className="ain-irrigation-day">
            <small>Hari ini · {dateLabel(irrigationSchedule?.today_date)}</small>
            <strong>{show(irrigationSchedule?.today_absolute_max_l,'L')}</strong>
            <span>Maksimum teoretis tanpa memperhitungkan cadangan minimum; belum boleh dieksekusi.</span>
          </div>
          <div className="ain-irrigation-day">
            <small>Besok · {dateLabel(irrigationSchedule?.tomorrow_date)}</small>
            <strong>{show(irrigationSchedule?.tomorrow_at_least_l,'L')}</strong>
            <span>Minimal sisa matematis untuk dievaluasi ulang, bukan jadwal tetap.</span>
          </div>
        </div>
        {irrigationSchedule?.status==='GEOMETRY_ONLY'?<p className="ain-note">Perkiraan dari tinggi cairan telemetry: {show(irrigationSchedule.reported_liquid_height_cm,'cm')}, setara batas geometris {show(irrigationSchedule.illustrative_available_l,'L')} dengan asumsi tinggi referensi 180 cm dari MQTT Worker dan tandon berpenampang seragam. Belum dikalibrasi; belum ada batas cadangan aman yang disetujui.</p>:
          <p className="ain-note">Belum bisa mengusulkan pembagian volume: {irrigationSchedule?.status==='HEIGHT_UNVERIFIED'?'tinggi cairan belum valid':irrigationSchedule?.status==='HEIGHT_OUT_OF_RANGE'?'tinggi cairan di luar kapasitas tandon':irrigationSchedule?.status==='LEVEL_CONFLICT'?'tinggi cairan dan persentase level tidak konsisten':irrigationSchedule?.status==='FUZZY_UNAVAILABLE'?'kebutuhan Fuzzy belum tersedia':'sumber telemetry tidak segar atau tidak tersedia'}.</p>}
        <p className="ain-footnote">Rencana SHADOW ini tidak menyimpan jadwal nyata, tidak mem-publish MQTT, dan tidak mengubah interlock ESP32. Jika tandon tidak terisi besok atau tanah sudah basah, kebutuhan harus dihitung ulang; jangan menjalankan angka sisa secara otomatis.</p>
      </article>
      <article className="ain-panel ain-carryover" aria-label="Catatan sisa penyiraman dari sesi perangkat">
        <div className="ain-panel-heading">
          <h3><CalendarDays size={18}/> Catatan Sisa Penyiraman · Bukti Perangkat</h3>
          <span>LEDGER SHADOW · TANPA EKSEKUSI</span>
        </div>
        {data.water_carryover.status==='NO_PLAN'?
          <p className="ain-muted">Belum ada rencana Fuzzy yang disimpan ke ledger SHADOW. Angka estimasi pembagian hari ini dan besok di atas <strong>belum dianggap terlaksana</strong>, jadi belum ada volume yang dikreditkan. Pencatatan hanya bisa dilakukan setelah ada sesi perangkat air-saja yang selesai dan ditautkan secara eksplisit.</p>:
          <>
            <p className="ain-muted">Rencana dibuat {dateLabel(data.water_carryover.planning_date??undefined)}. {data.water_carryover.status==='CARRY_OVER_REVIEW'||data.water_carryover.status==='REVIEW_REQUIRED'?'Sisa perlu dievaluasi ulang hari ini berdasarkan sensor dan tandon terbaru.':'Tidak otomatis menjadi perintah penyiraman.'}</p>
            <div className="ain-irrigation-days">
              <div className="ain-irrigation-day"><small>Target Fuzzy saat rencana disimpan</small><strong>{show(data.water_carryover.frozen_fuzzy_target_l,'L')}</strong><span>Snapshot SHADOW, bukan target aktuator</span></div>
              <div className="ain-irrigation-day"><small>Volume sesi air dilaporkan perangkat</small><strong>{show(data.water_carryover.device_reported_delivered_l,'L')}</strong><span>{data.water_carryover.credited_session_count} sesi selesai dengan bukti, tetapi debit belum terkalibrasi</span></div>
              <div className="ain-irrigation-day"><small>Sisa untuk dievaluasi ulang</small><strong>{show(data.water_carryover.remaining_for_reassessment_l,'L')}</strong><span>Bukan dosis besok yang disetujui</span></div>
              <div className="ain-irrigation-day"><small>Tinjau ulang paling awal</small><strong>{dateLabel(data.water_carryover.next_review_date??undefined)}</strong><span>Sensor tanah dan tandon wajib diperiksa kembali</span></div>
            </div>
            <p className="ain-footnote">Bukti sesi terakhir: {when(data.water_carryover.last_device_session_at)} · Status ledger: {data.water_carryover.status}. Sesi yang tidak ditautkan tidak mengurangi kebutuhan.</p>
          </>}
        <p className="ain-footnote">Catatan ini hanya untuk perencanaan. Angka berasal dari sesi selesai yang dilaporkan ESP32, bukan hasil kalibrasi volumetrik independen. Tidak ada tombol kontrol pompa, pengiriman MQTT, atau jadwal otomatis.</p>
      </article>
      <article className="ain-panel ain-planning-controls" aria-label="Kalkulator kebutuhan dari Panduan">
        <div className="ain-panel-heading">
          <h3><CalendarDays size={18}/> Pilih kegiatan dan produk dari Panduan</h3>
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
        </div>
        {productOptions.length>1&&<p className="ain-note">Kegiatan ini berisi beberapa jenis pupuk. Pilih satu produk untuk menghitung dosis; tidak digabung sebagai campuran.</p>}
        {isFoliar&&<p className="ain-note">Kegiatan ini menggunakan metode foliar/semprot di Panduan. Nilai hanya referensi matematika, bukan perintah mengalihkan aplikasi semprot menjadi fertigasi Venturi.</p>}
        <p className="ain-footnote">Penyiraman Fuzzy dan kebutuhan pupuk dihitung terpisah. Massa pupuk dari Panduan; konsentrasi stok diambil dari resep yang secara eksplisit sudah diikat ke produk. Kedua estimasi durasi memakai histori flowmeter belum terkalibrasi. Tidak ada kontrol pompa atau perubahan ledger.</p>
      </article>
      <article className="ain-panel ain-fertilizer-summary" aria-label="Kebutuhan pupuk terpisah">
        <div className="ain-panel-heading">
          <h3><FlaskConical size={18}/> Pemupukan · Panduan dan Resep Stok</h3>
          <span>PERENCANAAN · Satu produk per perhitungan</span>
        </div>
        <div className="ain-stat-grid">
          <article className="ain-stat"><span><Leaf size={17}/> Massa pupuk Panduan</span><strong>{show(chosenProduct?.mass_g,'g')}</strong><small>Target produk pada kegiatan, bukan dosis tersalurkan</small></article>
          <article className="ain-stat"><span><FlaskConical size={17}/> Konsentrasi stok terikat</span><strong>{show(chosenProduct?.stock_concentration_g_l,'g/L')}</strong><small>{chosenProduct?.binding_status==='BOUND'?'Identitas resep cocok (SHADOW)':chosenProduct?.binding_status==='STALE'?'Binding perlu diperbarui':'Belum ada binding eksplisit ke resep'}</small></article>
          <article className="ain-stat"><span><Droplets size={17}/> Volume larutan stok</span><strong>{show(chosenProduct?.stock_l,'L')}</strong><small>Massa ÷ konsentrasi; hanya hitungan bukan aktual</small></article>
          <article className="ain-stat"><span><Clock3 size={17}/> Estimasi waktu stok</span><strong>{show(chosenProduct?.stock_duration_minutes,'menit')}</strong><small>Debit hisap historis belum terkalibrasi</small></article>
        </div>
        {chosenProduct?.binding_status==='BOUND'&&<p className="ain-footnote">Binding SHADOW cocok dengan revisi tersimpan untuk resep {chosenProduct.stock_recipe_id}. Jika revisi Panduan atau resep berubah, binding otomatis diblokir. Konsentrasi fisik belum dikalibrasi.</p>}
        {chosenProduct?.binding_status==='STALE'&&<p className="ain-note">Binding pupuk sudah tidak cocok dengan revisi atau status resep. Ulangi pengikatan melalui CLI staging.</p>}
        {chosenProduct?.binding_status==='UNBOUND'&&<p className="ain-note">Volume stok belum dapat dihitung karena produk belum diikat ke resep stok yang disetujui. Gunakan perintah binding staging satu kali; tidak perlu mengisi volume/konsentrasi berulang.</p>}
        {selectedActivity?.reference_water_l!=null&&<p className="ain-footnote">Air referensi kegiatan dari Panduan: {show(selectedActivity.reference_water_l,'L')}. Tidak disamakan dengan volume irigasi Fuzzy.</p>}
      </article>
      {hasGuide&&<article className="ain-panel ain-planning-evidence" aria-label="Bukti perhitungan referensi">
        <div className="ain-panel-heading"><h3><Activity size={18}/> Dasar hitungan</h3><span>HISTORI · BELUM KALIBRASI</span></div>
        <div className="ain-fuzzy-preview-grid">
          <div><small>Referensi debit air</small><strong>{show(guideCalc?.flow_reference?.water_lpm,'L/menit')}</strong><small>Dari interval positif historis</small></div>
          <div><small>Referensi debit stok</small><strong>{show(guideCalc?.flow_reference?.stock_lpm,'L/menit')}</strong><small>Bukan nilai hisap Venturi terkalibrasi</small></div>
          <div><small>Estimasi waktu hisap stok</small><strong>{show(chosenProduct?.stock_duration_minutes,'menit')}</strong><small>Dihitung terpisah, bukan dijumlahkan dengan waktu air</small></div>
        </div>
        {chosenProduct?.reasons.includes('stock_duration_exceeds_water_duration')&&<p className="ain-note">Estimasi stok lebih lama daripada jendela air kegiatan menurut referensi. Ini hanya evaluasi matematis, bukan jadwal ON/OFF pompa.</p>}
        {guideCalc?.flow_reference&&<p className="ain-footnote">Referensi dari {when(guideCalc.flow_reference.started_at)} sampai {when(guideCalc.flow_reference.ended_at)}, {guideCalc.flow_reference.interval_count} interval. Volume air dan stok belum dibuktikan lewat pengukuran fisik.</p>}
        {!!guideCalc?.reasons.length&&<ul className="ain-reasons">{guideCalc.reasons.map(reason=><li key={reason}>{({
          fertilizer_mass_needs_review:'Kebutuhan massa pupuk perlu ditinjau.',
          multiple_fertilizers_not_combined:'Ada beberapa pupuk; dosis tidak digabung.',
          no_fertilizer_product:'Kegiatan ini tidak mencantumkan pupuk.',
          guide_reference_water_missing:'Panduan tidak memuat volume air dan belum ada hasil Fuzzy valid yang segar.',
          fuzzy_water_is_simulation_only:'Volume air menggunakan simulasi Fuzzy, bukan profil kebutuhan operasional.',
          saved_stock_recipe_not_bound_to_guide_product:'Resep stok tersimpan, tetapi belum terikat ke produk/kegiatan Panduan.',
          stock_binding_required:'Produk pupuk belum diikat secara eksplisit ke resep stok yang disetujui.',
          stock_binding_stale:'Binding stok kadaluwarsa karena perubahan revisi, nama pupuk atau status persetujuan.',
          historical_water_rate_unavailable:'Belum ada referensi debit air historis yang memenuhi syarat.',
          historical_stock_rate_unavailable:'Belum ada referensi debit stok historis yang memenuhi syarat.',
          stock_concentration_not_provided:'Konsentrasi stok belum tersedia dari konfigurasi yang terikat pada produk Panduan.'
        } as Record<string,string>)[reason]??reason}</li>)}</ul>}
      </article>}
      {!data.fuzzy_preview&&<article className="ain-panel ain-fuzzy-preview" aria-label="Status pratinjau Fuzzy">
        <div className="ain-panel-heading">
          <h3><Activity size={18}/> Hasil hitung Fuzzy — simulasi</h3>
          <span>SIMULASI · Tidak untuk kontrol pompa</span>
        </div>
        <p className="ain-muted">Angka Fuzzy belum tersedia dari telemetry terkini. Berikut pemeriksaan input dan alasan yang tercatat:</p>
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
              <div><dt>Tandon air (level sensor)</dt><dd>{tankReady?show(tank?.reported_level_pct,'%'):`${show(tank?.reported_level_pct,'%')} · ${tankStatusText}`}</dd></div>
              <div><dt>Tandon pupuk (dilaporkan)</dt><dd>{show(data.sensors.stock_tank_pct,'%')}</dd></div>
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
