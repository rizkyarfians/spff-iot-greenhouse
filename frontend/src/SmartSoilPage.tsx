import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
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
  CropId,
  SmartSoilSensorCondition,
  SmartSoilSnapshot,
} from '@spff/contracts'
import {
  fetchSmartSoil,
  saveSmartSoilSelection,
  type ConnectionState,
} from './api'
import { useAuth } from './authContext'
import './SmartSoilPage.css'

type Props = {
  connectionState: ConnectionState
  onRefresh: () => void
}

const iconBySensor: Record<string, typeof Leaf> = {
  air_temp: Thermometer,
  air_humidity: Wind,
  soil_1_moisture: Droplets,
  soil_1_temp: Thermometer,
  soil_1_ph: FlaskConical,
  soil_1_ec_us_cm: Gauge,
}

const suitabilityLabels = {
  excellent: 'Sangat sesuai',
  good: 'Sesuai',
  marginal: 'Cukup sesuai',
  unsuitable: 'Kurang sesuai',
} as const

const formatSensorValue = (sensor: SmartSoilSensorCondition) =>
  sensor.value === null
    ? '—'
    : [
        sensor.value.toLocaleString('id-ID', { maximumFractionDigits: 1 }),
        sensor.unit,
      ].filter(Boolean).join(' ')

const range = (min: number, max: number, unit = '') =>
  [min, '–', max, unit ? [' ', unit].join('') : ''].join('')

export function SmartSoilPage({ connectionState, onRefresh }: Props) {
  const { user } = useAuth()
  const [snapshot, setSnapshot] = useState<SmartSoilSnapshot | null>(null)
  const [selectedCropId, setSelectedCropId] = useState<CropId>('sweet-potato')
  const [expandedCrop, setExpandedCrop] = useState<CropId | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchSmartSoil()
      setSnapshot(data)
      setSelectedCropId(data.selectedCropId)
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

  const activeProfile = useMemo(
    () => snapshot?.profiles.find((profile) => profile.id === selectedCropId),
    [selectedCropId, snapshot],
  )

  const saveSelection = async () => {
    if (!snapshot || user.role !== 'admin') return
    setSaving(true)
    try {
      const data = await saveSmartSoilSelection({
        zoneId: snapshot.zoneId,
        selectedCropId,
      })
      setSnapshot(data)
      setError('')
      onRefresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pilihan tanaman belum tersimpan.')
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
          <h2>Monitoring kondisi & rekomendasi tanaman</h2>
          <p>
            Analisis memakai telemetry terakhir dari PostgreSQL. Fitur ini tidak
            mengendalikan pompa atau jadwal.
          </p>
        </div>
        <div className={['smart-soil-device', snapshot.deviceStatus].join(' ')}>
          <span />
          {snapshot.deviceStatus === 'online'
            ? 'Device online'
            : ['Device ', snapshot.deviceStatus].join('')}
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
        <article className="page-card smart-soil-profile">
          <div className="page-card-header">
            <div>
              <h2>Tanaman acuan</h2>
              <p>Pilih profil untuk dibandingkan dengan kondisi lokasi saat ini.</p>
            </div>
          </div>
          <label className="smart-soil-field">
            <span>Pilih tanaman</span>
            <select
              value={selectedCropId}
              onChange={(event) => setSelectedCropId(event.target.value as CropId)}
            >
              {snapshot.profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.commonName}
                </option>
              ))}
            </select>
          </label>

          {activeProfile && (
            <div className="smart-soil-profile-detail">
              <div>
                <h3>{activeProfile.commonName}</h3>
                <em>{activeProfile.scientificName}</em>
              </div>
              <dl className="smart-soil-definition-list">
                <div>
                  <dt>Baseline suhu</dt>
                  <dd>{range(activeProfile.temperature.optimalMinC, activeProfile.temperature.optimalMaxC, '°C')}</dd>
                </div>
                <div>
                  <dt>Baseline pH tanah</dt>
                  <dd>{range(activeProfile.soil.optimalPhMin, activeProfile.soil.optimalPhMax)}</dd>
                </div>
                <div>
                  <dt>Rentang kelembapan lokasi</dt>
                  <dd>
                    {snapshot.humidityTarget.minPercent === null ||
                    snapshot.humidityTarget.maxPercent === null
                      ? 'Belum diatur'
                      : range(
                          snapshot.humidityTarget.minPercent,
                          snapshot.humidityTarget.maxPercent,
                          '%',
                        )}
                  </dd>
                </div>
                <div>
                  <dt>Siklus tumbuh</dt>
                  <dd>
                    {activeProfile.growth
                      ? range(activeProfile.growth.minDays, activeProfile.growth.maxDays, 'hari')
                      : 'Data belum tersedia'}
                  </dd>
                </div>
              </dl>
              <small>
                Baseline tanaman: {activeProfile.source.map((source) => source.name).join(' · ')}.
                Kelembapan memakai rentang operasional lokasi, bukan baseline spesifik tanaman.
              </small>
            </div>
          )}

          <button
            className="primary-action"
            type="button"
            onClick={() => void saveSelection()}
            disabled={
              saving ||
              user.role !== 'admin' ||
              connectionState !== 'connected' ||
              selectedCropId === snapshot.selectedCropId
            }
          >
            {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {user.role === 'admin' ? 'Simpan pilihan' : 'Hanya admin yang dapat menyimpan'}
          </button>
        </article>

        <article className="page-card smart-soil-explanation">
          <div className="page-card-header">
            <div>
              <h2>Cara membaca analisis</h2>
              <p>Skor dinormalisasi hanya dari input yang tersedia.</p>
            </div>
          </div>
          <ul>
            <li><strong>Suhu 40%</strong> dibandingkan dengan baseline suhu tiap tanaman.</li>
            <li><strong>pH tanah 35%</strong> dibandingkan dengan baseline pH tiap tanaman.</li>
            <li><strong>Kelembapan udara 25%</strong> dibandingkan dengan rentang lokasi di Pengaturan.</li>
            <li>Moisture, EC, dan NPK tetap dimonitor, tetapi belum masuk skor tanpa baseline tanaman yang tervalidasi.</li>
          </ul>
          <div className="smart-soil-read-time">
            Data terakhir
            <strong>
              {snapshot.conditions.recordedAt
                ? new Date(snapshot.conditions.recordedAt).toLocaleString('id-ID')
                : 'Belum ada telemetry'}
            </strong>
          </div>
        </article>
      </div>

      <article className="page-card smart-soil-recommendations">
        <div className="page-card-header">
          <div>
            <h2>Rekomendasi tanaman</h2>
            <p>Urutan kecocokan berdasarkan kondisi yang sedang terbaca.</p>
          </div>
        </div>
        {snapshot.recommendations.length === 0 ? (
          <p className="empty-copy">Belum cukup telemetry untuk membuat rekomendasi.</p>
        ) : (
          snapshot.recommendations.map((recommendation, index) => (
            <div className="smart-soil-recommendation" key={recommendation.cropId}>
              <button
                type="button"
                onClick={() =>
                  setExpandedCrop(
                    expandedCrop === recommendation.cropId ? null : recommendation.cropId,
                  )
                }
              >
                <span className="rank">{index + 1}</span>
                <span>
                  <strong>
                    {snapshot.profiles.find((profile) => profile.id === recommendation.cropId)?.commonName}
                  </strong>
                  <small>{suitabilityLabels[recommendation.suitability]}</small>
                </span>
                <b>{recommendation.score}%</b>
                <ChevronDown
                  size={17}
                  className={expandedCrop === recommendation.cropId ? 'open' : ''}
                />
              </button>
              {expandedCrop === recommendation.cropId && (
                <ul>
                  {recommendation.reasons.map((reason) => (
                    <li key={reason.parameter}>
                      <CheckCircle2 size={15} />
                      {reason.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </article>
    </section>
  )
}
