import {useEffect,useRef,useState} from 'react'
import type {ApiDevice,GuideActivity,GuideProgram,GuideProgramConfig,GuideProgramPreview,GuideProgramRevision} from '@spff/contracts'
import {guideProgramConfigSchema} from '@spff/contracts'
import {BookOpen,Check,Plus,RefreshCw} from 'lucide-react'
import {fetchGuidePrograms,previewGuideProgram,saveGuideProgram,completeGuideProgram,fetchGuideProgramHistory} from './api'
import {useAuth} from './authContext'
import source from './data/protocolGuide.json'
import './GuidePrograms.css'
const format=(value:number|null)=>value===null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(value)
const initial=(cropId:string)=>({cropId,plantingDate:'',basis:'plants' as const,quantity:'',deviceId:''})
type ProgramForm={cropId:string;plantingDate:string;basis:'plants'|'area';quantity:string;deviceId:string}
function summary(a:GuideActivity|undefined){return a?`HST ${a.hst??'—'} · ${a.title} · ${a.method} · ${format(a.waterL)} L · ${a.requirements.map(r=>`${r.product}: ${format(r.amount)} ${r.unit} (dosis ${format(r.dose)} ${r.doseUnit}; acuan ${format(r.sourceAmount)} ${r.sourceUnit})`).join('; ')}`:'Tidak ada'}
export function GuidePrograms({devices}:{devices:ApiDevice[]}){
 const {user}=useAuth(),admin=user.role==='admin',operator=admin||user.role==='operator'
 const [preset]=useState(()=>sessionStorage.getItem('spff-guide-program-crop'))
 const [programs,setPrograms]=useState<GuideProgram[]>([]),[selected,setSelected]=useState<GuideProgram|null>(null)
 const [form,setForm]=useState<ProgramForm>(()=>initial(source.sheets.some(s=>s.id===preset)?preset!:source.sheets[0].id))
 const [editing,setEditing]=useState(admin&&!!preset),[preview,setPreview]=useState<GuideProgramPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false)
 const [filter,setFilter]=useState<'today'|'all'>('today'),[completing,setCompleting]=useState<string|null>(null),[completionNote,setCompletionNote]=useState('')
 const lock=useRef(false),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;sessionStorage.removeItem('spff-guide-program-crop');void fetchGuidePrograms().then(rows=>{if(mounted.current){setPrograms(rows);setLoaded(true);if(!preset&&rows[0])setSelected(rows[0])}}).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:'Gagal memuat program.')});return()=>{mounted.current=false}},[preset])
 useEffect(()=>{
  if(editing)return
  const timer=setInterval(()=>{if(lock.current)return;void fetchGuidePrograms().then(rows=>{if(mounted.current){setPrograms(rows);setSelected(current=>current?rows.find(p=>p.programId===current.programId)??null:current)}}).catch(()=>{})},60000)
  return()=>clearInterval(timer)
 },[editing])
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await action()}catch(e){setError(e instanceof Error?e.message:'Permintaan gagal.')}finally{lock.current=false;if(mounted.current)setBusy(false)}}
 function config():GuideProgramConfig {const parsed=guideProgramConfigSchema.safeParse({...form,quantity:Number(form.quantity),deviceId:form.deviceId||null});if(!parsed.success)throw new Error('Lengkapi tanggal tanam dan jumlah tanaman/luas yang valid.');return parsed.data}
 function start(program:GuideProgram|null){setSelected(program);setPreview(null);setCompleting(null);setCompletionNote('');setError('');setNotice('');setEditing(true);setForm(program?{...program.config,quantity:String(program.config.quantity),deviceId:program.config.deviceId??''}:initial(source.sheets[0].id))}
 async function reload(){const rows=await fetchGuidePrograms();setPrograms(rows);setLoaded(true);if(selected)setSelected(rows.find(p=>p.programId===selected.programId)??null)}
 const plan=editing?preview?.plan:selected?.plan
 const activities=plan?.activities??[]
 const visible=editing||filter==='all'?activities:activities.filter(a=>a.hst===selected?.hst)
 const next=selected?.plan.activities.filter(a=>a.hst!==null&&a.hst>selected.hst).sort((a,b)=>a.hst!-b.hst!)[0]
 const pending=selected?.plan.activities.filter(a=>a.hst!==null&&a.hst<selected.hst&&!selected.completedActivityIds.includes(a.id)).length??0
 const changed=selected&&preview?[...new Set([...selected.plan.activities.map(a=>a.id),...preview.plan.activities.map(a=>a.id)])].map(id=>({id,before:selected.plan.activities.find(a=>a.id===id),after:preview.plan.activities.find(a=>a.id===id)})).filter(item=>JSON.stringify(item.before)!==JSON.stringify(item.after)):[]
 function status(a:GuideActivity){return selected?.completedActivityIds.includes(a.id)?'Selesai':a.hst===null?'Periksa HST':a.hst===(selected?.hst??0)?'Hari ini':a.hst!<(selected?.hst??0)?'Belum ditandai':'Akan datang'}
 return <section className="gp-page" aria-label="Program dari Panduan">
  <div className="gp-heading"><div><h2>Program dari Panduan</h2><p>Kebutuhan bahan dan kegiatan sesuai umur tanaman.</p></div><button type="button" disabled={busy||editing} onClick={()=>void run(reload)} aria-label="Muat ulang program"><RefreshCw size={20}/></button></div>
  {error&&<p role="alert" className="gp-error">{error}</p>}{notice&&<p role="status" className="gp-notice">{notice}</p>}
  <div className="gp-layout"><aside className="gp-panel gp-sidebar"><h3>Program tanaman</h3>
   {admin&&<button className="gp-primary" disabled={busy||editing} onClick={()=>start(null)}><Plus size={18}/>Buat dari Panduan</button>}
   {!loaded&&!error&&<p>Memuat…</p>}{loaded&&!programs.length&&<p>Belum ada program. Pilih Panduan lalu buat program.</p>}
   {programs.map(p=><button className={`gp-program${selected?.programId===p.programId?' is-selected':''}`} key={p.programId} disabled={busy||editing} onClick={()=>{setSelected(p);setError('');setNotice('');setCompleting(null)}} aria-pressed={selected?.programId===p.programId}><strong>{p.plan.cropName}</strong><span>HST {p.hst} · {format(p.config.quantity)} {p.config.basis==='plants'?'tanaman':'m²'}</span><small>Panduan revisi {p.guideRevision} · {p.config.plantingDate}</small></button>)}
  </aside><div className="gp-content">
  {editing&&<form className="gp-panel gp-form" onSubmit={e=>{e.preventDefault();void run(async()=>{setPreview(await previewGuideProgram(config()))})}}>
   <h3>{selected?'Tinjau perubahan program':'Buat program tanaman'}</h3>
   <fieldset disabled={busy}><label>Tanaman<select value={form.cropId} onChange={e=>{setForm({...form,cropId:e.target.value});setPreview(null)}}>{source.sheets.map(s=><option key={s.id} value={s.id}>{s.cropName}</option>)}</select></label>
   <label>Tanggal tanam<input type="date" required value={form.plantingDate} onChange={e=>{setForm({...form,plantingDate:e.target.value});setPreview(null)}}/></label>
   <label>Hitung berdasarkan<select value={form.basis} onChange={e=>{setForm({...form,basis:e.target.value as ProgramForm['basis'],quantity:''});setPreview(null)}}><option value="plants">Jumlah tanaman</option><option value="area">Luas lahan</option></select></label>
   <label>{form.basis==='plants'?'Jumlah tanaman':'Luas lahan (m²)'}<input type="number" required min={form.basis==='plants'?1:0.001} max={1e7} step={form.basis==='plants'?1:'any'} value={form.quantity} onChange={e=>{setForm({...form,quantity:e.target.value});setPreview(null)}}/></label>
   <label>Perangkat (opsional)<select value={form.deviceId} onChange={e=>{setForm({...form,deviceId:e.target.value});setPreview(null)}}><option value="">Belum dihubungkan</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}</select></label>
   </fieldset><div className="gp-actions"><button type="button" disabled={busy} onClick={()=>{setEditing(false);setPreview(null);setError('')}}>Batal</button><button className="gp-primary" disabled={busy} type="submit">{busy?'Menghitung…':'Hitung & periksa kebutuhan'}</button></div>
   {preview&&<div className="gp-review"><p>Panduan revisi {preview.guideRevision} · {preview.plan.activities.length} kegiatan. Periksa kebutuhan di bawah sebelum menyimpan.</p>{selected&&<><p>Revisi lama tetap tercatat. Kegiatan yang berubah perlu ditinjau dan ditandai kembali.</p><details><summary>{changed.length} kegiatan berubah · lihat perbandingan</summary>{changed.map(item=><section key={item.id} className="gp-diff"><strong>{item.id}</strong><p>Sebelum: {summary(item.before)}</p><p>Sesudah: {summary(item.after)}</p></section>)}</details>{selected.config.plantingDate!==form.plantingDate&&<p>Tanggal tanam berubah: {selected.config.plantingDate} → {form.plantingDate}. Catatan selesai lama tetap ada dalam riwayat.</p>}</>}<button className="gp-primary" type="button" disabled={busy} onClick={()=>void run(async()=>{const saved=await saveGuideProgram({config:config(),sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},selected??undefined);setPrograms(rows=>[saved,...rows.filter(p=>p.programId!==saved.programId)]);setSelected(saved);setEditing(false);setPreview(null);setLoaded(true);setNotice('Program tersimpan. Kegiatan dilaksanakan dan dicatat secara manual.')} )}><Check size={18}/>Simpan program ini</button></div>}
  </form>}
  {!editing&&selected&&<section className="gp-panel"><div className="gp-heading"><div><h3>{selected.plan.cropName} · HST {selected.hst}</h3><p>Tanam {selected.config.plantingDate} · Panduan revisi {selected.guideRevision}</p></div>{admin&&<button disabled={busy} onClick={()=>start(selected)}>Ubah program</button>}</div>
   {selected.sourceChanged&&<div className="gp-warning"><strong>Panduan diperbarui</strong><p>Program ini tetap memakai revisi {selected.guideRevision}.</p>{admin&&<button disabled={busy} onClick={()=>start(selected)}>Tinjau & terapkan revisi terbaru</button>}</div>}
   <div className="gp-totals"><div><span>{selected.config.basis==='plants'?'Jumlah tanaman':'Perkiraan jumlah tanaman'}</span><strong>{format(selected.plan.plants)}</strong></div><div><span>{selected.config.basis==='area'?'Luas lahan':'Perkiraan luas lahan'}</span><strong>{format(selected.plan.area)} m²</strong></div></div>
   {pending>0&&<p>{pending} kegiatan sebelumnya belum ditandai. Buka semua kegiatan untuk memeriksa.</p>}
  </section>}
  {plan&&<>
   <div className="gp-heading"><h3>{editing?'Periksa kebutuhan':'Kegiatan tanaman'}</h3>{!editing&&<div className="gp-tabs" role="group" aria-label="Filter kegiatan"><button aria-pressed={filter==='today'} onClick={()=>setFilter('today')}>Hari ini</button><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Semua</button></div>}</div>
   <p className="gp-caption">Acuan: {format(plan.sourcePlants)} tanaman / {format(plan.sourceArea)} m². Hasil hitung menggunakan dosis Panduan; nilai acuan tetap ditampilkan.</p>
   {!visible.length&&<div className="gp-panel"><p>Tidak ada kegiatan untuk HST hari ini.</p>{next&&<p>Berikutnya: HST {next.hst} · {next.title}</p>}</div>}
   {visible.map(a=><article className="gp-panel gp-activity" key={a.id}>
    <div className="gp-heading"><div><span className="gp-hst">{a.hst===null?'HST belum diisi':`HST ${a.hst}`}</span><h3>{a.title}</h3><p>{a.method} · {a.waterL!==null?`${format(a.waterL)} L larutan acuan`:'Volume larutan belum tersedia'}</p></div>{!editing&&<span className={`gp-status${selected?.completedActivityIds.includes(a.id)?' is-done':''}`}>{status(a)}</span>}</div>
    {a.warnings.map(w=><p className="gp-warning" key={w}>{w}</p>)}
    <div className="gp-requirements">{a.requirements.map(r=><section key={r.row} className="gp-requirement"><h4>{r.product}</h4><p>{format(r.dose)} {r.doseUnit} · baris {r.row}</p><dl><div><dt>Kebutuhan lahan Anda</dt><dd>{format(r.amount)} {r.unit}</dd></div><div><dt>Acuan Panduan</dt><dd>{format(r.sourceAmount)} {r.sourceUnit}</dd></div>{r.concentrationGPerL!==null&&<div><dt>Konsentrasi hitung</dt><dd>{format(r.concentrationGPerL)} g/L</dd></div>}</dl>{r.warnings.length>0&&<ul className="gp-warnings">{r.warnings.map(w=><li key={w}>{w}</li>)}</ul>}</section>)}</div>
    {a.requirements.length>0&&<details><summary>Detail perhitungan</summary><p>Faktor lahan/populasi: {format(plan.scale)}×. Dosis per tanaman × populasi; dosis per liter × pelarut; dosis per luas × luas lahan. Nilai acuan mengikuti tabel, hasil hitung belum dikonversi menjadi EC.</p><p>Larutan per kegiatan bukan penjumlahan volume tiap produk. Kesesuaian campuran perlu diperiksa sebelum aplikasi.</p></details>}
    {!editing&&operator&&selected&&a.hst!==null&&a.hst<=selected.hst&&!selected.completedActivityIds.includes(a.id)&&<div className="gp-complete">
     {completing===a.id?<><p>Konfirmasi kegiatan ini sudah dilakukan secara manual.</p><label>Catatan (opsional)<input maxLength={500} value={completionNote} onChange={e=>setCompletionNote(e.target.value)}/></label><div className="gp-actions"><button disabled={busy} onClick={()=>setCompleting(null)}>Batal</button><button className="gp-primary" disabled={busy} onClick={()=>void run(async()=>{await completeGuideProgram(selected,a.id,completionNote);await reload();setCompleting(null);setCompletionNote('');setNotice('Kegiatan tercatat selesai.')} )}>Konfirmasi sudah dilakukan</button></div></>:<button disabled={busy} onClick={()=>{setCompleting(a.id);setCompletionNote('')}}><Check size={18}/>Tandai sudah dilakukan</button>}
    </div>}
   </article>)}
   <p className="gp-caption"><BookOpen size={17}/>Program ini untuk perencanaan dan pencatatan manual. Konversi EC, progres flow meter, dan eksekusi pompa belum dihubungkan.</p>
  </>}
  {!editing&&!selected&&loaded&&<section className="gp-panel"><h3>Mulai dari Panduan tanaman</h3><p>Buat program untuk menyesuaikan kebutuhan bahan dan melihat kegiatan sesuai HST.</p></section>}
  {selected&&!editing&&<ProgramRevisionHistory programId={selected.programId} revision={selected.revision}/>}
  {selected&&!editing&&selected.completions.length>0&&<details className="gp-panel"><summary>Riwayat kegiatan</summary>{selected.completions.map(c=><p key={c.activityFingerprint}>{c.activityId} · {new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(c.completedAt))} WIB · {c.actor} · program revisi {c.programRevision}{c.note?` · ${c.note}`:''}</p>)}</details>}
  </div></div>
 </section>
}

function ProgramRevisionHistory({programId,revision}:{programId:string;revision:number}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<GuideProgramRevision[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 useEffect(()=>{
  if(!open)return
  let active=true;setLoading(true);setRows([]);setError('')
  void fetchGuideProgramHistory(programId).then(next=>{if(active)setRows(next)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Gagal memuat riwayat.')}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[open,programId,revision])
 return <details className="gp-panel" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Riwayat revisi program</summary>{loading&&<p>Memuat riwayat…</p>}{error&&<p role="alert">{error}</p>}{rows.map(item=><details key={item.revision}><summary>Program revisi {item.revision} · Panduan revisi {item.guideRevision}</summary><p>{item.actor} · {new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(item.savedAt))} WIB · tanam {item.config.plantingDate}</p>{item.plan.activities.map(a=><p key={a.id}>{summary(a)}</p>)}</details>)}{rows.length===20&&<p>Menampilkan 20 revisi terakhir.</p>}</details>
}
