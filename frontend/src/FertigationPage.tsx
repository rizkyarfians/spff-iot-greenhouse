import { useEffect, useRef, useState } from 'react'
import { cropProfiles, fertigationRecipeMutationSchema, fertigationLiveDecisionSchema, type ApiDevice, type FertigationRecipe, type FertigationLiveDecision } from '@spff/contracts'
import { ApiError, fetchFertigationRecipes, saveFertigationRecipe, approveFertigationRecipe, evaluateFertigationSite } from './api'
import { useAuth } from './authContext'
import './FertigationPage.css'

const empty = () => ({ cropId: '', cropName: '', hstFrom: '', hstTo: '', targetWaterL: '', targetStockL: '0', fertilizerName: '', stockConcentrationGPerL: '', minWaterTankPercent: '', minStockTankPercent: '', sourceReference: '', plantingDate: '', applicationDate: '', applicationMode: 'interval', applicationIntervalDays: '1', moistureLowPercent: '', moistureTargetPercent: '', ecLowUsCm: '', ecTargetUsCm: '', ecHighUsCm: '' })
type Form = ReturnType<typeof empty>
const fields: { key: keyof Form; label: string; type: string; max?: number }[] = [
  { key: 'plantingDate', label: 'Tanggal tanam', type: 'date' },
  { key: 'hstFrom', label: 'HST awal', type: 'number', max: 1000 },
  { key: 'hstTo', label: 'HST akhir', type: 'number', max: 1000 },
  { key: 'targetWaterL', label: 'Target air (L)', type: 'number', max: 100000 },
  { key: 'targetStockL', label: 'Target larutan stok (L)', type: 'number', max: 100000 },
  { key: 'fertilizerName', label: 'Nama pupuk', type: 'text' },
  { key: 'stockConcentrationGPerL', label: 'Konsentrasi stok (g/L)', type: 'number', max: 10000 },
  { key: 'minWaterTankPercent', label: 'Minimum tangki air (%)', type: 'number', max: 100 },
  { key: 'minStockTankPercent', label: 'Minimum tangki stok (%)', type: 'number', max: 100 },
  { key: 'sourceReference', label: 'Referensi sumber dosis (min. 5 karakter)', type: 'text' },
  { key: 'moistureLowPercent', label: 'Kelembapan minimum (%)', type: 'number', max: 100 },
  { key: 'moistureTargetPercent', label: 'Target kelembapan (%)', type: 'number', max: 100 },
  { key: 'ecLowUsCm', label: 'EC minimum (µS/cm)', type: 'number', max: 100000 },
  { key: 'ecTargetUsCm', label: 'EC target (µS/cm)', type: 'number', max: 100000 },
  { key: 'ecHighUsCm', label: 'EC maksimum (µS/cm)', type: 'number', max: 100000 },
]
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
    input.applicationMode = form.applicationMode
    input.applicationIntervalDays = form.applicationMode === 'interval' ? Number(form.applicationIntervalDays) : null
    input.plantingDate = form.plantingDate || null
    input.applicationDate = form.applicationMode === 'once' ? form.applicationDate || null : null
    if (withFertilizer && !(Number(form.targetStockL) > 0)) throw new Error('Isi volume larutan pupuk lebih dari 0 liter untuk pilihan Air dan pupuk.')
    if (!withFertilizer) {
      input.targetStockL = 0; input.fertilizerName = null; input.stockConcentrationGPerL = null
      input.ecLowUsCm = null; input.ecTargetUsCm = null; input.ecHighUsCm = null
    }
    const parsed = fertigationRecipeMutationSchema.safeParse(input)
    if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
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
      <p>Jadwal berulang dimulai pada HST awal dan berhenti setelah HST akhir.</p>
      {!admin && <p>Tambah, edit, dan persetujuan program tersedia untuk Admin.</p>}
      <form onSubmit={e => { e.preventDefault(); void run(save) }}><fieldset disabled={!admin || busy}><div className="ft-fields">
        <label>Tanaman Smart Soil<select required value={form.cropId} onChange={e => {
          const crop = cropProfiles.find(item => item.id === e.target.value)
          setForm({...form, cropId: crop?.id ?? '', cropName: crop?.commonName ?? ''})
          setConfirmed(false); setReference(''); setResult(undefined)
        }}><option value="">Pilih tanaman</option>{cropProfiles.map(crop => <option key={crop.id} value={crop.id}>{crop.commonName}</option>)}</select></label>
        <label>Jenis pemberian<select value={withFertilizer ? 'fertilizer' : 'water'} onChange={e => { setWithFertilizer(e.target.value === 'fertilizer'); setResult(undefined) }}><option value="water">Air saja</option><option value="fertilizer">Air dan pupuk</option></select></label>
        <label>Jadwal aplikasi<select value={form.applicationMode} onChange={e => { setForm({...form, applicationMode: e.target.value, applicationDate: '', applicationIntervalDays: e.target.value === 'interval' ? '1' : ''}); setResult(undefined) }}><option value="interval">Berulang berdasarkan umur tanaman</option><option value="once">Sekali pada tanggal tertentu</option></select></label>
        {form.applicationMode === 'interval' ? <label>Ulangi setiap (hari)<input required type="number" min={1} max={1000} step={1} value={form.applicationIntervalDays} onChange={e => { setForm({...form, applicationIntervalDays: e.target.value}); setResult(undefined) }} /></label> : <label>Tanggal aplikasi (WIB)<input required type="date" value={form.applicationDate} onChange={e => { setForm({...form, applicationDate: e.target.value}); setResult(undefined) }} /></label>}
        {selected && !selected.cropId && <p role="status">Program lama belum terhubung ke tanaman Smart Soil. Pilih tanaman lalu simpan ulang sebelum meminta persetujuan.</p>}
        {fields.map(({key, label, type, max}) => {
          const stockField = key === 'targetStockL' || key === 'fertilizerName' || key === 'stockConcentrationGPerL' || key.startsWith('ec')
          const inactive = stockField && !withFertilizer
          const thresholdField = ['moistureLowPercent', 'moistureTargetPercent', 'ecLowUsCm', 'ecTargetUsCm', 'ecHighUsCm'].includes(key)
          return <label key={key}>{label}<input type={type} value={inactive ? '' : form[key]} disabled={inactive} min={type === 'number' ? 0 : undefined} max={max} step={key === 'hstFrom' || key === 'hstTo' ? 1 : 'any'} required={type !== 'date' && !inactive && !thresholdField} maxLength={key === 'sourceReference' ? 500 : key === 'cropName' ? 100 : 120} onChange={e => { setForm({...form, [key]: e.target.value}); setResult(undefined) }} /></label>
        })}
      </div><button className="ft-primary" type="submit">{busy ? 'Memproses…' : selected ? 'Simpan perubahan sebagai draft' : 'Simpan draft'}</button></fieldset></form>
      {selected && <><hr/><h3>Persetujuan & evaluasi</h3><p>Status: <strong>{selected.approvalStatus}</strong> · revisi {selected.revision}. Evaluasi menggunakan versi tersimpan.</p>
        {dirty && <p className="ft-error">Ada perubahan belum disimpan. Simpan dahulu atau pilih ulang program.</p>}
        {admin && selected.approvalStatus === 'draft' && <div className="ft-approval"><label>Referensi persetujuan agronomi<input value={reference} maxLength={500} onChange={e => setReference(e.target.value)} disabled={busy} /></label><label className="ft-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/>Saya sudah memeriksa dosis dan referensi persetujuan program ini.</label><button disabled={busy || !!dirty || !selected.cropId || !confirmed || reference.trim().length < 5} onClick={() => void run(async () => { const saved = await approveFertigationRecipe(selected, reference.trim()); select(saved); setRecipes(rows => rows.map(r => r.recipeId === saved.recipeId ? saved : r)); setNotice('Persetujuan tersimpan.'); })}>Catat persetujuan</button></div>}
        <label>Perangkat site<select disabled={busy} value={deviceId} onChange={e => { setDeviceId(e.target.value); setResult(undefined) }}><option value="">Pilih perangkat</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.displayName} ({d.deviceId})</option>)}</select></label>
        <button className="ft-primary" disabled={busy || !!dirty || !operator || !deviceId} onClick={() => void run(async () => { setResult(undefined); const response = await evaluateFertigationSite(selected.recipeId, deviceId); setResult(fertigationLiveDecisionSchema.parse(response)) })}>Evaluasi data site</button>
        {result && <div className="ft-result" role="status"><h3>{result.decision.action === 'DELAY' ? 'Ditunda' : 'Rekomendasi tersedia'} · {result.decision.action}</h3><p>HST: {result.hst ?? 'belum tersedia'} · air: {result.decision.targetWaterL ?? '—'} L · stok: {result.decision.targetStockL ?? '—'} L</p><p>Tanaman cocok: {cropProfiles.find(crop => crop.id === result.activeCropId)?.commonName ?? 'Belum cocok / belum dipilih'} · kelembapan tanah: {result.observations.soilMoisturePercent ?? '—'} % · EC larutan: {result.observations.liquidEcUsCm ?? '—'} µS/cm</p><p>Pengendali pompa: kontrol sensor pada perangkat. Program Fertigasi hanya memberikan rekomendasi; tidak mengirim perintah pompa.</p><ul>{result.decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul><p>Waktu evaluasi: {result.siteObservedAt}<br/>Telemetry: {result.telemetryRecordedAt ?? 'Tidak tersedia'}<br/>Status perangkat: {result.deviceRecordedAt ?? 'Tidak tersedia'}</p><details><summary>Respons JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
      </>}
    </div></div>
  </section>
}
