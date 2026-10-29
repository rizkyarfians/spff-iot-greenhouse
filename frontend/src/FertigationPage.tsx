import {missingProgramField,programFieldStep} from './programWizard'
import { SoilEcPulsePanel } from './SoilEcPulsePanel'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Droplets, FlaskConical, ArrowRight, ArrowLeft, Check, ChevronRight } from 'lucide-react'
import { cropProfiles, fertigationRecipeMutationSchema, fertigationLiveDecisionSchema, type ApiDevice, type FertigationRecipe, type FertigationLiveDecision } from '@spff/contracts'
import { ApiError, fetchFertigationRecipes, saveFertigationRecipe, evaluateFertigationSite } from './api'
import { useAuth } from './authContext'
import './FertigationPage.css'
import './GuidePrograms.css'

const GuidePrograms=lazy(()=>import('./GuidePrograms').then(module=>({default:module.GuidePrograms})))

const empty = () => ({ cropId: '', cropName: '', hstFrom: '', hstTo: '', targetWaterL: '', targetStockL: '0', fertilizerName: '', stockConcentrationGPerL: '', minWaterTankPercent: '', minStockTankPercent: '', sourceReference: '', plantingDate: '', applicationDate: '', applicationMode: 'sensor', applicationIntervalDays: '', triggerSampleCount: '3', moistureLowPercent: '', moistureTargetPercent: '', ecLowUsCm: '', ecTargetUsCm: '', ecHighUsCm: '' })
type Form = ReturnType<typeof empty>
const fields: { key: keyof Form; label: string; type: string; max?: number; hint?: string; placeholder?: string }[] = [
  { key: 'plantingDate', label: 'Tanggal tanam', type: 'date' },
  { key: 'hstFrom', label: 'Mulai umur (hari)', type: 'number', max: 1000 },
  { key: 'hstTo', label: 'Sampai umur (hari)', type: 'number', max: 1000 },
  { key: 'triggerSampleCount', label: 'Konfirmasi kering (bacaan)', type: 'number', max: 20, hint: 'Jumlah bacaan rendah berturut-turut sebelum menyarankan penyiraman.' },
  { key: 'targetWaterL', label: 'Batas air per penyiraman (L)', type: 'number', max: 100000, hint: 'Acuan rekomendasi, bukan batas penghentian pompa.' },
  { key: 'targetStockL', label: 'Larutan dari tandon pupuk sekali pemberian (liter)', type: 'number', max: 100000 },
  { key: 'fertilizerName', label: 'Nama pupuk', type: 'text' },
  { key: 'stockConcentrationGPerL', label: 'Pupuk dalam setiap 1 liter larutan tandon (gram)', type: 'number', max: 10000, hint: 'Gram pupuk ÷ liter larutan.' },
  { key: 'minWaterTankPercent', label: 'Sisa air minimum di tandon (%)', type: 'number', max: 100, hint: 'Rekomendasi ditunda di bawah batas ini.' },
  { key: 'minStockTankPercent', label: 'Sisa larutan pupuk minimum di tandon (%)', type: 'number', max: 100, hint: 'Rekomendasi ditunda di bawah batas ini.' },
  { key: 'moistureLowPercent', label: 'Batas kelembapan rendah (%)', type: 'number', max: 100, hint: 'Penyiraman disarankan saat bacaan sama dengan atau lebih rendah dari batas ini.' },
  { key: 'moistureTargetPercent', label: 'Target kelembapan (%)', type: 'number', max: 100, hint: 'Acuan rekomendasi. Aturan pompa diatur di Kontrol.' },
  { key: 'ecLowUsCm', label: 'Batas mulai EC aturan (µS/cm)', type: 'number', max: 100000 },
  { key: 'ecTargetUsCm', label: 'Target EC aturan (µS/cm)', type: 'number', max: 100000 },
  { key: 'ecHighUsCm', label: 'Batas EC aturan tertinggi (µS/cm)', type: 'number', max: 100000 },
]
const fieldGroups: { title: string; keys: (keyof Form)[]; fertilizerOnly?: boolean }[] = [
  {title: 'Masa berlaku', keys: ['plantingDate', 'hstFrom', 'hstTo']},
  {title: 'Penyiraman', keys: ['moistureLowPercent', 'moistureTargetPercent', 'targetWaterL', 'triggerSampleCount']},
  {title: 'Pemberian pupuk', fertilizerOnly: true, keys: ['fertilizerName', 'stockConcentrationGPerL', 'targetStockL', 'ecLowUsCm', 'ecTargetUsCm', 'ecHighUsCm']},
  {title: 'Isi tandon', keys: ['minWaterTankPercent', 'minStockTankPercent']},
]

function effectiveDate(plantingDate: string, days: string) {
  if (!plantingDate || !days.trim() || !Number.isInteger(Number(days)) || Number(days) < 0) return null
  const date = new Date(`${plantingDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + Number(days))
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('id-ID', {timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric'}).format(date) : null
}
function message(error: unknown) {
  if (error instanceof ApiError && error.status === 530) return 'Koneksi terputus. Coba muat ulang.'
  return error instanceof ApiError ? `${error.message}${error.errors.length ? ' — '+error.errors.join(', ') : ''}${error.status === 409 ? ' Muat ulang daftar lalu pilih ulang program sebelum mengedit.' : ''}` : error instanceof Error ? error.message : 'Permintaan gagal.'
}
export function FertigationPage({devices}:{devices:ApiDevice[]}){
  const [tab,setTab]=useState<'guide'|'sensor'>('guide')
  return <section className="ft-program-shell"><div className="gp-main-tabs" role="group" aria-label="Jenis program">
    <button aria-pressed={tab==='guide'} onClick={()=>setTab('guide')}>Program dari Panduan</button>
    <button aria-pressed={tab==='sensor'} onClick={()=>setTab('sensor')}>Aturan sensor & pompa</button>
  </div><div hidden={tab!=='guide'}><Suspense fallback={<p>Memuat program Panduan…</p>}><GuidePrograms devices={devices}/></Suspense></div><div hidden={tab!=='sensor'}><SensorFertigationPage devices={devices}/></div></section>
}
function SensorFertigationPage({ devices }: { devices: ApiDevice[] }) {
  const { user } = useAuth()
  const admin = user.role === 'admin'
  const operator = admin || user.role === 'operator'
  const [recipes, setRecipes] = useState<FertigationRecipe[]>([])
  const [selected, setSelected] = useState<FertigationRecipe>()
  const [form, setForm] = useState<Form>(empty)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const errorBox=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(error)errorBox.current?.focus()},[error])
  const [loaded, setLoaded] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const [result, setResult] = useState<FertigationLiveDecision>()
  const [withFertilizer, setWithFertilizer] = useState(false)
  const [step,setStep]=useState(0)
  const editorForm=useRef<HTMLFormElement>(null)
  const stepHeading=useRef<HTMLHeadingElement>(null)
  const [advanced,setAdvanced]=useState(false)
  function goStep(next:number){setStep(next);setError('');requestAnimationFrame(()=>stepHeading.current?.focus())}

  function select(recipe?: FertigationRecipe) {
    setStep(recipe?2:0);setAdvanced(false)
    setWithFertilizer((recipe?.targetStockL ?? 0) > 0)
    setSelected(recipe); setResult(undefined); setError(''); setNotice('')
    const next = empty()
    if (recipe) for (const key of Object.keys(next) as (keyof Form)[]) next[key] = recipe[key] == null ? '' : String(recipe[key])
    next.applicationMode = 'sensor'; next.applicationDate = ''; next.applicationIntervalDays = ''
    setForm(next)
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(message(e)) } finally { lock.current = false; setBusy(false) }
  }
  async function reload() {
    const rows = await fetchFertigationRecipes()
    setRecipes(rows); setLoaded(true)
    if (selected) select(rows.find(row => row.recipeId === selected.recipeId))
  }
  useEffect(() => { let active = true; fetchFertigationRecipes().then(rows => { if (active) { setRecipes(rows); setLoaded(true) } }).catch(e => { if (active) setError(message(e)) }); return () => { active = false } }, [])
  useEffect(()=>{if(devices.length===1)setDeviceId(devices[0].deviceId)},[devices])
  const dirty = selected && (withFertilizer !== (selected.targetStockL > 0) || (Object.keys(form) as (keyof Form)[]).some(key => form[key] !== (selected[key] == null ? '' : String(selected[key]))))
  function validatedInput() {
    const missing=missingProgramField(form,withFertilizer)
    if(missing){setStep(programFieldStep(missing));throw new Error(`Lengkapi ${fields.find(item=>item.key===missing)?.label??'tanaman'} sebelum menyimpan program.`)}
    const input = Object.fromEntries(fields.map(({key, type}) => [key, type === 'number' ? (form[key].trim() === '' ? null : Number(form[key])) : form[key].trim()]))
    input.cropId = form.cropId
    input.cropName = cropProfiles.find(crop => crop.id === form.cropId)?.commonName ?? ''
    input.sourceReference = selected?.sourceReference ?? ''
    input.applicationMode = 'sensor'
    input.applicationIntervalDays = null
    input.plantingDate = form.plantingDate || null
    input.applicationDate = null
    if (withFertilizer && !(Number(form.targetStockL) > 0)) {setStep(1);throw new Error('Isi volume larutan pupuk lebih dari 0 liter untuk pilihan Air dan pupuk.')}
    if (!withFertilizer) {
      input.targetStockL = 0; input.fertilizerName = null; input.stockConcentrationGPerL = null
      input.ecLowUsCm = null; input.ecTargetUsCm = null; input.ecHighUsCm = null
      input.minStockTankPercent = form.minStockTankPercent.trim() ? Number(form.minStockTankPercent) : 0
    }
    const parsed = fertigationRecipeMutationSchema.safeParse({ ...input, useForEvaluation: true })
    if (!parsed.success) {
      const key=parsed.error.issues[0]?.path[0]
      setStep(programFieldStep(key))
      if(key==='triggerSampleCount')setAdvanced(true)
      throw new Error(parsed.error.issues.map(i => {
        const key = i.path[0]
        const label = fields.find(field => field.key === key)?.label ?? (key === 'cropId' ? 'Tanaman' : 'Pengaturan program')
        return `${label}: ${i.message}`
      }).join('; '))
    }
    return parsed.data
  }
  async function save() {
    const saved = await saveFertigationRecipe(validatedInput(), selected)
    select(saved); setRecipes(rows => [saved, ...rows.filter(r => r.recipeId !== saved.recipeId)]); setLoaded(true)
    setStep(2)
    setNotice('Program tersimpan untuk evaluasi. Pompa tidak dinyalakan oleh tombol simpan.')
  }
  const titles=['Tanaman & umur','Kebutuhan tanaman','Periksa & simpan']
  const display=(key:keyof Form,unit='')=>form[key].trim()?`${form[key]}${unit}`:'Belum diisi'
  function field(key:keyof Form){
    const {label,type,max,hint,placeholder}=fields.find(item=>item.key===key)!
    return <div className="ft-form-field" key={key}><label htmlFor={`program-${key}`}><span>{label}</span><input id={`program-${key}`} type={type} value={form[key]}
      min={type==='number'?(key==='triggerSampleCount'?1:0):undefined} max={max}
      step={key==='hstFrom'||key==='hstTo'||key==='triggerSampleCount'?1:'any'}
      required={key!=='triggerSampleCount'} placeholder={placeholder} maxLength={120}
      onChange={e=>{setForm(current=>({...current,[key]:e.target.value}));setResult(undefined)}}/></label>
      {hint&&<details className="ft-input-help"><summary>Petunjuk pengisian</summary><p>{hint}</p></details>}
    </div>
  }
  function next(){
    if(!admin){goStep(Math.min(2,step+1));return}
    if(!editorForm.current?.reportValidity())return
    if(step===0){
      if(Number(form.hstFrom)>Number(form.hstTo)){setError('Umur akhir harus sama atau lebih besar dari umur mulai.');return}
      goStep(1)
    }else void run(async()=>{validatedInput();goStep(2)})
  }
  return <section className="fertigation-test ft-guided">
    <header className="ft-intro"><p>Atur kebutuhan tanaman dalam 3 langkah.</p></header>
    {error && <div ref={errorBox} tabIndex={-1} role="alert" className="ft-error">{error}</div>}
    {notice && <div role="status" className="ft-notice">{notice}</div>}
    <div className="ft-layout"><aside className="ft-panel ft-sidebar"><div className="ft-actions"><h3>Program tanaman</h3><button className="ft-icon-button" title="Muat ulang program" aria-label="Muat ulang program" disabled={busy} onClick={() => void run(reload)}><RefreshCw size={20}/></button></div>
      {admin && <button className="ft-new-button" disabled={busy} onClick={() => select()}><Plus size={20}/> Buat program</button>}
      {!loaded && !error && <p>Memuat program…</p>}
      {loaded && recipes.length === 0 && <p>Belum ada program tersimpan.</p>}
      <div className="ft-program-list">{recipes.map(recipe => {
        const chosen=selected?.recipeId===recipe.recipeId
        const enabled=recipe.approvalStatus==='approved'
        const Icon=recipe.targetStockL>0?FlaskConical:Droplets
        return <button className={`ft-recipe ft-program-card${chosen?' active':''}`} key={recipe.recipeId} disabled={busy} aria-pressed={chosen} onClick={()=>select(recipe)}>
          <span className="ft-program-card-heading"><strong>{recipe.cropName}</strong>
            <span className={`ft-program-status${enabled?' is-enabled':''}`} title="Status penggunaan aturan untuk evaluasi, bukan status pompa"><span aria-hidden="true"/>{enabled?'Aktif':'Nonaktif'}</span>
          </span>
          <span className="ft-program-kind"><Icon size={18} aria-hidden="true"/>{recipe.targetStockL>0?'Air dan pupuk':'Air saja'}</span>
          <span className="ft-program-age">Umur <b>{recipe.hstFrom}–{recipe.hstTo} hari</b></span>
          <span className="ft-program-usage">{enabled?'Aktif untuk evaluasi':'Belum digunakan untuk evaluasi'}</span>
          <span className="ft-program-open">{chosen?<><Check size={16} aria-hidden="true"/>Sedang dibuka</>:<>Buka program<ChevronRight size={17} aria-hidden="true"/></>}</span>
        </button>
      })}</div>
    </aside><div className="ft-panel ft-editor">
      <div className="ft-editor-heading"><h3>{selected ? selected.cropName : 'Buat program tanaman'}</h3>{dirty&&<span className="ft-draft-badge">Ada perubahan</span>}</div>
      <ol className="ft-steps" aria-label="Langkah pengaturan">{titles.map((title,index)=><li key={title} aria-current={step===index?'step':undefined} className={step===index?'is-current':step>index?'is-complete':''}>
        <span>{step>index?<Check size={18} aria-hidden="true"/>:index+1}</span><strong>{title}</strong>
      </li>)}</ol>
      <div className="ft-step-title"><span>Langkah {step+1} dari 3</span><h3 ref={stepHeading} tabIndex={-1}>{titles[step]}</h3></div>
      {!admin && <p>Hanya Admin yang dapat mengubah aturan.</p>}
      <form ref={editorForm} onSubmit={e=>{e.preventDefault();if(step<2)next();else if(admin)void run(save)}}>
      <fieldset disabled={!admin || busy}>
      {step===0&&<div className="ft-step-body">
        <label>Tanaman<select required value={form.cropId} onChange={e=>{
          const crop=cropProfiles.find(item=>item.id===e.target.value)
          setForm({...form,cropId:crop?.id??'',cropName:crop?.commonName??''});setResult(undefined)
        }}><option value="">Pilih tanaman</option>{cropProfiles.map(crop=><option key={crop.id} value={crop.id}>{crop.commonName}</option>)}</select></label>
        <fieldset className="ft-delivery"><legend>Apa yang dibutuhkan tanaman?</legend><div className="ft-delivery-options">
          <button type="button" aria-pressed={!withFertilizer} className={!withFertilizer?'is-selected':''} onClick={()=>{setWithFertilizer(false);setResult(undefined)}}><Droplets size={24} aria-hidden="true"/><span><strong>Air saja</strong><small>Atur penyiraman</small></span>{!withFertilizer&&<Check size={20} aria-hidden="true"/>}</button>
          <button type="button" aria-pressed={withFertilizer} className={withFertilizer?'is-selected':''} onClick={()=>{setWithFertilizer(true);setResult(undefined)}}><FlaskConical size={24} aria-hidden="true"/><span><strong>Air dan pupuk</strong><small>Atur penyiraman dan pemupukan</small></span>{withFertilizer&&<Check size={20} aria-hidden="true"/>}</button>
        </div></fieldset>
        <section className="ft-form-block"><h4>Kapan tanaman ditanam?</h4>{field('plantingDate')}<p className="ft-short-hint">Tanggal tanam digunakan untuk menghitung umur tanaman.</p></section>
        <section className="ft-form-block"><h4>Aturan berlaku pada umur</h4><div className="ft-fields">{field('hstFrom')}{field('hstTo')}</div>
          {effectiveDate(form.plantingDate,form.hstFrom)&&effectiveDate(form.plantingDate,form.hstTo)&&<p className="ft-date-preview">{effectiveDate(form.plantingDate,form.hstFrom)} – {effectiveDate(form.plantingDate,form.hstTo)}</p>}
        </section>
        {selected&&selected.applicationMode!=='sensor'&&<p role="status">Simpan ulang untuk memakai pemicu sensor. Jadwal lama tetap berlaku sampai perubahan disimpan.</p>}
        {selected&&!selected.cropId&&<p role="status">Pilih tanaman untuk menghubungkan program lama.</p>}
      </div>}
      {step===1&&<div className="ft-step-body">
        {fieldGroups.filter(group=>group.title!=='Masa berlaku'&&(!group.fertilizerOnly||withFertilizer)).map(group=><section className="ft-form-block" key={group.title}>
          <h4>{group.title}</h4><div className="ft-fields">{group.keys.filter(key=>key!=='triggerSampleCount'&&(withFertilizer||key!=='minStockTankPercent')).map(field)}</div>
        </section>)}
        <details className="ft-confirmation-settings" open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}><summary>Pengaturan konfirmasi sensor</summary>{field('triggerSampleCount')}</details>
      </div>}
      {step===2&&<div className="ft-step-body">
        <div className="ft-review-title"><strong>{form.cropName||'Tanaman belum dipilih'}</strong><span>{withFertilizer?'Air dan pupuk':'Air saja'}</span></div>
        <section className="ft-review-section"><div><h4>Tanaman & umur</h4><button type="button" className="ft-review-edit" onClick={()=>goStep(0)}>Ubah</button></div>
          <dl><div><dt>Tanggal tanam</dt><dd>{form.plantingDate?effectiveDate(form.plantingDate,'0'):'Belum diisi'}</dd></div><div><dt>Umur berlaku</dt><dd>{display('hstFrom')}–{display('hstTo')} hari</dd></div></dl>
        </section>
        <section className="ft-review-section"><div><h4>Kebutuhan tanaman</h4><button type="button" className="ft-review-edit" onClick={()=>goStep(1)}>Ubah</button></div>
          <dl><div><dt>Konfirmasi sensor</dt><dd>{display('triggerSampleCount',' bacaan')}</dd></div><div><dt>Kelembapan mulai / target</dt><dd>{display('moistureLowPercent','%')} / {display('moistureTargetPercent','%')}</dd></div><div><dt>Air per penyiraman</dt><dd>{display('targetWaterL',' L')}</dd></div><div><dt>Minimum tandon air</dt><dd>{display('minWaterTankPercent','%')}</dd></div>
            {withFertilizer&&<><div><dt>Pupuk</dt><dd>{display('fertilizerName')}</dd></div><div><dt>Larutan pupuk per pemberian</dt><dd>{display('targetStockL',' L')}</dd></div><div><dt>Konsentrasi larutan pupuk</dt><dd>{display('stockConcentrationGPerL',' g/L')}</dd></div><div><dt>EC mulai / target / maksimum</dt><dd>{display('ecLowUsCm')} / {display('ecTargetUsCm')} / {display('ecHighUsCm')} µS/cm</dd></div><div><dt>Minimum tandon pupuk</dt><dd>{display('minStockTankPercent','%')}</dd></div></>}
          </dl>
        </section>
        <p className="ft-save-explanation">Simpan untuk evaluasi tanaman. Tindakan ini tidak menyalakan pompa.</p>
      </div>}
      </fieldset><div className="ft-wizard-actions">
        {step>0&&<button type="button" disabled={busy} onClick={()=>goStep(step-1)}><ArrowLeft size={20} aria-hidden="true"/> Kembali</button>}
        {step<2?<button className="ft-primary" type="submit" disabled={busy||(!admin&&!selected)}>{step===0?'Lanjut: kebutuhan tanaman':'Periksa program'}<ArrowRight size={20} aria-hidden="true"/></button>:admin&&<button className="ft-primary" type="submit" disabled={busy}>{busy?'Menyimpan…':'Simpan program'}<Check size={20} aria-hidden="true"/></button>}
      </div>
      </form>
      {selected && step===2 && <section className="ft-device-selection" aria-label="Perangkat program">
        <label>Perangkat program<select disabled={busy} value={deviceId} onChange={e => { setDeviceId(e.target.value); setResult(undefined) }}><option value="">Pilih perangkat</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}</select></label>
      </section>}
      {selected && step===2 && withFertilizer && <SoilEcPulsePanel key={selected.recipeId} recipe={selected} deviceId={deviceId} admin={admin} operator={operator} dirty={!!dirty}/>}
      {selected && step===2 && <details className="ft-evaluation"><summary>Periksa rekomendasi penyiraman</summary><p>Rekomendasi penyiraman berdasarkan kondisi tanaman.</p><p>Status aturan: <strong>{selected.approvalStatus === 'approved' ? 'Digunakan untuk evaluasi' : 'Belum digunakan'}</strong></p>
        {dirty && <p className="ft-error">Ada perubahan belum disimpan. Simpan dahulu atau pilih ulang program.</p>}

        <button className="ft-primary" disabled={busy || !!dirty || !operator || !deviceId} onClick={() => void run(async () => { setResult(undefined); const response = await evaluateFertigationSite(selected.recipeId, deviceId); setResult(fertigationLiveDecisionSchema.parse(response)) })}>Periksa kondisi tanaman</button>
        {result && <div className="ft-result" role="status"><h3>{result.decision.action === 'DELAY' ? 'Ditunda' : 'Rekomendasi tersedia'}</h3><p>HST: {result.hst ?? 'belum tersedia'} · air: {result.decision.targetWaterL ?? '—'} L · stok: {result.decision.targetStockL ?? '—'} L</p><p>Tanaman cocok: {cropProfiles.find(crop => crop.id === result.activeCropId)?.commonName ?? 'Belum cocok / belum dipilih'} · kelembapan tanah: {result.observations.soilMoisturePercent ?? '—'} % · EC larutan: {result.observations.liquidEcUsCm ?? '—'} µS/cm</p><p>Rekomendasi ini tidak menyalakan pompa.</p><ul>{result.decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul><p>Diperiksa {new Intl.DateTimeFormat('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(result.siteObservedAt))} WIB</p></div>}
      </details>}
    </div></div>
  </section>
}
