import {Fragment,useEffect,useRef,useState} from 'react'
import type {ApiDevice,AutomaticCycleStatus,GuideActivity,GuideProgram,GuideProgramConfig,GuideProgramPreview,GuideProgramRevision} from '@spff/contracts'
import {guideProgramConfigSchema} from '@spff/contracts'
import {Check,Plus,RefreshCw,ChevronDown,Leaf,CalendarDays} from 'lucide-react'
import {fetchAutomaticCycleStatus,fetchGuidePrograms,previewGuideProgram,saveGuideProgram,completeGuideProgram,fetchGuideProgramHistory} from './api'
import {useAuth} from './authContext'
import source from './data/protocolGuide.json'
import './GuidePrograms.css'
import {supportsFertigationAutomation,automaticGuideActivities} from './fertigationSupport'
import {GuideSchedule} from './GuideSchedule.tsx'
import {guideTaskSummary} from './guideSchedule.ts'
import {GuideEcSettings} from './GuideEcSettings'
import {useGuideEcConversions} from './useGuideEcConversions'
import {GuideEcTarget} from './GuideEcTarget'
import {AutomationMethod} from './AutomationMethod'
const format=(value:number|null)=>value===null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(value)
const initial=(cropId:string)=>({cropId,plantingDate:'',basis:'plants' as const,quantity:'',deviceId:'',waterEcMsCm:''})
type ProgramForm={cropId:string;plantingDate:string;basis:'plants'|'area';quantity:string;deviceId:string;waterEcMsCm:string}
function summary(a:GuideActivity|undefined){return a?`HST ${a.hst??'—'} · ${a.title} · ${a.method} · ${format(a.waterL)} L · ${a.requirements.map(r=>`${r.product}: ${format(r.amount)} ${r.unit} (dosis ${format(r.dose)} ${r.doseUnit}; acuan ${format(r.sourceAmount)} ${r.sourceUnit})`).join('; ')}`:'Tidak ada'}
export function GuidePrograms({devices}:{devices:ApiDevice[]}){
 const {user}=useAuth(),admin=user.role==='admin',operator=admin||user.role==='operator'
 const [programs,setPrograms]=useState<GuideProgram[]>([]),[selected,setSelected]=useState<GuideProgram|null>(null)
 const [cycle,setCycle]=useState<AutomaticCycleStatus|null>(null)
 const [form,setForm]=useState<ProgramForm>(()=>initial(source.sheets[0].id))
 const [editing,setEditing]=useState(false),[preview,setPreview]=useState<GuideProgramPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false)
 const [filter,setFilter]=useState<'pending'|'all'|'schedule'>('pending'),[completing,setCompleting]=useState<string|null>(null),[completionNote,setCompletionNote]=useState('')
 const [page,setPage]=useState(0),[openActivity,setOpenActivity]=useState<string|null>(null)
 const lock=useRef(false),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;void fetchGuidePrograms().then(rows=>{if(mounted.current){setPrograms(rows);setLoaded(true);if(rows[0])setSelected(rows[0])}}).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:'Gagal memuat program.')});return()=>{mounted.current=false}},[])
 useEffect(()=>{
  if(editing)return
  const timer=setInterval(()=>{if(lock.current)return;void fetchGuidePrograms().then(rows=>{if(mounted.current){setPrograms(rows);setSelected(current=>current?rows.find(p=>p.programId===current.programId)??null:current)}}).catch(()=>{})},60000)
  return()=>clearInterval(timer)
 },[editing])
 const deviceId=selected?.config.deviceId
 useEffect(()=>{
  if(!deviceId)return
  const controller=new AbortController()
  let pending=false
  async function refresh(device:string){
   if(pending)return
   pending=true
   try{
    const status=await fetchAutomaticCycleStatus(device,controller.signal)
    if(!controller.signal.aborted)setCycle(status)
   }catch{
    if(!controller.signal.aborted)setCycle(null)
   }finally{
    pending=false
   }
  }
  void refresh(deviceId)
  const timer=setInterval(()=>void refresh(deviceId),30000)
  return()=>{controller.abort();clearInterval(timer)}
 },[deviceId])
 const activePhase=cycle?.deviceId===deviceId&&cycle?.mode==='fertilization'&&
  cycle.phase?.programId===selected?.programId?cycle.phase:null
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await action()}catch(e){setError(e instanceof Error?e.message:'Permintaan gagal.')}finally{lock.current=false;if(mounted.current)setBusy(false)}}
 function config():GuideProgramConfig {const parsed=guideProgramConfigSchema.safeParse({...form,quantity:Number(form.quantity),deviceId:form.deviceId||null,waterEcMsCm:form.waterEcMsCm.trim()===''?undefined:Number(form.waterEcMsCm)});if(!parsed.success)throw new Error('Periksa tanggal tanam, jumlah tanaman/luas, dan EC air baku (0–20 mS/cm).');return parsed.data}
 function start(program:GuideProgram|null){setSelected(program);setPreview(null);setCompleting(null);setCompletionNote('');setError('');setNotice('');setEditing(true);setForm(program?{...program.config,quantity:String(program.config.quantity),deviceId:program.config.deviceId??'',waterEcMsCm:program.config.waterEcMsCm===undefined?'':String(program.config.waterEcMsCm)}:initial(source.sheets[0].id))}
 async function reload(){const rows=await fetchGuidePrograms();setPrograms(rows);setLoaded(true);if(selected)setSelected(rows.find(p=>p.programId===selected.programId)??null)}
 const conversions=useGuideEcConversions(!editing&&selected&&automaticGuideActivities(selected).length?selected:null)
 const formHasAutomation=selected?.config.cropId===form.cropId?automaticGuideActivities(selected).length>0:Object.entries(source.sheets.find(s=>s.id===form.cropId)?.cells??{}).some(([key,cell])=>/^D\d+$/.test(key)&&typeof cell.value==='string'&&supportsFertigationAutomation({method:cell.value}))
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
  <div className="gp-program-toolbar"><h2>Jadwal tanaman</h2><button type="button" disabled={busy||editing} onClick={()=>void run(reload)} aria-label="Muat ulang program"><RefreshCw size={20}/></button></div>
  {error&&<p role="alert" className="gp-error">{error}</p>}{notice&&<p role="status" className="gp-notice">{notice}</p>}
  <section className="gp-panel gp-program-bar" aria-label="Program tanaman terpilih">
   <span className="gp-crop-icon" aria-hidden="true"><Leaf size={28}/></span>
   <div className="gp-program-picker">{programs.length>0?<label>Pilih program<select value={selected?.programId??''} disabled={busy||editing} onChange={event=>{setSelected(programs.find(p=>p.programId===event.target.value)??null);setError('');setNotice('')}}><option value="" disabled>Pilih program tanaman</option>{programs.map(p=><option key={p.programId} value={p.programId}>{p.plan.cropName} · tanam {p.config.plantingDate}</option>)}</select></label>:<strong>{!loaded&&!error?'Memuat program…':'Belum ada program'}</strong>}</div>
   {selected&&<><span className="gp-age"><small>HST</small><strong>{selected.hst}</strong></span><div className="gp-bar-stat"><strong>{format(selected.plan.plants)}</strong><small>tanaman</small></div><div className="gp-bar-stat"><strong>{format(selected.plan.area)} m²</strong><small>{selected.config.basis==='area'?'Luas lahan':'Perkiraan luas'}</small></div></>}
   {admin&&<div className="gp-program-actions">{selected&&<button disabled={busy||editing} onClick={()=>start(selected)}>Ubah</button>}<button className="gp-primary" disabled={busy||editing} onClick={()=>start(null)}><Plus size={18}/>Buat program</button></div>}
  </section>
  <div className="gp-content">
  {editing&&<form className="gp-panel gp-form" onSubmit={e=>{e.preventDefault();void run(async()=>{setPreview(await previewGuideProgram(config()))})}}>
   <h3>{selected?'Tinjau perubahan program':'Buat program tanaman'}</h3>
   <fieldset disabled={busy} hidden={!!preview}><label>Tanaman<select value={form.cropId} onChange={e=>{setForm({...form,cropId:e.target.value});setPreview(null)}}>{source.sheets.map(s=><option key={s.id} value={s.id}>{s.cropName}</option>)}</select></label>
   <label>Tanggal tanam<input type="date" required value={form.plantingDate} onChange={e=>{setForm({...form,plantingDate:e.target.value});setPreview(null)}}/></label>
   <label>Hitung berdasarkan<select value={form.basis} onChange={e=>{setForm({...form,basis:e.target.value as ProgramForm['basis'],quantity:''});setPreview(null)}}><option value="plants">Jumlah tanaman</option><option value="area">Luas lahan</option></select></label>
   <label>{form.basis==='plants'?'Jumlah tanaman':'Luas lahan (m²)'}<input type="number" required min={form.basis==='plants'?1:0.001} max={1e7} step={form.basis==='plants'?1:'any'} value={form.quantity} onChange={e=>{setForm({...form,quantity:e.target.value});setPreview(null)}}/></label>
   <label>Perangkat (opsional)<select value={form.deviceId} onChange={e=>{setForm({...form,deviceId:e.target.value});setPreview(null)}}><option value="">Belum dihubungkan</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}</select></label>
   {formHasAutomation&&<label>EC air baku (mS/cm, untuk konversi)<input type="number" min="0" max="20" step="any" value={form.waterEcMsCm} onChange={e=>{setForm({...form,waterEcMsCm:e.target.value});setPreview(null)}} placeholder="Hasil ukur air sebelum diberi pupuk"/></label>}
   </fieldset>{preview&&<p className="gp-form-summary">{preview.plan.cropName} · tanam {form.plantingDate} · {format(Number(form.quantity))} {form.basis==='plants'?'tanaman':'m²'}</p>}<div className="gp-actions">{preview&&<button type="button" disabled={busy} onClick={()=>setPreview(null)}>Ubah pengaturan</button>}<button type="button" disabled={busy} onClick={()=>{setEditing(false);setPreview(null);setError('')}}>Batal</button><button className="gp-primary" disabled={busy} hidden={!!preview} type="submit">{busy?'Menghitung…':'Hitung & periksa kebutuhan'}</button></div>
   {preview&&<div className="gp-review"><p>{preview.plan.activities.length} kegiatan. Periksa kebutuhan sebelum menyimpan.</p>{selected&&<><p>Periksa ulang kegiatan yang berubah.</p><details><summary>{changed.length} kegiatan berubah · lihat perbandingan</summary>{changed.map(item=><section key={item.id} className="gp-diff"><strong>{item.after?.title??item.before?.title}</strong><p>Sebelum: {summary(item.before)}</p><p>Sesudah: {summary(item.after)}</p></section>)}</details>{selected.config.plantingDate!==form.plantingDate&&<p>Tanggal tanam berubah: {selected.config.plantingDate} → {form.plantingDate}. Catatan selesai lama tetap ada dalam riwayat.</p>}</>}<button className="gp-primary" type="button" disabled={busy} onClick={()=>void run(async()=>{const saved=await saveGuideProgram({config:config(),sourceSha256:preview.sourceSha256,guideRevision:preview.guideRevision},selected??undefined);setPrograms(rows=>[saved,...rows.filter(p=>p.programId!==saved.programId)]);setSelected(saved);setEditing(false);setPreview(null);setLoaded(true);setNotice('Program tersimpan.')} )}><Check size={18}/>Simpan program ini</button></div>}
  </form>}
  {!editing&&selected?.sourceChanged&&<div className="gp-warning"><strong>Panduan diperbarui</strong>{admin&&<button disabled={busy} onClick={()=>start(selected)}>Tinjau perubahan</button>}</div>}
  {!editing&&conversions.error&&<p className="gp-error" role="alert">{conversions.error}<button type="button" onClick={conversions.refresh}>Muat ulang target EC</button></p>}
  {plan&&<>
   {!editing&&<div className="gp-view-tabs" role="group" aria-label="Tampilan kegiatan"><button type="button" aria-pressed={filter==='pending'} onClick={()=>setFilter('pending')}>Perlu dikerjakan ({pending})</button><button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Semua kegiatan</button><button type="button" aria-pressed={filter==='schedule'} onClick={()=>setFilter('schedule')}><CalendarDays size={18}/>Jadwal</button></div>}
   {!editing&&filter==='schedule'&&selected?<GuideSchedule key={`${selected.programId}:${selected.config.plantingDate}`} program={selected} conversions={conversions.rows}/>:<div className="gp-work-layout">
    <section className="gp-task-list" aria-label="Kegiatan tanaman">
     <h3>{editing?'Periksa kebutuhan':filter==='pending'?`${pending} kegiatan perlu dikerjakan`:'Semua kegiatan'}</h3>
     {!visible.length&&<div className="gp-panel"><h4>{filter==='pending'?'Tidak ada tugas tertunda':'Belum ada kegiatan'}</h4>{next&&<p>Berikutnya: HST {next.hst} · {next.title}</p>}</div>}
     {paged.length>0&&<div className="gp-task-table-scroll" role="region" aria-label="Daftar kegiatan tanaman" tabIndex={0}>
      <table className="gp-task-table" aria-label="Kegiatan tanaman">
       <thead><tr>
        <th scope="col">HST</th>
        <th scope="col">Kegiatan</th>
        <th scope="col">Metode</th>
        <th scope="col">Kebutuhan</th>
        <th scope="col">Larutan akhir</th>
        {!editing&&<th scope="col">Status</th>}
        <th scope="col">Aksi</th>
       </tr></thead>
       <tbody>{paged.map(activity=>{
        const completed=selected?.completedActivityIds.includes(activity.id)
        const phase=activePhase?.activityId===activity.id?activePhase:null
        const canComplete=!editing&&operator&&selected&&activity.hst!==null&&activity.hst<=selected.hst&&!completed
        const detailsOpen=openActivity===activity.id
        const confirmationOpen=completing===activity.id
        const conversion=conversions.rows.find(row=>row.activityId===activity.id)
        return <Fragment key={activity.id}>
         <tr className="gp-task-row">
          <td className="gp-task-number">{activity.hst??'—'}</td>
          <th scope="row">{activity.title}</th>
          <td><div className="gp-task-method">{activity.method}{supportsFertigationAutomation(activity)&&<AutomationMethod method={activity.method}/>}</div></td>
          <td>{activity.requirements.length>0?<ul className="gp-task-materials">
           {activity.requirements.map(material=><li key={material.row}>{material.product} <strong>{format(material.amount)} {material.unit}</strong></li>)}
          </ul>:<small>Belum tersedia</small>}</td>
          <td className="gp-task-number">{activity.waterL===null?'—':`${format(activity.waterL)} L`}</td>
          {!editing&&<td><span className={`gp-status${phase?' is-current-phase':completed?' is-done':''}`}>
           {phase?`Pemupukan ke-${phase.phaseNumber}`:status(activity)}
          </span></td>}
          <td><div className="gp-task-actions">
           {canComplete&&<button type="button" className="gp-primary" disabled={busy} aria-expanded={confirmationOpen} onClick={()=>{setCompleting(confirmationOpen?null:activity.id);setCompletionNote('')}}><Check size={16} aria-hidden="true"/>Tandai selesai</button>}
           <button type="button" aria-expanded={detailsOpen} aria-controls={`gp-body-${activity.id}`} onClick={()=>setOpenActivity(detailsOpen?null:activity.id)}>Detail<ChevronDown size={16} aria-hidden="true"/></button>
          </div></td>
         </tr>
         <tr className="gp-task-expanded" hidden={!detailsOpen&&!confirmationOpen}>
          <td colSpan={editing?6:7}>
           {confirmationOpen&&selected&&<div className="gp-complete">
            <p>Sudah dilakukan sesuai kebutuhan di atas?</p>
            <label>Catatan (opsional)<input maxLength={500} value={completionNote} onChange={event=>setCompletionNote(event.target.value)}/></label>
            <div className="gp-actions">
             <button type="button" disabled={busy} onClick={()=>setCompleting(null)}>Batal</button>
             <button type="button" className="gp-primary" disabled={busy} onClick={()=>void run(async()=>{
              await completeGuideProgram(selected,activity.id,completionNote)
              await reload()
              setCompleting(null)
              setCompletionNote('')
              setNotice('Kegiatan tercatat selesai.')
             })}>Ya, catat selesai</button>
            </div>
           </div>}
           <div id={`gp-body-${activity.id}`} hidden={!detailsOpen}>
            {!editing&&supportsFertigationAutomation(activity)&&<GuideEcTarget activity={activity} conversion={conversion} error={conversions.error}/>}
            {!editing&&admin&&selected&&supportsFertigationAutomation(activity)&&<GuideEcSettings key={`${selected.programId}:${activity.id}`} program={selected} activity={activity} conversion={conversion} onSaved={conversions.refresh} onWater={()=>start(selected)}/>}
            {activity.warnings.map(warning=><p className="gp-warning" key={warning}>{warning}</p>)}
            {activity.requirements.map(material=><section key={material.row}>
             <strong>{material.product}</strong>
             <p>Dosis {format(material.dose)} {material.doseUnit} · acuan {format(material.sourceAmount)} {material.sourceUnit}</p>
             {material.warnings.map(warning=><p className="gp-warning" key={warning}>{warning}</p>)}
            </section>)}
           </div>
          </td>
         </tr>
        </Fragment>
       })}</tbody>
      </table>
     </div>}
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
