import type {FertigationProgress,FertigationProgressMetric} from '@spff/contracts'
import './FertigationProgressPanel.css'
const number=(value:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(value)
const reasonLabels:Record<string,string>={
 soil_ec_target_stable:'Target EC sudah terpenuhi dan pembacaan stabil. AI tidak perlu menambah pupuk.',
 soil_ec_already_sufficient:'EC tanah sudah cukup untuk target saat ini. AI tidak perlu menyalakan pompa pupuk.',
 soil_ec_below_target:'EC tanah masih di bawah batas mulai. AI mengevaluasi pulse untuk mengejar target.',
 soil_ec_above_start_threshold:'EC belum turun di bawah batas mulai. AI menunggu, meskipun bar belum penuh.',
 target_confirmation:'EC mendekati target; menunggu pembacaan stabil sebelum menyatakan cukup.',
 waiting_new_samples:'Menunggu sampel tanah baru yang valid.',settling:'Menunggu larutan meresap sebelum menghitung ulang.',soil_ec_unstable:'EC belum stabil; AI menunggu pembacaan berikutnya.',
 pulse_in_flight:'Sesi pulse aktif atau menunggu konfirmasi perangkat. Lihat kondisi pompa untuk status relay.',
 calibration_missing:'Simpan kalibrasi terverifikasi di Program Fertigasi agar AI dapat menghitung pulse.',
 calibration_rule_changed:'Aturan atau program berubah. Verifikasi lalu simpan ulang kalibrasi otomatis.',
 rule_missing:'Belum ada program EC tanah yang cocok. Pilih tanaman dan aturan hari ini.',rule_ambiguous:'Ada beberapa aturan yang cocok. Tentukan satu program untuk AI.',
 rule_not_applicable:'Program belum disetujui atau tidak cocok dengan tanaman/HST hari ini.',
 ai_disabled:'Izin AI sedang OFF. Angka sensor dan target tetap ditampilkan.',server_disabled:'Eksekusi AI belum tersedia pada server.',operator_stop:'AI dihentikan operator. Periksa sesi sebelum mengaktifkan kembali.',
 schedule_priority:'Jadwal timer sedang diprioritaskan. AI mengevaluasi lagi setelah jadwal selesai.',cooldown:'Menunggu jeda minimum antar sesi.',
 tank_sensor_or_level_invalid:'Sensor tandon belum valid atau isinya di bawah batas minimum.',soil_sensor_invalid_or_stale:'Sensor tanah belum valid atau datanya sudah kedaluwarsa.',
 moisture_outside_calibrated_range:'Kelembapan tanah berada di luar rentang kalibrasi AI.',invalid_confirmation_samples:'Sampel konfirmasi belum memenuhi syarat sensor.',
 pulse_budget_limit:'Batas pulse sesi atau harian tercapai. Periksa kebutuhan tanaman dan batas yang disetujui.',
 soil_ec_high:'EC mencapai batas tinggi. AI menahan pemberian pupuk.',soil_ec_overshoot:'EC melewati toleransi setelah pulse. Periksa sesi sebelum melanjutkan.',
 command_pending:'Menunggu perintah sebelumnya selesai dan dikonfirmasi perangkat.',ownership_unreleased:'Kontrol sesi sebelumnya belum dilepas dan dikonfirmasi. Periksa sesi serta ACK perangkat.',
 equipment_not_ready:'Perangkat atau mode belum siap.',pulse_outcome_unknown:'Hasil pulse belum dikonfirmasi; periksa perangkat.',
}
const shortReasons:Record<string,string>={
 rule_missing:'Pilih program untuk melihat target.',rule_ambiguous:'Pilih satu program AI.',rule_not_applicable:'Program belum cocok untuk hari ini.',
 calibration_missing:'Kalibrasi AI belum diatur.',calibration_rule_changed:'Kalibrasi perlu diperbarui.',
 soil_ec_target_stable:'Target EC terpenuhi.',soil_ec_already_sufficient:'EC tanah sudah cukup.',soil_ec_below_target:'EC tanah masih kurang.',
 soil_ec_above_start_threshold:'Menunggu EC turun ke batas mulai.',target_confirmation:'Memastikan EC stabil.',
 waiting_new_samples:'Menunggu data sensor.',settling:'Menunggu larutan meresap.',soil_ec_unstable:'Menunggu EC stabil.',
 pulse_in_flight:'Menunggu hasil pulse.',ai_disabled:'AI nonaktif.',server_disabled:'Eksekusi AI belum tersedia.',operator_stop:'AI dihentikan operator.',
 schedule_priority:'Jadwal timer sedang berjalan.',cooldown:'Menunggu jeda pompa.',command_pending:'Menunggu konfirmasi alat.',
 tank_sensor_or_level_invalid:'Periksa sensor dan isi tandon.',soil_sensor_invalid_or_stale:'Data tanah belum valid.',
 moisture_outside_calibrated_range:'Kelembapan di luar batas kalibrasi.',invalid_confirmation_samples:'Data konfirmasi belum valid.',
 pulse_budget_limit:'Batas pulse tercapai.',soil_ec_high:'EC terlalu tinggi. Pupuk ditahan.',soil_ec_overshoot:'EC melewati toleransi. Periksa kondisi.',
 ownership_unreleased:'Kontrol pompa belum dilepas.',equipment_not_ready:'Perangkat belum siap.',pulse_outcome_unknown:'Hasil pulse belum terkonfirmasi.',
}
const statusLabels:Record<FertigationProgress['status'],string>={satisfied:'Target terpenuhi',needs_action:'Masih perlu tindakan',waiting:'Menunggu',running:'Sesi AI aktif',blocked:'Perlu diperiksa',disabled:'AI nonaktif',unavailable:'Belum siap'}
function Metric({metric,minimal=false}:{metric:FertigationProgressMetric;minimal?:boolean}){
 const isTank=metric.unit==='%'
 const high=metric.value!==null&&metric.high!==null&&metric.value>=metric.high
 const lowTank=isTank&&metric.value!==null&&metric.minimum!==null&&metric.value<metric.minimum
 const enough=metric.value!==null&&metric.target!==null&&metric.value>=metric.target
 const tone=high||lowTank?'warning':enough?'satisfied':'normal'
 return <article className={`ai-metric is-${tone}`}>
  <div className="ai-metric-heading"><strong>{metric.label}</strong>{(!minimal||!isTank)&&<span>{metric.percent!==null?`${Math.round(metric.percent)}%`: '—'}</span>}</div>
  <div className="ai-metric-value">{metric.value===null?(minimal?'Data belum valid':'Belum ada data valid'):<><b>{number(metric.value)}</b>{!(minimal&&(isTank||metric.target===null))&&<> / {metric.target===null?'target belum diatur':number(metric.target)}</>} {metric.unit}</>}</div>
  <div className={`ai-meter${metric.percent===null?' is-unavailable':''}`} role="progressbar" aria-label={`${metric.label}: nilai saat ini terhadap ${isTank?'kapasitas':'target'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metric.percent??undefined}
   aria-valuetext={metric.value===null?'Pembacaan valid belum tersedia':`${number(metric.value)} ${metric.unit}; ${isTank?'kapasitas':'target'} ${metric.target===null?'belum diatur':number(metric.target)}`}>
   <span className="ai-meter-fill" style={{width:`${metric.percent??0}%`}}/>
   {isTank&&metric.minimum!==null&&<span className="ai-meter-minimum" style={{left:`${Math.min(100,Math.max(0,metric.minimum))}%`}} title={`Minimum ${number(metric.minimum)}%`}/>}
  </div>
  {!minimal&&<small>{isTank?`Persentase isi dari kapasitas${metric.minimum!==null?` · minimum operasional ${number(metric.minimum)}%`:''}`:
   metric.value===null?'Bar menunggu pembacaan sensor yang valid.':metric.target===null?'Target belum tersedia; tidak dihitung sebagai 0.':high?'Mencapai batas EC tinggi; periksa kondisi.':enough?'Nilai terukur sudah mencapai acuan.':`Selisih menuju target: ${number(metric.remaining!)} ${metric.unit}`}</small>}
  {!minimal&&!isTank&&metric.minimum!==null&&<small>Batas mulai: {number(metric.minimum)} {metric.unit}{metric.high!==null?` · batas tinggi ${number(metric.high)} ${metric.unit}`:''}</small>}
  {minimal&&metric.value!==null&&<small>{high?'EC tinggi':lowTank?'Di bawah minimum':!isTank&&metric.target===null?'Target belum diatur':!isTank&&metric.remaining!==null&&metric.remaining>0?`Kurang ${number(metric.remaining)} ${metric.unit}`:null}</small>}
 </article>
}
export function FertigationProgressPanel({report,error='',compact=false,minimal=false,loading=false,onRetry,onOpen}:{report:FertigationProgress|null;error?:string;compact?:boolean;minimal?:boolean;loading?:boolean;onRetry?:()=>void;onOpen?:()=>void}){
 if(!report)return <section className={`ai-progress${compact?' is-compact':''}`} aria-label="Rekomendasi AI" aria-busy={loading}>{!minimal&&<strong>Rekomendasi AI</strong>}<p>{error?'Rekomendasi belum dapat dimuat.':'Menunggu rekomendasi dan data sensor…'}</p>
  {error&&<p className="ai-progress-error" role="alert">{error}</p>}
  {onRetry&&<button className="ai-open-program" type="button" disabled={loading} onClick={onRetry}>{loading?'Memuat…':'Muat ulang rekomendasi'}</button>}
 </section>
 const detail=reasonLabels[report.reason]??report.reason
 const notes=(
  <div className="ai-progress-notes">
   <span>Target EC berasal dari aturan tanaman/HST yang disimpan. AI menghitung selisih dan durasi pulse, bukan membuat angka target baru. EC adalah pembacaan sensor, bukan jumlah pupuk atau air yang sudah disiram. {report.soilEcBasis==='stable_mean'?'Nilai tanah memakai rata-rata sampel stabil.':''}</span>
   {report.soilEcToleranceUsCm!==null&&<span>Toleransi EC tanah: ±{number(report.soilEcToleranceUsCm)} µS/cm; kecukupan diperiksa dari sampel stabil.</span>}
   <span>Target EC larutan memakai pengaturan tandon tersendiri{report.liquidControlEnabled?'':'; kontrol otomatis EC larutan nonaktif'}.</span>
   {report.nextPulseOnMs!==null&&<span>Rekomendasi pulse berikutnya: <b>{number(report.nextPulseOnMs/1000)} detik</b>. Server memeriksa ulang sebelum eksekusi.</span>}
   {report.dailyLimitMs!==null&&<span>Durasi pulse diperintahkan hari ini: {number(report.dailyOnMs/1000)} / {number(report.dailyLimitMs/1000)} detik.</span>}
   {!report.executionEnabled&&<span>Izin AI OFF; jadwal timer tetap terpisah.</span>}
   <span>{report.telemetryFresh?'Data sensor':'Data terakhir'}: {report.telemetryAt?new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(report.telemetryAt))+' WIB':'belum tersedia'} · diperbarui otomatis</span>
  </div>
 )
 return <section className={`ai-progress${compact?' is-compact':''}${minimal?' is-minimal':''}`} aria-label="Rekomendasi dan progres AI">
  <header className="ai-progress-heading"><div>{!minimal&&<h2>Rekomendasi AI hari ini</h2>}<small>{report.cropName??'Program belum dipilih'}{report.hst!==null?` · HST ${report.hst}`:''}{!minimal&&` · ${report.day}`}</small></div><span className={`ai-status is-${report.status}`}>{statusLabels[report.status]}</span></header>
  <p className="ai-decision">{minimal?(shortReasons[report.reason]??'Periksa detail rekomendasi.'):detail}</p>
  <div className="ai-metrics"><Metric minimal={minimal} metric={report.soilEc}/>{!compact&&<Metric minimal={minimal} metric={report.liquidEc}/>}</div>
  {compact?<details className="ai-tank-details"><summary>EC larutan dan isi tandon</summary><div className="ai-metrics"><Metric minimal={minimal} metric={report.liquidEc}/><Metric minimal={minimal} metric={report.waterTank}/><Metric minimal={minimal} metric={report.fertilizerTank}/></div></details>:
   <div className="ai-metrics"><Metric minimal={minimal} metric={report.waterTank}/><Metric minimal={minimal} metric={report.fertilizerTank}/></div>}
  {minimal?<details className="ai-explanation"><summary>Detail rekomendasi</summary>
   <p>{detail}</p>
   {[report.soilEc,report.liquidEc,report.waterTank,report.fertilizerTank].filter(metric=>metric.minimum!==null||metric.high!==null).map(metric=><p key={metric.key}>{metric.label}: minimum {metric.minimum===null?'—':number(metric.minimum)}{metric.high!==null?` · maksimum ${number(metric.high)}`:''} {metric.unit}</p>)}
  {notes}
  </details>:<>
  {notes}
  </>}
  {minimal&&<small className="ai-updated">{report.telemetryFresh?'Diperbarui':'Data terakhir'} {report.telemetryAt?new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(report.telemetryAt))+' WIB':'—'}</small>}
  {onOpen&&<button className="ai-open-program" type="button" onClick={onOpen}>{minimal?'Atur program':'Buka Program Fertigasi'}</button>}
 </section>
}
