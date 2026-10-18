import { useEffect, useRef, useState } from 'react'
import { fertigationRecipeMutationSchema, fertigationLiveDecisionSchema, type ApiDevice, type FertigationRecipe, type FertigationLiveDecision } from '@spff/contracts'
import { ApiError, fetchFertigationRecipes, saveFertigationRecipe, approveFertigationRecipe, evaluateFertigationSite } from './api'
import { useAuth } from './authContext'
import './FertigationPage.css'

const empty = () => ({ cropName: '', hstFrom: '', hstTo: '', targetWaterL: '', targetStockL: '0', fertilizerName: '', stockConcentrationGPerL: '', minWaterTankPercent: '', minStockTankPercent: '', sourceReference: '', plantingDate: '', applicationDate: '' })
type Form = ReturnType<typeof empty>
const fields: { key: keyof Form; label: string; type: string; max?: number }[] = [
  { key: 'cropName', label: 'Komoditas', type: 'text' },
  { key: 'plantingDate', label: 'Tanggal tanam', type: 'date' },
  { key: 'applicationDate', label: 'Tanggal aplikasi (WIB)', type: 'date' },
  { key: 'hstFrom', label: 'HST awal', type: 'number', max: 1000 },
  { key: 'hstTo', label: 'HST akhir', type: 'number', max: 1000 },
  { key: 'targetWaterL', label: 'Target air (L)', type: 'number', max: 100000 },
  { key: 'targetStockL', label: 'Target larutan stok (L)', type: 'number', max: 100000 },
  { key: 'fertilizerName', label: 'Nama pupuk', type: 'text' },
  { key: 'stockConcentrationGPerL', label: 'Konsentrasi stok (g/L)', type: 'number', max: 10000 },
  { key: 'minWaterTankPercent', label: 'Minimum tangki air (%)', type: 'number', max: 100 },
  { key: 'minStockTankPercent', label: 'Minimum tangki stok (%)', type: 'number', max: 100 },
  { key: 'sourceReference', label: 'Referensi sumber dosis (min. 5 karakter)', type: 'text' },
]
function message(error: unknown) {
  return error instanceof ApiError ? `${error.message}${error.errors.length ? ' — '+error.errors.join(', ') : ''}${error.status === 409 ? ' Muat ulang daftar lalu pilih ulang resep sebelum mengedit.' : ''}` : error instanceof Error ? error.message : 'Permintaan gagal.'
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
  function select(recipe?: FertigationRecipe) {
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
  async function reload() { setRecipes(await fetchFertigationRecipes()); setLoaded(true) }
  useEffect(() => { let active = true; fetchFertigationRecipes().then(rows => { if (active) { setRecipes(rows); setLoaded(true) } }).catch(e => { if (active) setError(message(e)) }); return () => { active = false } }, [])
  const dirty = selected && (Object.keys(form) as (keyof Form)[]).some(key => form[key] !== (selected[key] == null ? '' : String(selected[key])))
  async function save() {
    const input = Object.fromEntries(fields.map(({key, type}) => [key, type === 'number' ? (form[key].trim() === '' ? null : Number(form[key])) : form[key].trim()]))
    input.plantingDate = form.plantingDate || null; input.applicationDate = form.applicationDate || null
    if (Number(form.targetStockL) === 0) { input.fertilizerName = null; input.stockConcentrationGPerL = null }
    const parsed = fertigationRecipeMutationSchema.safeParse(input)
    if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
    const saved = await saveFertigationRecipe(parsed.data, selected)
    select(saved); setRecipes(rows => [saved, ...rows.filter(r => r.recipeId !== saved.recipeId)]); setLoaded(true)
    setNotice('Resep tersimpan sebagai draft. Persetujuan sebelumnya direset.')
  }
  return <section className="fertigation-test">
    <header><div><p className="ft-eyebrow">PENGUJIAN SITE</p><h2>Resep & evaluasi fertigasi</h2><p>Simpan resep dan periksa rekomendasi dari sensor site.</p></div><span className="ft-badge">Simulasi saja · pompa tidak digerakkan</span></header>
    {error && <div role="alert" className="ft-error">{error}</div>}
    {notice && <div role="status" className="ft-notice">{notice}</div>}
    <div className="ft-layout"><aside className="ft-panel"><div className="ft-actions"><h3>Daftar resep</h3><button disabled={busy} onClick={() => void run(reload)}>Muat ulang</button></div>
      {admin && <button disabled={busy} onClick={() => select()}>+ Resep baru</button>}
      {!loaded && !error && <p>Memuat resep…</p>}
      {loaded && recipes.length === 0 && <p>Belum ada resep. Admin dapat membuat draft melalui form di samping.</p>}
      {recipes.map(recipe => <button className={`ft-recipe ${selected?.recipeId === recipe.recipeId ? 'active' : ''}`} key={recipe.recipeId} disabled={busy} onClick={() => select(recipe)}><strong>{recipe.cropName}</strong><span>{recipe.approvalStatus} · revisi {recipe.revision}</span><span>Air {recipe.targetWaterL} L · stok {recipe.targetStockL} L</span></button>)}
    </aside><div className="ft-panel"><h3>{selected ? `Resep ${selected.cropName}` : 'Resep baru'}</h3>
      <p>Dosis diisi berdasarkan referensi yang sudah diperiksa. Target stok 0 berarti air saja.</p>
      {!admin && <p>Tambah, edit, dan persetujuan resep tersedia untuk Admin.</p>}
      <form onSubmit={e => { e.preventDefault(); void run(save) }}><fieldset disabled={!admin || busy}><div className="ft-fields">
        {fields.map(({key, label, type, max}) => {
          const stockField = key === 'fertilizerName' || key === 'stockConcentrationGPerL'
          const inactive = stockField && Number(form.targetStockL) === 0
          return <label key={key}>{label}<input type={type} value={inactive ? '' : form[key]} disabled={inactive} min={type === 'number' ? 0 : undefined} max={max} step={key === 'hstFrom' || key === 'hstTo' ? 1 : 'any'} required={type !== 'date' && !inactive} maxLength={key === 'sourceReference' ? 500 : key === 'cropName' ? 100 : 120} onChange={e => { setForm({...form, [key]: e.target.value}); setResult(undefined) }} /></label>
        })}
      </div><button className="ft-primary" type="submit">{busy ? 'Memproses…' : selected ? 'Simpan perubahan sebagai draft' : 'Simpan draft'}</button></fieldset></form>
      {selected && <><hr/><h3>Persetujuan & evaluasi</h3><p>Status: <strong>{selected.approvalStatus}</strong> · revisi {selected.revision}. Evaluasi menggunakan versi tersimpan.</p>
        {dirty && <p className="ft-error">Ada perubahan belum disimpan. Simpan dahulu atau pilih ulang resep.</p>}
        {admin && selected.approvalStatus === 'draft' && <div className="ft-approval"><label>Referensi persetujuan agronomi<input value={reference} maxLength={500} onChange={e => setReference(e.target.value)} disabled={busy} /></label><label className="ft-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/>Saya sudah memeriksa dosis dan referensi persetujuan resep ini.</label><button disabled={busy || !!dirty || !confirmed || reference.trim().length < 5} onClick={() => void run(async () => { const saved = await approveFertigationRecipe(selected, reference.trim()); select(saved); setRecipes(rows => rows.map(r => r.recipeId === saved.recipeId ? saved : r)); setNotice('Persetujuan tersimpan.'); })}>Catat persetujuan</button></div>}
        <label>Perangkat site<select disabled={busy} value={deviceId} onChange={e => { setDeviceId(e.target.value); setResult(undefined) }}><option value="">Pilih perangkat</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.displayName} ({d.deviceId})</option>)}</select></label>
        <button className="ft-primary" disabled={busy || !!dirty || !operator || !deviceId} onClick={() => void run(async () => { setResult(undefined); const response = await evaluateFertigationSite(selected.recipeId, deviceId); setResult(fertigationLiveDecisionSchema.parse(response)) })}>Evaluasi data site</button>
        {result && <div className="ft-result" role="status"><h3>{result.decision.action === 'DELAY' ? 'Ditunda' : 'Rekomendasi tersedia'} · {result.decision.action}</h3><p>HST: {result.hst ?? 'belum tersedia'} · air: {result.decision.targetWaterL ?? '—'} L · stok: {result.decision.targetStockL ?? '—'} L</p><ul>{result.decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul><p>Waktu evaluasi: {result.siteObservedAt}<br/>Telemetry: {result.telemetryRecordedAt ?? 'Tidak tersedia'}<br/>Status perangkat: {result.deviceRecordedAt ?? 'Tidak tersedia'}</p><details><summary>Respons JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
      </>}
    </div></div>
  </section>
}
