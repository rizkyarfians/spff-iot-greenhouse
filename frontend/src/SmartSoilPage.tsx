import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Droplets,
  FlaskConical,
  Gauge,
  Leaf,
  LoaderCircle,
  Save,
  Thermometer,
  Wind,
} from 'lucide-react'
import type {
  SmartSoilComparison,
  SmartSoilReferenceInput,
  SmartSoilSensorCondition,
  SmartSoilSnapshot,
} from '@spff/contracts'
import {
  fetchSmartSoil,
  saveSmartSoilReference,
  type ConnectionState,
} from './api'
import { useAuth } from './authContext'
import './SmartSoilPage.css'

type Props = {
  connectionState: ConnectionState
  onRefresh: () => void
}

type ReferenceDraft = Record<
  Exclude<keyof SmartSoilReferenceInput, 'zoneId'>,
  string
>

const iconBySensor: Record<string, typeof Leaf> = {
  air_temp: Thermometer,
  air_humidity: Wind,
  soil_1_moisture: Droplets,
  soil_1_temp: Thermometer,
  soil_1_ph: FlaskConical,
  soil_1_ec_us_cm: Gauge,
}

const blankReferenceDraft = (): ReferenceDraft => ({
  cropName: '',
  temperatureMinC: '',
  temperatureMaxC: '',
  soilPhMin: '',
  soilPhMax: '',
  humidityMinPercent: '',
  humidityMaxPercent: '',
})

const toReferenceDraft = (
  reference: SmartSoilSnapshot['reference'],
): ReferenceDraft => reference
  ? {
      cropName: reference.cropName,
      temperatureMinC: String(reference.temperatureMinC),
      temperatureMaxC: String(reference.temperatureMaxC),
      soilPhMin: String(reference.soilPhMin),
      soilPhMax: String(reference.soilPhMax),
      humidityMinPercent: String(reference.humidityMinPercent),
      humidityMaxPercent: String(reference.humidityMaxPercent),
    }
  : blankReferenceDraft()

const formatSensorValue = (sensor: SmartSoilSensorCondition) =>
  sensor.value === null
    ? '—'
    : [
        sensor.value.toLocaleString('id-ID', { maximumFractionDigits: 1 }),
        sensor.unit,
      ].filter(Boolean).join(' ')

const comparisonLabels: Record<SmartSoilComparison['status'], string> = {
  within: 'Sesuai acuan',
  below: 'Di bawah acuan',
  above: 'Di atas acuan',
  unavailable: 'Belum ada data',
}

const formatComparisonValue = (
  value: number | null,
  unit: string,
) => value === null
  ? '—'
  : `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${unit}`

export function SmartSoilPage({ connectionState, onRefresh }: Props) {
  const { user } = useAuth()
  const [snapshot, setSnapshot] = useState<SmartSoilSnapshot | null>(null)
  const [draft, setDraft] = useState<ReferenceDraft>(blankReferenceDraft)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchSmartSoil()
      setSnapshot(data)
      setDraft(toReferenceDraft(data.reference))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Smart Soil belum dapat dimuat.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const savedDraft = useMemo(
    () => toReferenceDraft(snapshot?.reference ?? null),
    [snapshot?.reference],
  )

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedDraft)

  const updateDraft = (field: keyof ReferenceDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const saveReference = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!snapshot || user.role !== 'admin' || saving) return

    const numericFields = {
      temperatureMinC: Number(draft.temperatureMinC),
      temperatureMaxC: Number(draft.temperatureMaxC),
      soilPhMin: Number(draft.soilPhMin),
      soilPhMax: Number(draft.soilPhMax),
      humidityMinPercent: Number(draft.humidityMinPercent),
      humidityMaxPercent: Number(draft.humidityMaxPercent),
    }
    const numericDraftValues = [
      draft.temperatureMinC,
      draft.temperatureMaxC,
      draft.soilPhMin,
      draft.soilPhMax,
      draft.humidityMinPercent,
      draft.humidityMaxPercent,
    ]
    if (
      !draft.cropName.trim()
      || numericDraftValues.some((value) => value.trim() === '')
      || Object.values(numericFields).some((value) => !Number.isFinite(value))
    ) {
      setError('Lengkapi nama tanaman dan seluruh nilai acuannya.')
      return
    }

    setSaving(true)
    try {
      const data = await saveSmartSoilReference({
        zoneId: snapshot.zoneId,
        cropName: draft.cropName.trim(),
        ...numericFields,
      })
      setSnapshot(data)
      setDraft(toReferenceDraft(data.reference))
      setError('')
      onRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Acuan tanaman belum tersimpan.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="smart-soil-page smart-soil-loading">
        <LoaderCircle className="spin" />
        Memuat Smart Soil…
      </section>
    )
  }
  if (!snapshot) {
    return (
      <section className="smart-soil-page smart-soil-error">
        <AlertTriangle />
        {error || 'Data Smart Soil tidak tersedia.'}
      </section>
    )
  }

  return (
    <section className="secondary-page smart-soil-page" aria-label="Smart Soil">
      <header className="smart-soil-heading">
        <div>
          <span className="smart-soil-eyebrow"><Leaf size={15} /> Smart Soil</span>
          <h2>Monitoring kondisi & acuan tanaman</h2>
          <p>
            Bandingkan kondisi terbaru dengan rentang yang diisi dan disepakati tim lapangan.
          </p>
        </div>
        <div className={['smart-soil-device', snapshot.deviceStatus].join(' ')}>
          <span />
          {snapshot.deviceStatus === 'online'
            ? 'Perangkat terhubung'
            : snapshot.deviceStatus === 'stale'
              ? 'Data terlambat'
              : 'Perangkat tidak terhubung'}
        </div>
      </header>

      {error && (
        <div className="smart-soil-notice error">
          <AlertTriangle size={17} /> {error}
        </div>
      )}

      <div className="smart-soil-condition-grid">
        {snapshot.conditions.sensors.map((sensor) => {
          const Icon = iconBySensor[sensor.id] ?? Leaf
          return (
            <article className="smart-soil-metric" key={sensor.id}>
              <span className="smart-soil-metric-icon"><Icon size={18} /></span>
              <span>{sensor.name}</span>
              <strong>{formatSensorValue(sensor)}</strong>
              <small>{sensor.groupName}</small>
            </article>
          )
        })}
      </div>

      <div className="smart-soil-layout">
        <form className="page-card smart-soil-profile" onSubmit={saveReference}>
          <div className="page-card-header">
            <div>
              <h2>Acuan tanaman manual</h2>
              <p>Isi rentang berdasarkan rekomendasi tim agronomi atau kebutuhan tanaman.</p>
            </div>
          </div>

          <label className="smart-soil-field smart-soil-field-wide">
            <span>Nama tanaman</span>
            <input
              value={draft.cropName}
              placeholder="Contoh: Pakcoy"
              maxLength={100}
              required
              disabled={user.role !== 'admin'}
              onChange={(event) => updateDraft('cropName', event.target.value)}
            />
          </label>

          <div className="smart-soil-reference-grid">
            <label className="smart-soil-field">
              <span>Suhu minimum</span>
              <div className="smart-soil-input-wrap">
                <input type="number" min={-20} max={80} step="0.1" required disabled={user.role !== 'admin'} value={draft.temperatureMinC} onChange={(event) => updateDraft('temperatureMinC', event.target.value)} />
                <small>°C</small>
              </div>
            </label>
            <label className="smart-soil-field">
              <span>Suhu maksimum</span>
              <div className="smart-soil-input-wrap">
                <input type="number" min={-20} max={80} step="0.1" required disabled={user.role !== 'admin'} value={draft.temperatureMaxC} onChange={(event) => updateDraft('temperatureMaxC', event.target.value)} />
                <small>°C</small>
              </div>
            </label>
            <label className="smart-soil-field">
              <span>pH tanah minimum</span>
              <div className="smart-soil-input-wrap">
                <input type="number" min={0} max={14} step="0.1" required disabled={user.role !== 'admin'} value={draft.soilPhMin} onChange={(event) => updateDraft('soilPhMin', event.target.value)} />
                <small>pH</small>
              </div>
            </label>
            <label className="smart-soil-field">
              <span>pH tanah maksimum</span>
              <div className="smart-soil-input-wrap">
                <input type="number" min={0} max={14} step="0.1" required disabled={user.role !== 'admin'} value={draft.soilPhMax} onChange={(event) => updateDraft('soilPhMax', event.target.value)} />
                <small>pH</small>
              </div>
            </label>
            <label className="smart-soil-field">
              <span>Kelembapan udara minimum</span>
              <div className="smart-soil-input-wrap">
                <input type="number" min={0} max={100} step="0.1" required disabled={user.role !== 'admin'} value={draft.humidityMinPercent} onChange={(event) => updateDraft('humidityMinPercent', event.target.value)} />
                <small>%RH</small>
              </div>
            </label>
            <label className="smart-soil-field">
              <span>Kelembapan udara maksimum</span>
              <div className="smart-soil-input-wrap">
                <input type="number" min={0} max={100} step="0.1" required disabled={user.role !== 'admin'} value={draft.humidityMaxPercent} onChange={(event) => updateDraft('humidityMaxPercent', event.target.value)} />
                <small>%RH</small>
              </div>
            </label>
          </div>

          <button
            className="primary-action"
            type="submit"
            disabled={
              saving
              || user.role !== 'admin'
              || connectionState !== 'connected'
              || !isDirty
            }
          >
            {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {user.role === 'admin' ? 'Simpan acuan' : 'Hanya admin yang dapat menyimpan'}
          </button>
        </form>

        <article className="page-card smart-soil-explanation">
          <div className="page-card-header">
            <div>
              <h2>Hasil perbandingan</h2>
              <p>
                {snapshot.reference
                  ? `Kondisi saat ini dibandingkan dengan acuan ${snapshot.reference.cropName}.`
                  : 'Isi acuan tanaman terlebih dahulu untuk melihat hasil.'}
              </p>
            </div>
          </div>

          {snapshot.comparison.length > 0 ? (
            <div className="smart-soil-comparison-list">
              {snapshot.comparison.map((item) => (
                <div className={`smart-soil-comparison ${item.status}`} key={item.parameter}>
                  <span className="smart-soil-comparison-icon">
                    {item.status === 'within'
                      ? <CheckCircle2 size={18} />
                      : <AlertTriangle size={18} />}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      Acuan {item.minimum.toLocaleString('id-ID')}–{item.maximum.toLocaleString('id-ID')} {item.unit}
                    </small>
                  </span>
                  <span className="smart-soil-comparison-value">
                    <strong>{formatComparisonValue(item.currentValue, item.unit)}</strong>
                    <small>{comparisonLabels[item.status]}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="smart-soil-empty-reference">
              <Leaf size={22} />
              Belum ada acuan manual yang tersimpan.
            </div>
          )}

          <div className="smart-soil-read-time">
            Data terakhir
            <strong>
              {snapshot.conditions.recordedAt
                ? new Date(snapshot.conditions.recordedAt).toLocaleString('id-ID')
                : 'Belum ada data'}
            </strong>
          </div>
        </article>
      </div>
    </section>
  )
}
