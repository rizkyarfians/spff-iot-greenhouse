import {useEffect,useRef,useState} from 'react'
import type {ApiDevice,GuideActivity,GuideProgram,GuideProgramConfig,GuideProgramPreview,GuideProgramRevision} from '@spff/contracts'
import {guideProgramConfigSchema} from '@spff/contracts'
import {Check,Plus,RefreshCw,ChevronDown} from 'lucide-react'
import {fetchGuidePrograms,previewGuideProgram,saveGuideProgram,completeGuideProgram,fetchGuideProgramHistory} from './api'
import {useAuth} from './authContext'
import source from './data/protocolGuide.json'
import './GuidePrograms.css'
import {AutomationMethod,AutomationMethodNote} from './AutomationMethod'
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
 const [page,setPage]=useState(0),[openActivity,setOpenActivity]=useState<string|null>(null)
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
 const pageCount=Math.max(1,Math.ceil(visible.length/4)),currentPage=Math.min(page,pageCount-1),paged=visible.slice(currentPage*4,currentPage*4+4)
 useEffect(()=>{setPage(0);setOpenActivity(null);setCompleting(null)},[selected?.programId,preview,filter])
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
   {programs.length>0&&<label>Pilih program<select value={selected?.programId??''} disabled={busy||editing} onChange={event=>{setSelected(programs.find(p=>p.programId===event.target.value)??null);setError('');setNotice('')}}><option value="" disabled>Pilih program tanaman</option>{programs.map(p=><option key={p.programId} value={p.programId}>{p.plan.cropName} · HST {p.hst} · tanam {p.config.plantingDate}</option>)}</select></label>}

  </aside><div className="gp-content">
  {editing&&<form className="gp-panel gp-form" onSubmit={e=>{e.preventDefault();void run(async()=>{setPreview(await previewGuideProgram(config()))})}}>
   <h3>{selected?'Tinjau perubahan program':'Buat program tanaman'}</h3>
   <fieldset disabled={busy} hidden={!!preview}><label>Tanaman<select value={form.cropId} onChange={e=>{setForm({...form,cropId:e.target.value});setPreview(null)}}>{source.sheets.map(s=><option key={s.id} value={s.id}>{s.cropName}</option>)}</select></label>
   <label>Tanggal tanam<input type="date" required value={form.plantingDate} onChange={e=>{setForm({...form,plantingDate:e.target.value});setPreview(null)}}/></label>
   <label>Hitung berdasarkan<select value={form.basis} onChange={e=>{setForm({...form,basis:e.target.value as ProgramForm['basis'],quantity:''});setPreview(null)}}><option value="plants">Jumlah tanaman</option><option value="area">Luas lahan</option></select></label>
   <label>{form.basis==='plants'?'Jumlah tanaman':'Luas lahan (m²)'}<input type="number" required min={form.basis==='plants'?1:0.001} max={1e7} step={form.basis==='plants'?1:'any'} value={form.quantity} onChange={e=>{setForm({...form,quantity:e.target.value});setPreview(null)}}/></label>
   <label>Perangkat (opsional)<select value={form.deviceId} onChange={e=>{setForm({...form,deviceId:e.target.value});setPreview(null)}}><option value="">Belum dihubungkan</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}</select></label>
   </fieldset>{preview&&<p className="gp-form-summary">{preview.plan.cropName} · tanam {form.plantingDate} · {format(Number(form.quantity))} {form.basis==='plants'?'tanaman':'m²'}</p>}<div className="gp-actions">{preview&&<button type="button" disabled={busy} onClick={()=>setPreview(null)}>Ubah pengaturan</button>}<button type="button" disabled={busy} onClick={()=>{setEditing(false);setPreview(null);setError('')}}>Batal</button><button className="gp-primary" disabled={busy} hidden={!!preview} type="submit">{busy?'Menghitung…':'Hitung & periksa kebutuhan'}</button></div>
   {preview&&<div className="gp-review"><p>{preview.plan.activities.length} kegiatan. Periksa kebutuhan sebelum menyimpan.</p>{selected&&<><p>Periksa ulang kegiatan yang berubah.</p><details><summary>{changed.length} kegiatan berubah · lihat perbandingan</summary>{changed.map(item=><section key={item.id} className="gp-diff"><strong>{item.after?.title??item.before?.title}</strong><p>Sebelum: {summary(item.before)}</p><p>Sesudah: {summary(item.after)}</p></section>)}</details>{selected.config.plantingDate!==form.plantingDate&&<p>Tanggal tanam berubah: {selected.config.plantingDate} → {form.plantingDate}. Catatan selesai lama tetap ada dalam riwayat.</p>}</>}<button className="gp-primary" type="button" disabled={busy} onClick={()=>void run(async()=>{const saved=await saveGuideProgram({config:config(),sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},selected??undefined);setPrograms(rows=>[saved,...rows.filter(p=>p.programId!==saved.programId)]);setSelected(saved);setEditing(false);setPreview(null);setLoaded(true);setNotice('Program tersimpan. Kegiatan dilaksanakan dan dicatat secara manual.')} )}><Check size={18}/>Simpan program ini</button></div>}
  </form>}
  {!editing&&selected&&<section className="gp-panel"><div className="gp-heading"><div><h3>{selected.plan.cropName} · HST {selected.hst}</h3><p>Tanam {selected.config.plantingDate}</p></div>{admin&&<button disabled={busy} onClick={()=>start(selected)}>Ubah program</button>}</div>
   {selected.sourceChanged&&<div className="gp-warning"><strong>Panduan diperbarui</strong><p>Tinjau perubahan sebelum memperbarui program.</p>{admin&&<button disabled={busy} onClick={()=>start(selected)}>Tinjau perubahan</button>}</div>}
   <div className="gp-totals"><div><span>{selected.config.basis==='plants'?'Jumlah tanaman':'Perkiraan jumlah tanaman'}</span><strong>{format(selected.plan.plants)}</strong></div><div><span>{selected.config.basis==='area'?'Luas lahan':'Perkiraan luas lahan'}</span><strong>{format(selected.plan.area)} m²</strong></div></div>
   {pending>0&&<p>{pending} kegiatan sebelumnya belum ditandai. Buka semua kegiatan untuk memeriksa.</p>}
  </section>}
  {plan&&<>
   <div className="gp-heading"><h3>{editing?'Periksa kebutuhan':'Kegiatan tanaman'}</h3>{!editing&&<div className="gp-tabs" role="group" aria-label="Filter kegiatan"><button aria-pressed={filter==='today'} onClick={()=>setFilter('today')}>Hari ini</button><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Semua</button></div>}</div>
   <AutomationMethodNote/>
   <p className="gp-caption">{visible.length} kegiatan · Pilih kegiatan untuk melihat bahan.</p>
   {!visible.length&&<div className="gp-panel"><p>Tidak ada kegiatan untuk HST hari ini.</p>{next&&<p>Berikutnya: HST {next.hst} · {next.title}</p>}</div>}
   {pageCount>1&&<nav className="gp-pagination" aria-label="Halaman kegiatan"><span>{currentPage*4+1}–{Math.min((currentPage+1)*4,visible.length)} dari {visible.length}</span><div><button type="button" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setOpenActivity(null);setCompleting(null)}}>Sebelumnya</button><button type="button" disabled={currentPage===pageCount-1} onClick={()=>{setPage(currentPage+1);setOpenActivity(null);setCompleting(null)}}>Berikutnya</button></div></nav>}
   {paged.map(a=><article className="gp-panel gp-activity gp-compact-activity" key={a.id}>
    <button className="gp-activity-trigger" type="button" aria-expanded={openActivity===a.id} aria-controls={`gp-body-${a.id}`} onClick={()=>{setOpenActivity(openActivity===a.id?null:a.id);setCompleting(null)}}>
     <span className="gp-activity-title"><span className="gp-hst">{a.hst===null?'HST —':`HST ${a.hst}`}</span><strong>{a.title}</strong><small>{a.method} · {a.requirements.length} bahan{a.waterL!==null?` · ${format(a.waterL)} L`:''}</small>
     <AutomationMethod method={a.method}/>
     {(a.warnings.length>0||a.requirements.some(r=>r.warnings.length))&&<span className="gp-review-badge">Perlu diperiksa</span>}</span>
     <span className="gp-activity-indicator">{!editing&&<span className={`gp-status${selected?.completedActivityIds.includes(a.id)?' is-done':''}`}>{status(a)}</span>}<ChevronDown size={20} aria-hidden="true"/></span>
    </button>
    <div id={`gp-body-${a.id}`} hidden={openActivity!==a.id} className="gp-activity-body">
    {a.warnings.map(w=><p className="gp-warning" key={w}>{w}</p>)}
    <div className="gp-material-list">{a.requirements.map(r=><section key={r.row} className="gp-material"><div className="gp-material-row"><div><h4>{r.product}</h4><small>{format(r.dose)} {r.doseUnit}</small></div><strong>{format(r.amount)} {r.unit}</strong></div>{r.warnings.length>0&&<ul className="gp-warnings">{r.warnings.map(w=><li key={w}>{w}</li>)}</ul>}</section>)}</div>
    {a.requirements.length>0&&<details><summary>Acuan & perhitungan</summary><p>Acuan: {format(plan.sourcePlants)} tanaman / {format(plan.sourceArea)} m² · faktor {format(plan.scale)}×.</p>{a.requirements.map(r=><p key={r.row}><strong>{r.product}</strong>: acuan {format(r.sourceAmount)} {r.sourceUnit}{r.concentrationGPerL!==null?` · konsentrasi ${format(r.concentrationGPerL)} g/L`:''}</p>)}</details>}
    {!editing&&operator&&selected&&a.hst!==null&&a.hst<=selected.hst&&!selected.completedActivityIds.includes(a.id)&&<div className="gp-complete">
     {completing===a.id?<><p>Konfirmasi kegiatan ini sudah dilakukan secara manual.</p><label>Catatan (opsional)<input maxLength={500} value={completionNote} onChange={e=>setCompletionNote(e.target.value)}/></label><div className="gp-actions"><button disabled={busy} onClick={()=>setCompleting(null)}>Batal</button><button className="gp-primary" disabled={busy} onClick={()=>void run(async()=>{await completeGuideProgram(selected,a.id,completionNote);await reload();setCompleting(null);setCompletionNote('');setNotice('Kegiatan tercatat selesai.')} )}>Konfirmasi sudah dilakukan</button></div></>:<button disabled={busy} onClick={()=>{setCompleting(a.id);setCompletionNote('')}}><Check size={18}/>Tandai sudah dilakukan</button>}
    </div>}
    </div>
   </article>)}
   <p className="gp-caption">Tandai selesai setelah kegiatan dilakukan.</p>
  </>}
  {!editing&&!selected&&loaded&&<section className="gp-panel"><h3>Mulai dari Panduan tanaman</h3><p>Buat program untuk menyesuaikan kebutuhan bahan dan melihat kegiatan sesuai HST.</p></section>}
  {selected&&!editing&&<ProgramRevisionHistory programId={selected.programId} revision={selected.revision}/>}
  {selected&&!editing&&selected.completions.length>0&&<details className="gp-panel"><summary>Riwayat kegiatan</summary>{selected.completions.map(c=><p key={c.activityFingerprint}>{selected.plan.activities.find(a=>a.id===c.activityId)?.title??'Kegiatan'} · {new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(c.completedAt))} WIB · {c.actor}{c.note?` · ${c.note}`:''}</p>)}</details>}
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
