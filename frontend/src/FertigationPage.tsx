import { useEffect, useRef, useState } from 'react'
import { cropProfiles, fertigationRecipeMutationSchema, fertigationLiveDecisionSchema, type ApiDevice, type FertigationRecipe, type FertigationLiveDecision } from '@spff/contracts'
import { ApiError, fetchFertigationRecipes, saveFertigationRecipe, approveFertigationRecipe, evaluateFertigationSite } from './api'
import { useAuth } from './authContext'
import './FertigationPage.css'

const empty = () => ({ cropId: '', cropName: '', hstFrom: '', hstTo: '', targetWaterL: '', targetStockL: '0', fertilizerName: '', stockConcentrationGPerL: '', minWaterTankPercent: '', minStockTankPercent: '', sourceReference: '', plantingDate: '', applicationDate: '', applicationMode: 'sensor', applicationIntervalDays: '', triggerSampleCount: '3', moistureLowPercent: '', moistureTargetPercent: '', ecLowUsCm: '', ecTargetUsCm: '', ecHighUsCm: '' })
type Form = ReturnType<typeof empty>
const fields: { key: keyof Form; label: string; type: string; max?: number; hint?: string; placeholder?: string }[] = [
  { key: 'plantingDate', label: 'Tanggal tanam', type: 'date' },
  { key: 'hstFrom', label: 'Mulai dipakai saat tanaman berumur (hari)', type: 'number', max: 1000 },
  { key: 'hstTo', label: 'Dipakai sampai tanaman berumur (hari)', type: 'number', max: 1000 },
  { key: 'triggerSampleCount', label: 'Konfirmasi tanah kering (kali pembacaan)', type: 'number', max: 20, hint: 'Jumlah bacaan rendah berturut-turut sebelum menyarankan penyiraman.' },
  { key: 'targetWaterL', label: 'Air paling banyak sekali penyiraman (liter)', type: 'number', max: 100000 },
  { key: 'targetStockL', label: 'Larutan dari tandon pupuk sekali pemberian (liter)', type: 'number', max: 100000 },
  { key: 'fertilizerName', label: 'Nama pupuk', type: 'text' },
  { key: 'stockConcentrationGPerL', label: 'Pupuk dalam setiap 1 liter larutan tandon (gram)', type: 'number', max: 10000, hint: 'Isi gram pupuk dibagi liter larutan. Contoh hitung: 100 gram dalam 10 liter = 10 g/L, bukan anjuran dosis.' },
  { key: 'minWaterTankPercent', label: 'Sisa air minimum di tandon (%)', type: 'number', max: 100, hint: 'Penyiraman ditahan jika isi tandon di bawah angka ini.' },
  { key: 'minStockTankPercent', label: 'Sisa larutan pupuk minimum di tandon (%)', type: 'number', max: 100 },
  { key: 'moistureLowPercent', label: 'Mulai menyiram saat kelembapan tanah mencapai (%)', type: 'number', max: 100, hint: 'Penyiraman disarankan saat bacaan sama dengan atau lebih rendah dari batas ini.' },
  { key: 'moistureTargetPercent', label: 'Target kelembapan tanah setelah disiram (%)', type: 'number', max: 100 },
  { key: 'ecLowUsCm', label: 'Mulai memberi pupuk saat EC larutan mencapai (µS/cm)', type: 'number', max: 100000 },
  { key: 'ecTargetUsCm', label: 'Target EC larutan setelah diberi pupuk (µS/cm)', type: 'number', max: 100000 },
  { key: 'ecHighUsCm', label: 'Batas EC larutan tertinggi (µS/cm)', type: 'number', max: 100000 },
]
const fieldGroups: { title: string; keys: (keyof Form)[]; fertilizerOnly?: boolean }[] = [
  {title: 'Umur tanaman yang memakai aturan ini', keys: ['plantingDate', 'hstFrom', 'hstTo']},
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
  return error instanceof ApiError ? `${error.message}${error.errors.length ? ' — '+error.errors.join(', ') : ''}${error.status === 409 ? ' Muat ulang daftar lalu pilih ulang program sebelum mengedit.' : ''}` : error instanceof Error ? error.message : 'Permintaan gagal.'
}
export function FertigationPage({ devices }: { devices: ApiDevice[] }) {
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
  const [loaded, setLoaded] = useState(false)
  const [reference, setReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const [result, setResult] = useState<FertigationLiveDecision>()
  const [withFertilizer, setWithFertilizer] = useState(false)
  function select(recipe?: FertigationRecipe) {
    setWithFertilizer((recipe?.targetStockL ?? 0) > 0)
    setSelected(recipe); setReference(''); setConfirmed(false); setResult(undefined); setError(''); setNotice('')
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
  const dirty = selected && (withFertilizer !== (selected.targetStockL > 0) || (Object.keys(form) as (keyof Form)[]).some(key => form[key] !== (selected[key] == null ? '' : String(selected[key]))))
  async function save() {
    const input = Object.fromEntries(fields.map(({key, type}) => [key, type === 'number' ? (form[key].trim() === '' ? null : Number(form[key])) : form[key].trim()]))
    input.cropId = form.cropId
    input.cropName = cropProfiles.find(crop => crop.id === form.cropId)?.commonName ?? ''
    input.sourceReference = selected?.sourceReference ?? ''
    input.applicationMode = 'sensor'
    input.applicationIntervalDays = null
    input.plantingDate = form.plantingDate || null
    input.applicationDate = null
    if (withFertilizer && !(Number(form.targetStockL) > 0)) throw new Error('Isi volume larutan pupuk lebih dari 0 liter untuk pilihan Air dan pupuk.')
    if (!withFertilizer) {
      input.targetStockL = 0; input.fertilizerName = null; input.stockConcentrationGPerL = null
      input.ecLowUsCm = null; input.ecTargetUsCm = null; input.ecHighUsCm = null
      input.minStockTankPercent = form.minStockTankPercent.trim() ? Number(form.minStockTankPercent) : 0
    }
    const parsed = fertigationRecipeMutationSchema.safeParse(input)
    if (!parsed.success) throw new Error(parsed.error.issues.map(i => {
      const key = i.path[0]
      const label = fields.find(field => field.key === key)?.label ?? (key === 'cropId' ? 'Tanaman' : 'Pengaturan program')
      return `${label}: ${i.message}`
    }).join('; '))
    const saved = await saveFertigationRecipe(parsed.data, selected)
    select(saved); setRecipes(rows => [saved, ...rows.filter(r => r.recipeId !== saved.recipeId)]); setLoaded(true)
    setNotice('Program Fertigasi tersimpan sebagai draft. Persetujuan sebelumnya direset.')
  }
  return <section className="fertigation-test">
    <header><span className="ft-badge">Simulasi saja · pompa tidak digerakkan</span></header>
    {error && <div role="alert" className="ft-error">{error}</div>}
    {notice && <div role="status" className="ft-notice">{notice}</div>}
    <div className="ft-layout"><aside className="ft-panel"><div className="ft-actions"><h3>Daftar program</h3><button disabled={busy} onClick={() => void run(reload)}>Muat ulang</button></div>
      {admin && <button disabled={busy} onClick={() => select()}>+ Program Fertigasi baru</button>}
      {!loaded && !error && <p>Memuat program…</p>}
      {loaded && recipes.length === 0 && <p>Belum ada program. Admin dapat membuat draft melalui form di samping.</p>}
      {recipes.map(recipe => <button className={`ft-recipe ${selected?.recipeId === recipe.recipeId ? 'active' : ''}`} key={recipe.recipeId} disabled={busy} onClick={() => select(recipe)}><strong>{recipe.cropName}</strong><span>{recipe.approvalStatus} · revisi {recipe.revision}</span><span>Air {recipe.targetWaterL} L · stok {recipe.targetStockL} L</span></button>)}
    </aside><div className="ft-panel"><h3>{selected ? `Program Fertigasi ${selected.cropName}` : 'Program Fertigasi baru'}</h3>
      {!admin && <p>Tambah, edit, dan persetujuan program tersedia untuk Admin.</p>}
      <form onSubmit={e => { e.preventDefault(); void run(save) }}><fieldset disabled={!admin || busy}><div className="ft-fields">
        <label>Tanaman<select required value={form.cropId} onChange={e => {
          const crop = cropProfiles.find(item => item.id === e.target.value)
          setForm({...form, cropId: crop?.id ?? '', cropName: crop?.commonName ?? ''})
          setConfirmed(false); setReference(''); setResult(undefined)
        }}><option value="">Pilih tanaman</option>{cropProfiles.map(crop => <option key={crop.id} value={crop.id}>{crop.commonName}</option>)}</select></label>
        <label>Jenis pemberian<select value={withFertilizer ? 'fertilizer' : 'water'} onChange={e => { setWithFertilizer(e.target.value === 'fertilizer'); setResult(undefined) }}><option value="water">Air saja</option><option value="fertilizer">Air dan pupuk</option></select></label>
        {selected && selected.applicationMode !== 'sensor' && <p role="status">Simpan ulang untuk memakai pemicu sensor. Jadwal lama tetap berlaku sampai perubahan disimpan dan disetujui.</p>}
        {selected && !selected.cropId && <p role="status">Program lama belum terhubung ke tanaman Smart Soil. Pilih tanaman lalu simpan ulang sebelum meminta persetujuan.</p>}
        {fieldGroups.filter(group => !group.fertilizerOnly || withFertilizer).map(group => <section className="ft-field-group" key={group.title} aria-label={group.title}>
          <h4>{group.title}</h4>
          <div className="ft-fields">{group.keys.map(key => fields.find(field => field.key === key)!).filter(field => withFertilizer || field.key !== 'minStockTankPercent').map(({key, label, type, max, hint, placeholder}) => {
          const thresholdField = ['moistureLowPercent', 'moistureTargetPercent', 'ecLowUsCm', 'ecTargetUsCm', 'ecHighUsCm'].includes(key)
          return <label key={key} htmlFor={`program-${key}`}>{label}<input id={`program-${key}`} aria-describedby={hint ? `program-${key}-hint` : undefined} type={type} value={form[key]} min={type === 'number' ? (key === 'triggerSampleCount' ? 1 : 0) : undefined} max={max} step={key === 'hstFrom' || key === 'hstTo' || key === 'triggerSampleCount' ? 1 : 'any'} required={type !== 'date' && !thresholdField} placeholder={placeholder} maxLength={key === 'sourceReference' ? 500 : key === 'cropName' ? 100 : 120} onChange={e => { setForm({...form, [key]: e.target.value}); setResult(undefined) }} />{hint && <span className="ft-field-hint" id={`program-${key}-hint`}>{hint}</span>}</label>
        })}</div>
          {group.keys.includes('plantingDate') && <p className="ft-field-hint">Tanggal tanam dipakai menghitung umur. Hari tanam dihitung sebagai umur 0 hari.{effectiveDate(form.plantingDate, form.hstFrom) && effectiveDate(form.plantingDate, form.hstTo) && <> Aturan ini berlaku {effectiveDate(form.plantingDate, form.hstFrom)} sampai {effectiveDate(form.plantingDate, form.hstTo)}.</>}</p>}
        </section>)}
      </div><button className="ft-primary" type="submit">{busy ? 'Memproses…' : selected ? 'Simpan perubahan sebagai draft' : 'Simpan draft'}</button></fieldset></form>
      {selected && <><hr/><h3>Persetujuan & evaluasi</h3><p>Status: <strong>{selected.approvalStatus}</strong> · revisi {selected.revision}. Evaluasi menggunakan versi tersimpan.</p>
        {dirty && <p className="ft-error">Ada perubahan belum disimpan. Simpan dahulu atau pilih ulang program.</p>}
        {admin && selected.approvalStatus === 'draft' && <div className="ft-approval"><label>Referensi persetujuan agronomi<input value={reference} maxLength={500} onChange={e => setReference(e.target.value)} disabled={busy} /></label><label className="ft-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/>Saya sudah memeriksa dosis dan referensi persetujuan program ini.</label><button disabled={busy || !!dirty || !selected.cropId || !confirmed || reference.trim().length < 5} onClick={() => void run(async () => { const saved = await approveFertigationRecipe(selected, reference.trim()); select(saved); setRecipes(rows => rows.map(r => r.recipeId === saved.recipeId ? saved : r)); setNotice('Persetujuan tersimpan.'); })}>Catat persetujuan</button></div>}
        <label>Perangkat<select disabled={busy} value={deviceId} onChange={e => { setDeviceId(e.target.value); setResult(undefined) }}><option value="">Pilih perangkat</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.displayName}</option>)}</select></label>
        <button className="ft-primary" disabled={busy || !!dirty || !operator || !deviceId} onClick={() => void run(async () => { setResult(undefined); const response = await evaluateFertigationSite(selected.recipeId, deviceId); setResult(fertigationLiveDecisionSchema.parse(response)) })}>Periksa kondisi tanaman</button>
        {result && <div className="ft-result" role="status"><h3>{result.decision.action === 'DELAY' ? 'Ditunda' : 'Rekomendasi tersedia'} · {result.decision.action}</h3><p>HST: {result.hst ?? 'belum tersedia'} · air: {result.decision.targetWaterL ?? '—'} L · stok: {result.decision.targetStockL ?? '—'} L</p><p>Tanaman cocok: {cropProfiles.find(crop => crop.id === result.activeCropId)?.commonName ?? 'Belum cocok / belum dipilih'} · kelembapan tanah: {result.observations.soilMoisturePercent ?? '—'} % · EC larutan: {result.observations.liquidEcUsCm ?? '—'} µS/cm</p><p>Pengendali pompa: kontrol sensor pada perangkat. Program Fertigasi hanya memberikan rekomendasi; tidak mengirim perintah pompa.</p><ul>{result.decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul><p>Waktu evaluasi: {result.siteObservedAt}<br/>Telemetry: {result.telemetryRecordedAt ?? 'Tidak tersedia'}<br/>Status perangkat: {result.deviceRecordedAt ?? 'Tidak tersedia'}</p><details><summary>Respons JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
      </>}
    </div></div>
  </section>
}
