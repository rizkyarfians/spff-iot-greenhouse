import {useEffect,useRef,useState} from 'react'
import type {ApiDevice,GuideActivity,GuideProgram,GuideProgramConfig,GuideProgramPreview,GuideProgramRevision} from '@spff/contracts'
import {guideProgramConfigSchema} from '@spff/contracts'
import {Check,Plus,RefreshCw,ChevronDown,Leaf,CalendarDays} from 'lucide-react'
import {fetchGuidePrograms,previewGuideProgram,saveGuideProgram,completeGuideProgram,fetchGuideProgramHistory} from './api'
import {useAuth} from './authContext'
import source from './data/protocolGuide.json'
import './GuidePrograms.css'
import {GuideSchedule} from './GuideSchedule'
import {guideTaskSummary} from './guideSchedule'
import {AutomationMethod} from './AutomationMethod'
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
 const [filter,setFilter]=useState<'pending'|'all'|'schedule'>('pending'),[completing,setCompleting]=useState<string|null>(null),[completionNote,setCompletionNote]=useState('')
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
 const taskSummary=selected?guideTaskSummary(selected):null
 const visible=editing||filter==='all'?activities:taskSummary?.pending??[]
 const pageCount=Math.max(1,Math.ceil(visible.length/4)),currentPage=Math.min(page,pageCount-1),paged=visible.slice(currentPage*4,currentPage*4+4)
 useEffect(()=>{setPage(0);setOpenActivity(null);setCompleting(null)},[selected?.programId,preview,filter])
 const next=taskSummary?.next
 const pending=taskSummary?.pending.length??0
 const changed=selected&&preview?[...new Set([...selected.plan.activities.map(a=>a.id),...preview.plan.activities.map(a=>a.id)])].map(id=>({id,before:selected.plan.activities.find(a=>a.id===id),after:preview.plan.activities.find(a=>a.id===id)})).filter(item=>JSON.stringify(item.before)!==JSON.stringify(item.after)):[]
 const due=taskSummary?.due??[]
 const done=taskSummary?.done.length??0
 function status(a:GuideActivity){return selected?.completedActivityIds.includes(a.id)?'Selesai':a.hst===null?'Periksa HST':a.hst===(selected?.hst??0)?'Hari ini':a.hst!<(selected?.hst??0)?'Belum selesai':'Akan datang'}
 return <section className="gp-page" aria-label="Program dari Panduan">
  <div className="gp-program-toolbar"><div><h2>Program tanaman</h2></div><button type="button" disabled={busy||editing} onClick={()=>void run(reload)} aria-label="Muat ulang program"><RefreshCw size={20}/></button></div>
  {error&&<p role="alert" className="gp-error">{error}</p>}{notice&&<p role="status" className="gp-notice">{notice}</p>}
  <section className="gp-panel gp-program-bar" aria-label="Program tanaman terpilih">
   <span className="gp-crop-icon" aria-hidden="true"><Leaf size={28}/></span>
   <div className="gp-program-picker">{programs.length>0?<label>Pilih program<select value={selected?.programId??''} disabled={busy||editing} onChange={event=>{setSelected(programs.find(p=>p.programId===event.target.value)??null);setError('');setNotice('')}}><option value="" disabled>Pilih program tanaman</option>{programs.map(p=><option key={p.programId} value={p.programId}>{p.plan.cropName} · tanam {p.config.plantingDate}</option>)}</select></label>:<strong>{!loaded&&!error?'Memuat program…':'Belum ada program'}</strong>}</div>
   {selected&&<><span className="gp-age"><small>HST</small><strong>{selected.hst}</strong></span><div className="gp-bar-stat"><strong>{format(selected.plan.plants)}</strong><small>tanaman</small></div><div className="gp-bar-stat"><strong>{format(selected.plan.area)} m²</strong><small>{selected.config.basis==='area'?'Luas lahan':'Perkiraan luas'}</small></div></>}
   {admin&&<div className="gp-program-actions">{selected&&<button disabled={busy||editing} onClick={()=>start(selected)}>Ubah</button>}<button className="gp-primary" disabled={busy||editing} onClick={()=>start(null)}><Plus size={18}/>Program</button></div>}
  </section>
  <div className="gp-content">
  {editing&&<form className="gp-panel gp-form" onSubmit={e=>{e.preventDefault();void run(async()=>{setPreview(await previewGuideProgram(config()))})}}>
   <h3>{selected?'Tinjau perubahan program':'Buat program tanaman'}</h3>
   <fieldset disabled={busy} hidden={!!preview}><label>Tanaman<select value={form.cropId} onChange={e=>{setForm({...form,cropId:e.target.value});setPreview(null)}}>{source.sheets.map(s=><option key={s.id} value={s.id}>{s.cropName}</option>)}</select></label>
   <label>Tanggal tanam<input type="date" required value={form.plantingDate} onChange={e=>{setForm({...form,plantingDate:e.target.value});setPreview(null)}}/></label>
   <label>Hitung berdasarkan<select value={form.basis} onChange={e=>{setForm({...form,basis:e.target.value as ProgramForm['basis'],quantity:''});setPreview(null)}}><option value="plants">Jumlah tanaman</option><option value="area">Luas lahan</option></select></label>
   <label>{form.basis==='plants'?'Jumlah tanaman':'Luas lahan (m²)'}<input type="number" required min={form.basis==='plants'?1:0.001} max={1e7} step={form.basis==='plants'?1:'any'} value={form.quantity} onChange={e=>{setForm({...form,quantity:e.target.value});setPreview(null)}}/></label>
   <label>Perangkat (opsional)<select value={form.deviceId} onChange={e=>{setForm({...form,deviceId:e.target.value});setPreview(null)}}><option value="">Belum dihubungkan</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}</select></label>
   </fieldset>{preview&&<p className="gp-form-summary">{preview.plan.cropName} · tanam {form.plantingDate} · {format(Number(form.quantity))} {form.basis==='plants'?'tanaman':'m²'}</p>}<div className="gp-actions">{preview&&<button type="button" disabled={busy} onClick={()=>setPreview(null)}>Ubah pengaturan</button>}<button type="button" disabled={busy} onClick={()=>{setEditing(false);setPreview(null);setError('')}}>Batal</button><button className="gp-primary" disabled={busy} hidden={!!preview} type="submit">{busy?'Menghitung…':'Hitung & periksa kebutuhan'}</button></div>
   {preview&&<div className="gp-review"><p>{preview.plan.activities.length} kegiatan. Periksa kebutuhan sebelum menyimpan.</p>{selected&&<><p>Periksa ulang kegiatan yang berubah.</p><details><summary>{changed.length} kegiatan berubah · lihat perbandingan</summary>{changed.map(item=><section key={item.id} className="gp-diff"><strong>{item.after?.title??item.before?.title}</strong><p>Sebelum: {summary(item.before)}</p><p>Sesudah: {summary(item.after)}</p></section>)}</details>{selected.config.plantingDate!==form.plantingDate&&<p>Tanggal tanam berubah: {selected.config.plantingDate} → {form.plantingDate}. Catatan selesai lama tetap ada dalam riwayat.</p>}</>}<button className="gp-primary" type="button" disabled={busy} onClick={()=>void run(async()=>{const saved=await saveGuideProgram({config:config(),sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},selected??undefined);setPrograms(rows=>[saved,...rows.filter(p=>p.programId!==saved.programId)]);setSelected(saved);setEditing(false);setPreview(null);setLoaded(true);setNotice('Program tersimpan.')} )}><Check size={18}/>Simpan program ini</button></div>}
  </form>}
  {!editing&&selected?.sourceChanged&&<div className="gp-warning"><strong>Panduan diperbarui</strong>{admin&&<button disabled={busy} onClick={()=>start(selected)}>Tinjau perubahan</button>}</div>}
  {plan&&<>
   {!editing&&<div className="gp-view-tabs" role="group" aria-label="Tampilan kegiatan"><button type="button" aria-pressed={filter==='pending'} onClick={()=>setFilter('pending')}>Perlu dikerjakan ({pending})</button><button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Semua kegiatan</button><button type="button" aria-pressed={filter==='schedule'} onClick={()=>setFilter('schedule')}><CalendarDays size={18}/>Jadwal</button></div>}
   {!editing&&filter==='schedule'&&selected?<GuideSchedule key={`${selected.programId}:${selected.config.plantingDate}`} program={selected}/>:<div className={`gp-work-layout${editing?' is-editing':''}`}>
    <section className="gp-task-list" aria-label="Kegiatan tanaman">
     <h3>{editing?'Periksa kebutuhan':filter==='pending'?`${pending} kegiatan perlu dikerjakan`:'Semua kegiatan'}</h3>
     {!visible.length&&<div className="gp-panel"><h4>{filter==='pending'?'Tidak ada tugas tertunda':'Belum ada kegiatan'}</h4>{next&&<p>Berikutnya: HST {next.hst} · {next.title}</p>}</div>}
     {paged.map(a=><article className="gp-panel gp-task" key={a.id}>
      <div className="gp-task-heading"><span className="gp-task-hst">HST<strong>{a.hst??'—'}</strong></span><div><h4>{a.title}</h4><small>{a.method}</small><AutomationMethod method={a.method}/></div>{!editing&&<span className={`gp-status${selected?.completedActivityIds.includes(a.id)?' is-done':''}`}>{status(a)}</span>}</div>
      <div className="gp-task-main"><ul className="gp-task-targets">{a.requirements.map(r=><li key={r.row}><span>{r.product}</span><strong>{format(r.amount)} {r.unit}</strong></li>)}{!a.requirements.length&&<li>Kebutuhan belum tersedia</li>}{a.waterL!==null&&<li className="gp-task-water"><span>Larutan akhir</span><strong>{format(a.waterL)} L</strong></li>}</ul>
       <div className="gp-task-actions">{!editing&&operator&&selected&&a.hst!==null&&a.hst<=selected.hst&&!selected.completedActivityIds.includes(a.id)&&<button className="gp-primary" disabled={busy} onClick={()=>{setCompleting(completing===a.id?null:a.id);setCompletionNote('')}}><Check size={18}/>Tandai selesai</button>}
        <button type="button" aria-expanded={openActivity===a.id} aria-controls={`gp-body-${a.id}`} onClick={()=>setOpenActivity(openActivity===a.id?null:a.id)}>Detail<ChevronDown size={18}/></button>
       </div>
      </div>
      {completing===a.id&&selected&&<div className="gp-complete"><p>Sudah dilakukan sesuai kebutuhan di atas?</p><label>Catatan (opsional)<input maxLength={500} value={completionNote} onChange={e=>setCompletionNote(e.target.value)}/></label><div className="gp-actions"><button disabled={busy} onClick={()=>setCompleting(null)}>Batal</button><button className="gp-primary" disabled={busy} onClick={()=>void run(async()=>{await completeGuideProgram(selected,a.id,completionNote);await reload();setCompleting(null);setCompletionNote('');setNotice('Kegiatan tercatat selesai.')} )}>Ya, catat selesai</button></div></div>}
      <div id={`gp-body-${a.id}`} hidden={openActivity!==a.id} className="gp-task-detail">{a.warnings.map(w=><p className="gp-warning" key={w}>{w}</p>)}{a.requirements.map(r=><section key={r.row}><strong>{r.product}</strong><p>Dosis {format(r.dose)} {r.doseUnit} · acuan {format(r.sourceAmount)} {r.sourceUnit}</p>{r.warnings.map(w=><p className="gp-warning" key={w}>{w}</p>)}</section>)}</div>
     </article>)}
     {pageCount>1&&<nav className="gp-pagination" aria-label="Halaman kegiatan"><span>{currentPage*4+1}–{Math.min((currentPage+1)*4,visible.length)} dari {visible.length}</span><div><button type="button" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setOpenActivity(null);setCompleting(null)}}>Sebelumnya</button><button type="button" disabled={currentPage===pageCount-1} onClick={()=>{setPage(currentPage+1);setOpenActivity(null);setCompleting(null)}}>Berikutnya</button></div></nav>}
    </section>
    {!editing&&selected&&<aside className="gp-task-rail"><section className="gp-panel"><div className="gp-heading"><h3>Progres kegiatan</h3><strong>{done}/{due.length} selesai</strong></div><progress aria-label="Kegiatan terjadwal hingga hari ini yang selesai" max={Math.max(1,due.length)} value={done}/><div className="gp-progress-counts"><span><strong>{pending}</strong>Belum selesai</span><span><strong>{done}</strong>Selesai</span></div></section>
     <section className="gp-panel"><h3>Berikutnya</h3>{next?<><span className="gp-hst">HST {next.hst}</span><h4>{next.title}</h4><p>{next.method}</p><button type="button" onClick={()=>setFilter('schedule')}><CalendarDays size={18}/>Lihat jadwal</button></>:<p>Tidak ada kegiatan berikutnya.</p>}</section>
    </aside>}
   </div>}
  </>}
  {!editing&&!selected&&loaded&&<section className="gp-panel"><h3>Mulai dari Panduan tanaman</h3><p>Buat program untuk menyesuaikan kebutuhan bahan dan melihat kegiatan sesuai HST.</p></section>}
  {selected&&!editing&&<ProgramRevisionHistory programId={selected.programId} revision={selected.revision}/>}
  {selected&&!editing&&selected.completions.length>0&&<details className="gp-panel"><summary>Riwayat kegiatan</summary>{selected.completions.map(c=><p key={c.activityFingerprint}>{selected.plan.activities.find(a=>a.id===c.activityId)?.title??'Kegiatan'} · {new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(c.completedAt))} WIB · {c.actor}{c.note?` · ${c.note}`:''}</p>)}</details>}
  </div>
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
 return <details className="gp-panel" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Riwayat revisi program</summary>{loading&&<p>Memuat riwayat…</p>}{error&&<p role="alert">{error}</p>}{rows.map(item=><details key={item.revision}><summary>Program revisi {item.revision} · Panduan revisi {item.guideRevision}</summary><p>{item.actor} · {new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(item.savedAt))} WIB · tanam {item.config.plantingDate}</p><ActivityHistoryTable activities={item.plan.activities}/></details>)}{rows.length===20&&<p>Menampilkan 20 revisi terakhir.</p>}</details>
}

function ActivityHistoryTable({activities}:{activities:GuideActivity[]}){
 return <div className="gp-history-table-scroll" role="region" aria-label="Tabel kebutuhan kegiatan" tabIndex={0}>
  <table className="gp-history-table"><caption>Rincian kebutuhan kegiatan</caption>
   <thead><tr><th scope="col">HST</th><th scope="col">Kegiatan</th><th scope="col">Cara pemberian</th><th scope="col">Larutan (L)</th><th scope="col">Bahan</th><th scope="col">Dosis</th><th scope="col">Kebutuhan</th><th scope="col">Acuan</th></tr></thead>
   <tbody>{activities.flatMap(a=>{
    const materials=a.requirements.length?a.requirements:[null]
    return materials.map((r,i)=><tr key={`${a.id}-${r?.row??'empty'}`} className={i===0?'gp-history-activity-start':undefined}>
     {i===0&&<><td rowSpan={materials.length}>{a.hst??'—'}</td><th scope="rowgroup" rowSpan={materials.length}>{a.title}</th><td rowSpan={materials.length}>{a.method}</td><td rowSpan={materials.length}>{format(a.waterL)}</td></>}
     <td>{r?.product??'—'}</td><td>{r?`${format(r.dose)} ${r.doseUnit}`:'—'}</td><td>{r?`${format(r.amount)} ${r.unit}`:'—'}</td><td>{r?`${format(r.sourceAmount)} ${r.sourceUnit}`:'—'}</td>
    </tr>)
   })}</tbody>
  </table>
 </div>
}
