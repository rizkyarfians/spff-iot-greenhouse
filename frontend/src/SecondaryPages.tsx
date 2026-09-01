import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Cpu,
  FlaskConical,
  Info,
  Leaf,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  ShowerHead,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import {
  acknowledgeAlarm as acknowledgeAlarmRequest,
  createSchedule as createScheduleRequest,
  deleteSchedule as deleteScheduleRequest,
  fetchDatalog,
  fetchAlarmDetail,
  fetchAlarms,
  fetchSensorHistory,
  resolveAlarm as resolveAlarmRequest,
  saveAutomaticControl as saveAutomaticControlRequest,
  saveSettings as saveSettingsRequest,
  setScheduleEnabled as setScheduleEnabledRequest,
  updateActuator,
} from './api'

import type {
  ApiAlarm,
  ApiAlarmDetail,
  ApiAlarmEvent,
  ApiAutomaticControl,
  ApiAutomaticControlUpdateRequest,
  ApiDatalogPage,
  ApiHistorySeries,
  ApiSettings,
  BootstrapData,
  ConnectionState,
  ScheduleRepeatRule,
} from './api'

import {
  useAuth,
} from './authContext'

import type {
  PageKey,
} from './pageConfig'

import {
  farmerReasonLabel,
} from './displayLabels'

import {
  formatTelemetryAge,
  getTelemetryFreshness,
} from './telemetryStatus'

import {
  UserManagementPage,
} from './UserManagementPage'
import {
  SmartSoilPage,
} from './SmartSoilPage'

import './SecondaryPages.css'





type ConnectedPageProps = {
  data: BootstrapData | null
  connectionState: ConnectionState
  onRefresh: () => void
}


function ControlGlyph({
  icon: Icon,
}: {
  icon: LucideIcon
}) {
  return (
    <Icon
      size={20}
      strokeWidth={1.9}
    />
  )
}


function PlantStatusPage({
  data,
}: ConnectedPageProps) {
  const [filter, setFilter] =
    useState('Semua')

  const [selectedPlant, setSelectedPlant] =
    useState<string | null>(null)


  const telemetryFreshness =
    getTelemetryFreshness(
      data?.latestTelemetry
        ?.recordedAt,
      data?.latestTelemetry !== null
      && data?.latestTelemetry !== undefined,
    )


  const telemetryAgeLabel =
    formatTelemetryAge(
      data?.latestTelemetry
        ?.recordedAt,
    )


  const databaseZones =
    useMemo(
      () =>
        [1, 2].map((zone) => {
          const moisture =
            data?.sensors.find(
              (sensor) =>
                sensor.id ===
                `soil_${zone}_moisture`,
            )?.value ?? null

          const temperature =
            data?.sensors.find(
              (sensor) =>
                sensor.id ===
                `soil_${zone}_temp`,
            )?.value ?? null

          const hasData =
            moisture !== null ||
            temperature !== null

          return {
            id: String(zone),

            name: `Zona Tanam ${zone}`,

            age:
              data?.devices[0]
                ?.growthPhase ??
              'fase belum tersedia',

            dataAvailable:
              hasData,

            status:
              hasData
                ? 'Data Tersedia'
                : 'Belum Ada Data',

            moisture:
              moisture === null
                ? '--'
                : `${moisture}%`,

            temperature:
              temperature === null
                ? '--'
                : `${temperature}°C`,

            note:
              hasData
                ? 'Nilai zona berasal dari data sensor tanah terbaru; tidak ada skor kesehatan sintetis.'
                : 'Belum ada data sensor tanah tersimpan pada sistem SPFF.',
          }
        }),
      [data],
    )


  const sourcePlants =
    databaseZones


  const visiblePlants =
    useMemo(
      () =>
        filter === 'Semua'
          ? sourcePlants
          : sourcePlants.filter(
              (plant) =>
                plant.status === filter,
            ),
      [
        filter,
        sourcePlants,
      ],
    )


  const detail =
    sourcePlants.find(
      (plant) =>
        plant.id === selectedPlant,
    )


  return (
    <section
      className="secondary-page"
      aria-label="Status tanaman"
    >
      <div className="page-summary-grid">
        <article className="summary-card">
          <span>
            Sensor Terdaftar
          </span>

          <strong>
            {data?.sensorDefinitions.length ?? 0}
          </strong>

          <small>
            Jumlah sensor yang tersedia
          </small>
        </article>


        <article className="summary-card">
          <span>
            Data Terbaru
          </span>

          <strong>
            {
              telemetryFreshness === 'fresh'
                ? 'Aktif'
                : telemetryFreshness === 'stale'
                  ? 'Terlambat'
                  : telemetryFreshness === 'expired'
                    ? 'Tidak Terbaru'
                    : 'Menunggu'
            }
          </strong>

          <small
            className={
              telemetryFreshness === 'fresh'
                ? 'positive-copy'
                : undefined
            }
          >
            {
              telemetryFreshness === 'waiting'
                ? 'Belum ada data tersimpan'
                : `Diperbarui ${telemetryAgeLabel ?? '-'}`
            }
          </small>
        </article>


        <article className="summary-card">
          <span>
            Fase Tumbuh
          </span>

          <strong>
            {
              data?.devices[0]
                ?.growthPhase ?? '-'
            }
          </strong>

          <small>
            Status perangkat terbaru
          </small>
        </article>


        <article className="summary-card">
          <span>
            Belum Ada Data
          </span>

          <strong>
            {
              sourcePlants.filter(
                (plant) =>
                  !plant.dataAvailable,
              ).length
            }{' '}
            zona
          </strong>

          <small>
            {
              data?.devices[0]
                ?.sensorValid === false
                ? 'Sensor perlu diperiksa'
                : 'Berdasarkan data terakhir'
            }
          </small>
        </article>
      </div>


      <div className="page-card">
        <div className="page-card-header">
          <div>
            <h2>
              Kondisi per Zona
            </h2>

            <p>
              Pemantauan pertumbuhan
              dan lingkungan tanaman.
            </p>
          </div>


          <label className="page-select">
            <span>
              Filter kondisi
            </span>

            <select
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value,
                )
              }
            >
              <option>
                Semua
              </option>

              <option>
                Data Tersedia
              </option>

              <option>
                Belum Ada Data
              </option>
            </select>
          </label>
        </div>


        <div className="plant-grid">
          {
            visiblePlants.map(
              (plant) => (
                <article
                  className="plant-card"
                  key={plant.id}
                >
                  <div className="plant-card-top">
                    <span className="zone-badge">
                      Zona {plant.id}
                    </span>

                    <span
                      className={
                        `status-chip status-chip--${plant.status.toLowerCase()}`
                      }
                    >
                      {plant.status}
                    </span>
                  </div>


                  <h3>
                    {plant.name}
                  </h3>

                  <p>
                    Umur tanaman{' '}
                    {plant.age}
                  </p>


                  <div className="health-row">
                    <strong>
                      {
                        plant.dataAvailable
                          ? 'Data sensor tersedia'
                          : 'Menunggu data'
                      }
                    </strong>
                  </div>


                  <dl className="plant-metrics">
                    <div>
                      <dt>
                        Kelembapan
                      </dt>

                      <dd>
                        {plant.moisture}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        Suhu
                      </dt>

                      <dd>
                        {plant.temperature}
                      </dd>
                    </div>
                  </dl>


                  <button
                    className="secondary-button full-button"
                    type="button"
                    onClick={() =>
                      setSelectedPlant(
                        (current) =>
                          current === plant.id
                            ? null
                            : plant.id,
                      )
                    }
                  >
                    {
                      selectedPlant === plant.id
                        ? 'Tutup Detail'
                        : 'Lihat Detail'
                    }
                  </button>
                </article>
              ),
            )
          }
        </div>


        {
          detail && (
            <div
              className="inline-detail"
              role="status"
            >
              <span
                className="inline-detail-icon"
                aria-hidden="true"
              >
                <Leaf
                  size={19}
                  strokeWidth={1.9}
                />
              </span>

              <div>
                <strong>
                  {detail.name}
                  {' — '}
                  Zona {detail.id}
                </strong>

                <p>
                  {detail.note}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedPlant(null)
                }
              >
                Tutup
              </button>
            </div>
          )
        }
      </div>
    </section>
  )
}


const controlMetadata:
Record<
  string,
  {
    icon: LucideIcon
    zone: string
  }
> = {
  pump_water: {
    icon: ShowerHead,
    zone: 'Irigasi Air',
  },

  pump_fert: {
    icon: FlaskConical,
    zone: 'Tangki Pupuk',
  },
}


const hourOptions =
  Array.from(
    {
      length: 24,
    },
    (_, hour) =>
      hour
        .toString()
        .padStart(2, '0'),
  )


const minuteOptions =
  Array.from(
    {
      length: 60,
    },
    (_, minute) =>
      minute
        .toString()
        .padStart(2, '0'),
  )


const repeatLabels:
Record<
  ScheduleRepeatRule,
  string
> = {
  daily:
    'Setiap Hari',

  weekdays:
    'Senin–Jumat',

  weekends:
    'Akhir Pekan',

  once:
    'Satu Kali',
}

const defaultAutomaticControl: ApiAutomaticControlUpdateRequest = {
  desiredMode: 'manual',
  water: {
    enabled: false,
    sensorKey: 'soil_1_moisture',
    moistureLowPercent: null,
    moistureTargetPercent: null,
    maxRuntimeSeconds: null,
    cooldownSeconds: null,
    minTankLevelPercent: null,
    minFlowLpm: null,
    triggerSampleCount: 3,
    sensorStaleSeconds: 120,
  },
  fertilizer: {
    enabled: false,
    sensorKey: 'liquid_ec_us_cm',
    ecLowUsCm: null,
    ecTargetUsCm: null,
    ecHighUsCm: null,
    dosePulseSeconds: null,
    mixingDelaySeconds: null,
    cooldownSeconds: null,
    maxDoseVolumeL: null,
    maxDailyVolumeL: null,
    minTankLevelPercent: null,
    minFlowLpm: null,
    triggerSampleCount: 3,
    sensorStaleSeconds: 120,
  },
}

const automaticControlDraft = (
  value: ApiAutomaticControl | null | undefined,
): ApiAutomaticControlUpdateRequest => value
  ? {
      desiredMode: value.desiredMode,
      water: {
        ...value.water,
        minTankLevelPercent: null,
      },
      fertilizer: {
        ...value.fertilizer,
        minTankLevelPercent: null,
      },
    }
  : {
      desiredMode: defaultAutomaticControl.desiredMode,
      water: { ...defaultAutomaticControl.water },
      fertilizer: { ...defaultAutomaticControl.fertilizer },
    }

function AutomaticNumberField({
  label,
  value,
  unit,
  min = 0,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string
  value: number | null
  unit: string
  min?: number
  max?: number
  step?: number
  disabled: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <label className="automatic-field">
      <span>{label}</span>
      <span className="automatic-input-wrap">
        <input
          type="number"
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            onChange(next === '' ? null : Number(next))
          }}
        />
        <small>{unit}</small>
      </span>
    </label>
  )
}


function ControlsPage({
  data,
  connectionState,
  onRefresh,
}: ConnectedPageProps) {
  const { user } =
    useAuth()

  const isAdmin =
    user.role === 'admin'


  const [
    commandNotice,
    setCommandNotice,
  ] =
    useState('')

  const [
    automaticDraft,
    setAutomaticDraft,
  ] = useState<ApiAutomaticControlUpdateRequest>(
    () => automaticControlDraft(data?.automaticControl),
  )

  const [
    savingAutomatic,
    setSavingAutomatic,
  ] = useState(false)


  const [
    scheduleDraft,
    setScheduleDraft,
  ] =
    useState<{
      controlId: string
      onTime: string
      offTime: string
      repeatRule: ScheduleRepeatRule
      runDate: string
    }>({
      controlId: '',

      onTime:
        '07:00',

      offTime:
        '07:15',

      repeatRule:
        'daily',

      runDate:
        new Date()
          .toLocaleDateString(
            'en-CA',
            {
              timeZone:
                'Asia/Jakarta',
            },
          ),
    })


  const controls =
  useMemo(
    () =>
      (
        data?.actuators ?? []
      ).map(
        (source) => ({
          ...source,

          icon:
            controlMetadata[
              source.id
            ]?.icon ??
            ShowerHead,

          zone:
            controlMetadata[
              source.id
            ]?.zone ??
            source.deviceId,

          pending:
            [
              'pending',
              'published',
              'accepted',
            ].includes(
              source.commandStatus ?? '',
            ),
        }),
      ),
    [
      data?.actuators,
    ],
  )


  const schedules =
    data?.schedules ?? []


  const mode =
    data?.devices[0]
      ?.mode ?? null

  const automaticControl =
    data?.automaticControl ?? null

  const desiredMode =
    automaticControl?.desiredMode
    ?? automaticDraft.desiredMode

  const selectedMode =
    automaticDraft.desiredMode

  const automaticModeRequested =
    desiredMode === 'automatic'
    || mode === 'automatic'

  const automaticApplied =
    automaticControl !== null
    && automaticControl.acknowledgedRevision === automaticControl.revision
    && automaticControl.acknowledgementStatus === 'applied'
    && automaticControl.appliedMode === automaticControl.desiredMode

  useEffect(
    () => {
      setAutomaticDraft(
        automaticControlDraft(data?.automaticControl),
      )
    },
    [
      data?.automaticControl,
    ],
  )


  useEffect(
    () => {
      if (
        controls.length === 0
      ) {
        return
      }

      setScheduleDraft(
        (current) => ({
          ...current,

          controlId:
            controls.some(
              (control) =>
                control.id ===
                current.controlId,
            )
              ? current.controlId
              : controls[0].id,
        }),
      )
    },
    [
      controls,
    ],
  )


  const setScheduleTime = (
    field:
      | 'onTime'
      | 'offTime',

    part:
      | 'hour'
      | 'minute',

    value: string,
  ) => {
    setScheduleDraft(
      (current) => {
        const [
          hour,
          minute,
        ] =
          current[field]
            .split(':')

        return {
          ...current,

          [field]:
            part === 'hour'
              ? `${value}:${minute}`
              : `${hour}:${value}`,
        }
      },
    )
  }

  const updateWater = (
    patch: Partial<ApiAutomaticControlUpdateRequest['water']>,
  ) => {
    setAutomaticDraft((current) => ({
      ...current,
      water: {
        ...current.water,
        ...patch,
      },
    }))
  }

  const updateFertilizer = (
    patch: Partial<ApiAutomaticControlUpdateRequest['fertilizer']>,
  ) => {
    setAutomaticDraft((current) => ({
      ...current,
      fertilizer: {
        ...current.fertilizer,
        ...patch,
      },
    }))
  }

  const saveAutomatic = async (
    next: ApiAutomaticControlUpdateRequest = automaticDraft,
  ) => {
    if (!isAdmin || savingAutomatic) return
    const supportedNext: ApiAutomaticControlUpdateRequest = {
      ...next,
      water: {
        ...next.water,
        minTankLevelPercent: null,
      },
      fertilizer: {
        ...next.fertilizer,
        minTankLevelPercent: null,
      },
    }
    if (
      supportedNext.desiredMode === 'automatic'
      && !supportedNext.water.enabled
      && !supportedNext.fertilizer.enabled
    ) {
      setCommandNotice(
        'Aktifkan dan lengkapi minimal satu profil sebelum memilih mode otomatis.',
      )
      return
    }
    setSavingAutomatic(true)
    setCommandNotice('Menyimpan konfigurasi kontrol otomatis...')
    try {
      const saved = await saveAutomaticControlRequest(supportedNext)
      setAutomaticDraft(automaticControlDraft(saved))
      setCommandNotice(
        'Pengaturan tersimpan. Menunggu alat menerapkannya.',
      )
      onRefresh()
    } catch (error) {
      setCommandNotice(
        error instanceof Error
          ? error.message
          : 'Konfigurasi kontrol otomatis gagal disimpan.',
      )
    } finally {
      setSavingAutomatic(false)
    }
  }

  const selectMode = (
    desiredMode: ApiAutomaticControlUpdateRequest['desiredMode'],
  ) => {
    const next = {
      ...automaticDraft,
      desiredMode,
    }
    setAutomaticDraft(next)
    void saveAutomatic(next)
  }


  const setAll =
    async (
      active: boolean,
    ) => {
      if (
        connectionState
        !== 'connected'
      ) {
        return
      }

      if (active && automaticModeRequested) {
        setCommandNotice(
          'Command ON manual dikunci saat mode otomatis diminta atau sedang aktif.',
        )
        return
      }


      const eligible =
        controls.filter(
          (control) =>
            !control.pending,
        )


      if (
        eligible.length === 0
      ) {
        setCommandNotice(
          'Semua aktuator masih menyelesaikan perintah sebelumnya.',
        )

        return
      }


      setCommandNotice(
        'Mengirim perintah...',
      )


      try {
        for (
          const control
          of eligible
        ) {
          await updateActuator(
            control.id,
            active,
          )
        }


        setCommandNotice(
          'Perintah terkirim. Status akan berubah setelah pompa merespons.',
        )

        onRefresh()
      } catch (error) {
        setCommandNotice(
          error instanceof Error
            ? error.message
            : 'Command gagal dikirim.',
        )

        onRefresh()
      }
    }


  const toggleControl =
    async (
      id: string,
    ) => {
      const target =
        controls.find(
          (control) =>
            control.id === id,
        )


      if (
        !target
        || target.pending
        || connectionState
          !== 'connected'
      ) {
        return
      }

      if (!target.isActive && automaticModeRequested) {
        setCommandNotice(
          'Command ON manual dikunci saat mode otomatis diminta atau sedang aktif.',
        )
        return
      }


      setCommandNotice(
        `Menyimpan command ${target.name}...`,
      )


      try {
        await updateActuator(
          id,
          !target.isActive,
        )


        setCommandNotice(
          `${target.name}: perintah dikirim. Menunggu kondisi pompa.`,
        )

        onRefresh()
      } catch (error) {
        setCommandNotice(
          error instanceof Error
            ? error.message
            : 'Command gagal dikirim.',
        )

        onRefresh()
      }
    }


  const addSchedule =
    async (
      event:
      React.FormEvent<
        HTMLFormElement
      >,
    ) => {
      event.preventDefault()


      if (!isAdmin) {
        setCommandNotice(
          'Hanya admin yang dapat menambah jadwal.',
        )

        return
      }

      if (automaticModeRequested) {
        setCommandNotice(
          'Jadwal dinonaktifkan saat cara otomatis digunakan agar pompa tidak menerima dua perintah.',
        )
        return
      }


      const actuator =
        controls.find(
          (control) =>
            control.id ===
            scheduleDraft.controlId,
        )


      if (!actuator) {
        setCommandNotice(
          'Pilih aktuator yang tersedia.',
        )

        return
      }


      if (
        scheduleDraft.onTime
        >= scheduleDraft.offTime
      ) {
        setCommandNotice(
          'Jam nonaktif harus setelah jam aktif pada hari yang sama.',
        )

        return
      }


      try {
        await createScheduleRequest({
          deviceId:
            actuator.deviceId,

          actuatorKey:
            actuator.id,

          onTime:
            scheduleDraft.onTime,

          offTime:
            scheduleDraft.offTime,

          repeatRule:
            scheduleDraft.repeatRule,

          runDate:
            scheduleDraft.repeatRule
            === 'once'
              ? scheduleDraft.runDate
              : null,
        })


        setCommandNotice(
          'Jadwal berhasil disimpan.',
        )

        onRefresh()
      } catch (error) {
        setCommandNotice(
          error instanceof Error
            ? error.message
            : 'Jadwal gagal disimpan.',
        )
      }
    }


  const toggleSchedule =
    async (
      id: string,
      enabled: boolean,
    ) => {
      if (!isAdmin) {
        setCommandNotice(
          'Hanya admin yang dapat mengubah jadwal.',
        )

        return
      }

      if (automaticModeRequested && !enabled) {
        setCommandNotice(
          'Jadwal tidak dapat diaktifkan saat mode otomatis.',
        )
        return
      }


      try {
        await setScheduleEnabledRequest(
          id,
          !enabled,
        )


        setCommandNotice(
          'Status jadwal berhasil disimpan.',
        )

        onRefresh()
      } catch (error) {
        setCommandNotice(
          error instanceof Error
            ? error.message
            : 'Status jadwal gagal diperbarui.',
        )
      }
    }


  const deleteSchedule =
    async (
      id: string,
    ) => {
      if (!isAdmin) {
        setCommandNotice(
          'Hanya admin yang dapat menghapus jadwal.',
        )

        return
      }


      try {
        await deleteScheduleRequest(
          id,
        )


        setCommandNotice(
          'Jadwal berhasil dihapus.',
        )

        onRefresh()
      } catch (error) {
        setCommandNotice(
          error instanceof Error
            ? error.message
            : 'Jadwal gagal dihapus.',
        )
      }
    }


  const activeCount =
    controls.filter(
      (control) =>
        control.isActive,
    ).length


  const activeScheduleCount =
    schedules.filter(
      (schedule) =>
        schedule.enabled,
    ).length


  return (
    <section
      className="secondary-page"
      aria-label="Kontrol perangkat"
    >
      <div className="control-toolbar page-card">
        <div>
          <h2>
            Mode Operasi
          </h2>

          <p>
            {
              `Diminta: ${desiredMode === 'automatic' ? 'otomatis' : 'manual'} - Aktual perangkat: ${
                mode === 'automatic'
                  ? 'otomatis'
                  : mode === 'manual'
                    ? 'manual'
                    : 'belum tersedia'
              }`
            }
          </p>
          <span className={automaticApplied ? 'sync-state is-applied' : 'sync-state'}>
            {
              automaticApplied
                ? 'Pengaturan sudah diterapkan'
                : automaticControl?.acknowledgementStatus === 'rejected'
                  ? 'Pengaturan ditolak: '
                    + (
                      farmerReasonLabel(automaticControl.acknowledgementReason)
                      || 'silakan periksa isian'
                    )
                  : 'Menunggu alat menerapkan pengaturan'
            }
          </span>
          {
            commandNotice
              ? (
                  <small className="mode-operation-notice">
                    {commandNotice}
                  </small>
                )
              : null
          }
        </div>


        <div
          className="segmented-control"
          aria-label="Pilih mode operasi yang diinginkan"
        >
          <button
            className={
              selectedMode === 'automatic'
                ? 'is-selected'
                : ''
            }
            type="button"
            onClick={() => selectMode('automatic')}
            disabled={
              !isAdmin
              || savingAutomatic
            }
          >
            Otomatis
          </button>

          <button
            className={
              selectedMode === 'manual'
                ? 'is-selected'
                : ''
            }
            type="button"
            onClick={() => selectMode('manual')}
            disabled={
              !isAdmin
              || savingAutomatic
            }
          >
            Manual
          </button>
        </div>


        {
          selectedMode === 'manual' && (
        <div className="toolbar-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              void setAll(false)
            }
            disabled={
              connectionState
              !== 'connected'
            }
          >
            Matikan Semua
          </button>

          <button
            className="primary-button"
            type="button"
            onClick={() =>
              void setAll(true)
            }
            disabled={
              connectionState
              !== 'connected'
              || automaticModeRequested
            }
          >
            Aktifkan Semua
          </button>
        </div>
          )
        }
      </div>

      {
        selectedMode === 'automatic' && (
      <div className="automatic-control-card page-card">
        <div className="automatic-control-header">
          <div>
            <h2>Parameter Kontrol Otomatis</h2>
            <p>
              Threshold agronomi tidak diisi default. Simpan nilai hasil kesepakatan tim agronomi,
              lalu pilih mode Otomatis. Interlock level tangki belum diaktifkan
              karena sensor masih mengirim jarak dalam cm.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => void saveAutomatic()}
            disabled={
              !isAdmin
              || savingAutomatic
            }
          >
            {savingAutomatic ? 'Menyimpan...' : 'Simpan Parameter'}
          </button>
        </div>

        <div className="automatic-profile-grid">
          <section className="automatic-profile">
            <div className="automatic-profile-heading">
              <div>
                <strong>Pompa Air</strong>
                <small>Hysteresis kelembapan tanah</small>
              </div>
              <label className="automatic-enable">
                <input
                  type="checkbox"
                  checked={automaticDraft.water.enabled}
                  disabled={!isAdmin}
                  onChange={(event) => updateWater({ enabled: event.target.checked })}
                />
                Aktif
              </label>
            </div>

            <label className="automatic-field">
              <span>Sensor utama</span>
              <select
                value={automaticDraft.water.sensorKey}
                disabled={!isAdmin}
                onChange={(event) => updateWater({
                  sensorKey: event.target.value === 'soil_2_moisture'
                    ? 'soil_2_moisture'
                    : 'soil_1_moisture',
                })}
              >
                <option value="soil_1_moisture">Kelembapan Tanah 1</option>
                <option value="soil_2_moisture">Kelembapan Tanah 2</option>
              </select>
            </label>

            <div className="automatic-fields">
              <AutomaticNumberField
                label="Minimum (pompa ON)"
                value={automaticDraft.water.moistureLowPercent}
                unit="%"
                max={100}
                step={0.1}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ moistureLowPercent: value })}
              />
              <AutomaticNumberField
                label="Target (pompa OFF)"
                value={automaticDraft.water.moistureTargetPercent}
                unit="%"
                max={100}
                step={0.1}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ moistureTargetPercent: value })}
              />
              <AutomaticNumberField
                label="Batas waktu menyala"
                value={automaticDraft.water.maxRuntimeSeconds}
                unit="detik"
                max={86400}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ maxRuntimeSeconds: value })}
              />
              <AutomaticNumberField
                label="Jeda sebelum menyala lagi"
                value={automaticDraft.water.cooldownSeconds}
                unit="detik"
                max={86400}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ cooldownSeconds: value })}
              />
              <AutomaticNumberField
                label="Minimum debit"
                value={automaticDraft.water.minFlowLpm}
                unit="L/min"
                max={10000}
                step={0.01}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ minFlowLpm: value })}
              />
              <AutomaticNumberField
                label="Jumlah pembacaan pemicu"
                value={automaticDraft.water.triggerSampleCount}
                unit="sampel"
                min={1}
                max={20}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ triggerSampleCount: value ?? 3 })}
              />
              <AutomaticNumberField
                label="Batas menunggu data"
                value={automaticDraft.water.sensorStaleSeconds}
                unit="detik"
                min={10}
                max={3600}
                disabled={!isAdmin}
                onChange={(value) => updateWater({ sensorStaleSeconds: value ?? 120 })}
              />
            </div>
          </section>

          <section className="automatic-profile">
            <div className="automatic-profile-heading">
              <div>
                <strong>Pompa Pupuk</strong>
                <small>Pulse dosing closed-loop EC larutan</small>
              </div>
              <label className="automatic-enable">
                <input
                  type="checkbox"
                  checked={automaticDraft.fertilizer.enabled}
                  disabled={!isAdmin}
                  onChange={(event) => updateFertilizer({ enabled: event.target.checked })}
                />
                Aktif
              </label>
            </div>

            <label className="automatic-field">
              <span>Sensor utama</span>
              <select value="liquid_ec_us_cm" disabled>
                <option value="liquid_ec_us_cm">EC Larutan</option>
              </select>
            </label>

            <div className="automatic-fields">
              <AutomaticNumberField
                label="EC minimum (mulai dosis)"
                value={automaticDraft.fertilizer.ecLowUsCm}
                unit="uS/cm"
                max={100000}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ ecLowUsCm: value })}
              />
              <AutomaticNumberField
                label="EC target (stop)"
                value={automaticDraft.fertilizer.ecTargetUsCm}
                unit="uS/cm"
                max={100000}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ ecTargetUsCm: value })}
              />
              <AutomaticNumberField
                label="EC maksimum"
                value={automaticDraft.fertilizer.ecHighUsCm}
                unit="uS/cm"
                max={100000}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ ecHighUsCm: value })}
              />
              <AutomaticNumberField
                label="Lama pompa sekali jalan"
                value={automaticDraft.fertilizer.dosePulseSeconds}
                unit="detik"
                min={1}
                max={3600}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ dosePulseSeconds: value })}
              />
              <AutomaticNumberField
                label="Waktu tunggu agar tercampur"
                value={automaticDraft.fertilizer.mixingDelaySeconds}
                unit="detik"
                min={1}
                max={86400}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ mixingDelaySeconds: value })}
              />
              <AutomaticNumberField
                label="Jeda sebelum pemberian berikutnya"
                value={automaticDraft.fertilizer.cooldownSeconds}
                unit="detik"
                max={86400}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ cooldownSeconds: value })}
              />
              <AutomaticNumberField
                label="Batas pupuk sekali jalan"
                value={automaticDraft.fertilizer.maxDoseVolumeL}
                unit="L"
                min={0.001}
                max={100000}
                step={0.001}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ maxDoseVolumeL: value })}
              />
              <AutomaticNumberField
                label="Batas pupuk per hari"
                value={automaticDraft.fertilizer.maxDailyVolumeL}
                unit="L"
                min={0.001}
                max={1000000}
                step={0.001}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ maxDailyVolumeL: value })}
              />
              <AutomaticNumberField
                label="Minimum debit"
                value={automaticDraft.fertilizer.minFlowLpm}
                unit="L/min"
                max={10000}
                step={0.01}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ minFlowLpm: value })}
              />
              <AutomaticNumberField
                label="Jumlah pembacaan pemicu"
                value={automaticDraft.fertilizer.triggerSampleCount}
                unit="sampel"
                min={1}
                max={20}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ triggerSampleCount: value ?? 3 })}
              />
              <AutomaticNumberField
                label="Batas menunggu data"
                value={automaticDraft.fertilizer.sensorStaleSeconds}
                unit="detik"
                min={10}
                max={3600}
                disabled={!isAdmin}
                onChange={(value) => updateFertilizer({ sensorStaleSeconds: value ?? 120 })}
              />
            </div>
          </section>
        </div>
      </div>
        )
      }


      {
        selectedMode === 'manual' && (
      <div className="control-grid">
        {
          controls.length > 0
            ? controls.map(
                (control) => (
                  <article
                    className="control-card"
                    key={control.id}
                  >
                    <div
                      className="control-icon"
                      aria-hidden="true"
                    >
                      <ControlGlyph
                        icon={
                          control.icon
                        }
                      />
                    </div>


                    <div className="control-copy">
                      <h3>
                        {control.name}
                      </h3>

                      <p>
                        {control.zone}
                      </p>

                      <span
                        className={
                          control.isActive
                            ? 'device-active'
                            : 'device-inactive'
                        }
                      >
                        {
                          control.pending
                            ? `Menunggu pompa ${
                                control.requestedIsActive
                                  ? 'ON'
                                  : 'OFF'
                              }`

                            : control.state
                              === 'offline'
                              ? 'Offline'

                              : control.isActive
                                ? 'Aktif'
                                : 'Nonaktif'
                        }
                      </span>
                    </div>


                    <button
                      className={
                        `switch ${
                          control.isActive
                            ? 'is-on'
                            : ''
                        }`
                      }
                      type="button"
                      role="switch"
                      aria-checked={
                        control.isActive
                      }
                      aria-label={
                        `${
                          control.isActive
                            ? 'Matikan'
                            : 'Aktifkan'
                        } ${control.name}`
                      }
                      onClick={() =>
                        void toggleControl(
                          control.id,
                        )
                      }
                      disabled={
                        control.pending
                        || connectionState
                          !== 'connected'
                        || (
                          automaticModeRequested
                          && !control.isActive
                        )
                      }
                    >
                      <span />
                    </button>
                  </article>
                ),
              )

            : (
              <div className="schedule-empty">
                Belum ada aktuator aktif yang tersedia.
              </div>
            )
        }
      </div>
        )
      }


      {
        selectedMode === 'automatic' && (
      <div className="actuator-schedule-card page-card">
        <div className="schedule-card-header">
          <div>
            <h2>
              Penjadwalan Aktuator
            </h2>

            <p>
              {
                isAdmin
                  ? 'Jadwal disimpan di sistem lokal.'
                  : 'Operator dapat melihat jadwal; perubahan jadwal hanya untuk admin.'
              }
            </p>
          </div>


          <div className="schedule-summary">
            <CalendarClock
              size={19}
              strokeWidth={1.9}
              aria-hidden="true"
            />

            <span>
              <strong>
                {activeScheduleCount}
                {' '}
                jadwal aktif
              </strong>

              <small>
                Tersimpan di sistem
              </small>
            </span>
          </div>
        </div>


        <form
          className="schedule-builder"
          onSubmit={addSchedule}
          aria-disabled={!isAdmin}
        >
          <label className="schedule-field">
            <span>
              Aktuator
            </span>

            <select
              value={
                scheduleDraft.controlId
              }
              onChange={(event) =>
                setScheduleDraft(
                  (current) => ({
                    ...current,

                    controlId:
                      event.target.value,
                  }),
                )
              }
              disabled={
                controls.length === 0
                || !isAdmin
              }
            >
              {
                controls.map(
                  (control) => (
                    <option
                      value={control.id}
                      key={control.id}
                    >
                      {control.name}
                    </option>
                  ),
                )
              }
            </select>
          </label>


          <label className="schedule-field">
            <span>
              Jam Aktif
            </span>

            <div className="time-select-group">
              <select
                disabled={!isAdmin}
                aria-label="Jam aktif"
                value={
                  scheduleDraft.onTime
                    .split(':')[0]
                }
                onChange={(event) =>
                  setScheduleTime(
                    'onTime',
                    'hour',
                    event.target.value,
                  )
                }
              >
                {
                  hourOptions.map(
                    (hour) => (
                      <option
                        value={hour}
                        key={
                          `on-hour-${hour}`
                        }
                      >
                        {hour}
                      </option>
                    ),
                  )
                }
              </select>

              <span aria-hidden="true">
                :
              </span>

              <select
                disabled={!isAdmin}
                aria-label="Menit aktif"
                value={
                  scheduleDraft.onTime
                    .split(':')[1]
                }
                onChange={(event) =>
                  setScheduleTime(
                    'onTime',
                    'minute',
                    event.target.value,
                  )
                }
              >
                {
                  minuteOptions.map(
                    (minute) => (
                      <option
                        value={minute}
                        key={
                          `on-minute-${minute}`
                        }
                      >
                        {minute}
                      </option>
                    ),
                  )
                }
              </select>
            </div>
          </label>


          <label className="schedule-field">
            <span>
              Jam Nonaktif
            </span>

            <div className="time-select-group">
              <select
                disabled={!isAdmin}
                aria-label="Jam nonaktif"
                value={
                  scheduleDraft.offTime
                    .split(':')[0]
                }
                onChange={(event) =>
                  setScheduleTime(
                    'offTime',
                    'hour',
                    event.target.value,
                  )
                }
              >
                {
                  hourOptions.map(
                    (hour) => (
                      <option
                        value={hour}
                        key={
                          `off-hour-${hour}`
                        }
                      >
                        {hour}
                      </option>
                    ),
                  )
                }
              </select>

              <span aria-hidden="true">
                :
              </span>

              <select
                disabled={!isAdmin}
                aria-label="Menit nonaktif"
                value={
                  scheduleDraft.offTime
                    .split(':')[1]
                }
                onChange={(event) =>
                  setScheduleTime(
                    'offTime',
                    'minute',
                    event.target.value,
                  )
                }
              >
                {
                  minuteOptions.map(
                    (minute) => (
                      <option
                        value={minute}
                        key={
                          `off-minute-${minute}`
                        }
                      >
                        {minute}
                      </option>
                    ),
                  )
                }
              </select>
            </div>
          </label>


          <label className="schedule-field">
            <span>
              Pengulangan
            </span>

            <select
              value={
                scheduleDraft.repeatRule
              }
              disabled={!isAdmin}
              onChange={(event) => {
                const repeatRule:
                ScheduleRepeatRule =
                  event.target.value === 'weekdays'
                    ? 'weekdays'
                    : event.target.value === 'weekends'
                      ? 'weekends'
                      : event.target.value === 'once'
                        ? 'once'
                        : 'daily'

                setScheduleDraft(
                  (current) => ({
                    ...current,
                    repeatRule,
                  }),
                )
              }}
            >
              {
                Object.entries(
                  repeatLabels,
                ).map(
                  ([
                    value,
                    label,
                  ]) => (
                    <option
                      value={value}
                      key={value}
                    >
                      {label}
                    </option>
                  ),
                )
              }
            </select>
          </label>


          {
            scheduleDraft.repeatRule
            === 'once'
            && (
              <label className="schedule-field">
                <span>
                  Tanggal
                </span>

                <input
                  type="date"
                  value={
                    scheduleDraft.runDate
                  }
                  disabled={!isAdmin}
                  min={
                    new Date()
                      .toLocaleDateString(
                        'en-CA',
                        {
                          timeZone:
                            'Asia/Jakarta',
                        },
                      )
                  }
                  onChange={(event) =>
                    setScheduleDraft(
                      (current) => ({
                        ...current,

                        runDate:
                          event.target.value,
                      }),
                    )
                  }
                  required
                />
              </label>
            )
          }


          <button
            className="primary-button schedule-add-button"
            type="submit"
            disabled={
              !isAdmin
              || controls.length === 0
              || connectionState
                !== 'connected'
              || automaticModeRequested
            }
          >
            <Plus
              size={15}
              strokeWidth={2}
              aria-hidden="true"
            />

            Tambah Jadwal
          </button>
        </form>


        <div className="actuator-schedule-list">
          {
            schedules.length > 0
              ? schedules.map(
                  (schedule) => {
                    const actuator =
                      controls.find(
                        (control) =>
                          control.id ===
                          schedule.actuatorKey,
                      )

                    const Icon =
                      actuator?.icon ??
                      ShowerHead


                    return (
                      <article
                        className="actuator-schedule-item"
                        key={schedule.id}
                      >
                        <span
                          className="schedule-actuator-icon"
                          aria-hidden="true"
                        >
                          <ControlGlyph
                            icon={Icon}
                          />
                        </span>


                        <span className="schedule-item-copy">
                          <strong>
                            {
                              schedule.actuatorName
                            }
                          </strong>

                          <small>
                            {
                              schedule.deviceId
                            }
                            {' · '}
                            {
                              repeatLabels[
                                schedule.repeatRule
                              ]
                            }
                          </small>
                        </span>


                        <span className="schedule-time-block schedule-on-time">
                          <small>
                            Aktif
                          </small>

                          <strong>
                            {
                              schedule.onTime
                            }
                          </strong>
                        </span>


                        <span
                          className="schedule-time-arrow"
                          aria-hidden="true"
                        >
                          →
                        </span>


                        <span className="schedule-time-block schedule-off-time">
                          <small>
                            Nonaktif
                          </small>

                          <strong>
                            {
                              schedule.offTime
                            }
                          </strong>
                        </span>


                        <span
                          className={
                            schedule.enabled
                              ? 'schedule-state is-active'
                              : 'schedule-state'
                          }
                        >
                          {
                            schedule.enabled
                              ? 'Aktif'
                              : 'Nonaktif'
                          }
                        </span>


                        <button
                          className={
                            `switch ${
                              schedule.enabled
                                ? 'is-on'
                                : ''
                            }`
                          }
                          type="button"
                          role="switch"
                          aria-checked={
                            schedule.enabled
                          }
                          aria-label={
                            `${
                              schedule.enabled
                                ? 'Nonaktifkan'
                                : 'Aktifkan'
                            } jadwal ${schedule.actuatorName}`
                          }
                          onClick={() =>
                            void toggleSchedule(
                              schedule.id,
                              schedule.enabled,
                            )
                          }
                          disabled={
                            !isAdmin
                            || (
                              automaticModeRequested
                              && !schedule.enabled
                            )
                          }
                        >
                          <span />
                        </button>


                        <button
                          className="schedule-delete-button"
                          type="button"
                          aria-label={
                            `Hapus jadwal ${schedule.actuatorName}`
                          }
                          onClick={() =>
                            void deleteSchedule(
                              schedule.id,
                            )
                          }
                          disabled={!isAdmin}
                        >
                          <Trash2
                            size={15}
                            strokeWidth={1.9}
                            aria-hidden="true"
                          />
                        </button>
                      </article>
                    )
                  },
                )

              : (
                <div className="schedule-empty">
                  <CalendarClock
                    size={22}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />

                  <span>
                    Belum ada jadwal aktuator.
                  </span>
                </div>
              )
          }
        </div>
      </div>
        )
      }


      <div className="operation-note page-card">
        <span aria-hidden="true">
          <Info
            size={17}
            strokeWidth={2}
          />
        </span>

        <p>
          {
            commandNotice
            || (
              connectionState
              === 'connected'
                ? `${activeCount} dari ${controls.length} aktuator aktif berdasarkan status terakhir.`
                : 'Sistem belum tersambung.'
            )
          }
        </p>
      </div>
    </section>
  )
}


const jakartaDateInputValue = () =>
  new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).format(new Date())


const datalogDateTime = (
  date: string,
  time: string,
  endOfMinute: boolean,
) => new Date(
  `${date}T${time || (endOfMinute ? '23:59' : '00:00')}:${
    endOfMinute ? '59.999' : '00'
  }+07:00`,
)


function LogsPage({
  data,
  connectionState,
}: ConnectedPageProps) {
  const [
    logType,
    setLogType,
  ] =
    useState<
      'sensor'
      | 'actuator'
    >(
      'sensor',
    )


  const [
    sensor,
    setSensor,
  ] =
    useState(
      'all',
    )


  const [
    actuator,
    setActuator,
  ] =
    useState(
      'all',
    )


  const [fromDate, setFromDate] = useState(jakartaDateInputValue)
  const [toDate, setToDate] = useState(jakartaDateInputValue)
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')

  const [datalogPage, setDatalogPage] = useState<ApiDatalogPage | null>(null)
  const [datalogLoading, setDatalogLoading] = useState(false)
  const [datalogError, setDatalogError] = useState('')

  const [chartSensor, setChartSensor] = useState('soil_1_moisture')
  const [chartSeries, setChartSeries] = useState<ApiHistorySeries | null>(null)
  const [chartLoading, setChartLoading] = useState(false)


  const [
    currentPage,
    setCurrentPage,
  ] =
    useState(
      1,
    )


  const sensorGroups =
    useMemo(
      () => {
        const groups =
          new Map<
            string,
            BootstrapData[
              'sensorDefinitions'
            ]
          >()


        for (
          const definition
          of data
            ?.sensorDefinitions
            ?? []
        ) {
          const definitions =
            groups.get(
              definition.groupName,
            )
            ?? []


          definitions.push(
            definition,
          )


          groups.set(
            definition.groupName,
            definitions,
          )
        }


        return Array.from(
          groups,
          ([
            groupName,
            definitions,
          ]) => ({
            groupName,
            definitions,
          }),
        )
      },
      [
        data
          ?.sensorDefinitions,
      ],
    )


  const sensorRows =
    (
      datalogPage?.items.filter((row) => row.kind === 'sensor') ?? []
    ).map(
      (row) => [
        new Date(
          row.recordedAt,
        ).toLocaleString(
          'id-ID',
          {
            day:
              '2-digit',

            month:
              '2-digit',

            year:
              'numeric',

            hour:
              '2-digit',

            minute:
              '2-digit',

            second:
              '2-digit',
          },
        ),

        row.displayName,

        `${row.value ?? '--'} ${row.unit}`
          .trim(),

        'Tersimpan',

        row.parameterKey,

        row.recordedAt,
      ],
    )


  const actuatorRows =
    (
      datalogPage?.items.filter((row) => row.kind === 'actuator') ?? []
    ).map(
      (row) => {
        const stateLabel = {
          active:
            'Aktif',
          inactive:
            'Nonaktif',
          processing:
            'Diproses',
          offline:
            'Offline',
          fault:
            'Gangguan',
        }[
          row.state ?? 'offline'
        ]


        const sourceLabel = {
          telemetry:
            'Telemetry Perangkat',
          command_ack:
            'Konfirmasi perintah',
          manual:
            'Manual',
          system:
            'Sistem Perangkat',
        }[
          row.source ?? 'system'
        ]


        return [
          new Date(
            row.recordedAt,
          ).toLocaleString(
            'id-ID',
            {
              day:
                '2-digit',

              month:
                '2-digit',

              year:
                'numeric',

              hour:
                '2-digit',

              minute:
                '2-digit',

              second:
                '2-digit',
            },
          ),

          row.displayName,

          stateLabel,

          row.reason
            ? sourceLabel
              + ' · '
              + farmerReasonLabel(row.reason)
            : sourceLabel,

          row.parameterKey,

          row.recordedAt,
        ]
      },
    )


  const databaseRows =
    logType === 'sensor'
      ? sensorRows
      : actuatorRows


  const selectedParameter =
    logType === 'sensor'
      ? sensor
      : actuator


  useEffect(
    () => {
      const rangeFrom = datalogDateTime(fromDate, fromTime, false)
      const rangeTo = datalogDateTime(toDate, toTime, true)
      const rangeDurationMs = rangeTo.getTime() - rangeFrom.getTime()
      const rangeIsValid =
        fromDate !== ''
        && toDate !== ''
        && Number.isFinite(rangeDurationMs)
        && rangeDurationMs >= 0
        && rangeDurationMs <= 31 * 24 * 60 * 60 * 1000

      if (connectionState !== 'connected' || !rangeIsValid) {
        setDatalogPage(null)
        if (!rangeIsValid) {
          setDatalogError('Pilih rentang tanggal maksimal 31 hari.')
        }
        return
      }

      const controller = new AbortController()
      setDatalogLoading(true)
      setDatalogError('')

      void fetchDatalog(
        {
          kind: logType,
          parameter: selectedParameter,
          from: rangeFrom,
          to: rangeTo,
          page: currentPage,
          pageSize: 10,
        },
        controller.signal,
      )
        .then(setDatalogPage)
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setDatalogPage(null)
          setDatalogError(
            error instanceof Error ? error.message : 'Datalog belum dapat dimuat.',
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setDatalogLoading(false)
        })

      return () => controller.abort()
    },
    [
      connectionState,
      currentPage,
      fromDate,
      fromTime,
      logType,
      selectedParameter,
      toDate,
      toTime,
    ],
  )


  useEffect(
    () => {
      const rangeFrom = datalogDateTime(fromDate, fromTime, false)
      const rangeTo = datalogDateTime(toDate, toTime, true)
      const rangeDurationMs = rangeTo.getTime() - rangeFrom.getTime()
      const rangeIsValid =
        fromDate !== ''
        && toDate !== ''
        && Number.isFinite(rangeDurationMs)
        && rangeDurationMs >= 0
        && rangeDurationMs <= 31 * 24 * 60 * 60 * 1000

      if (connectionState !== 'connected' || !rangeIsValid || !chartSensor) {
        setChartSeries(null)
        return
      }

      const controller = new AbortController()
      const rangeHours = rangeDurationMs / (60 * 60 * 1000)
      const bucket = rangeHours <= 24 ? '5m' : rangeHours <= 7 * 24 ? '1h' : '6h'
      setChartLoading(true)

      void fetchSensorHistory(
        chartSensor,
        controller.signal,
        {
          from: rangeFrom,
          to: rangeTo,
          hours: Math.max(1, Math.ceil(rangeHours)),
          bucket,
        },
      )
        .then(setChartSeries)
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setChartSeries(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setChartLoading(false)
        })

      return () => controller.abort()
    },
    [
      chartSensor,
      connectionState,
      fromDate,
      fromTime,
      toDate,
      toTime,
    ],
  )


  const rows = databaseRows


  const rowsPerPage =
    10


  const totalPages =
    datalogPage?.pagination.totalPages ?? 1


  useEffect(
    () => {
      setCurrentPage(
        (page) =>
          Math.min(
            page,
            totalPages,
          ),
      )
    },
    [
      totalPages,
    ],
  )


  const pageStart =
    (
      currentPage
      - 1
    )
    * rowsPerPage


  const visibleRows =
    rows


  const visiblePageCount =
    Math.min(
      totalPages,
      5,
    )


  const pageWindowStart =
    Math.min(
      Math.max(
        currentPage
        - Math.floor(
            visiblePageCount
            / 2,
          ),
        1,
      ),
      Math.max(
        totalPages
        - visiblePageCount
        + 1,
        1,
      ),
    )


  const visiblePages =
    Array.from(
      {
        length:
          visiblePageCount,
      },
      (
        _,
        index,
      ) =>
        pageWindowStart
        + index,
    )


  const chartPoints = useMemo(
    () => chartSeries?.points ?? [],
    [chartSeries],
  )


  const chartGeometry = useMemo(
    () => {
      const plotLeft = 28
      const plotRight = 732
      const plotBottom = 202
      const values = chartPoints.map((point) => point.value)

      if (values.length === 0) {
        return { points: [], linePath: '', areaPath: '', plotBottom }
      }

      const maximum = Math.max(...values)
      const minimum = Math.min(...values)
      const valueRange = Math.max(maximum - minimum, 1)
      const points = values.map((value, index) => ({
        x: values.length === 1
          ? (plotLeft + plotRight) / 2
          : plotLeft + (index * (plotRight - plotLeft)) / (values.length - 1),
        y: plotBottom - 18 - ((value - minimum) / valueRange) * 132,
      }))
      const linePath = points.reduce((path, point, index) => {
        if (index === 0) return `M ${point.x} ${point.y}`
        const previous = points[index - 1]
        const controlX = (previous.x + point.x) / 2
        return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`
      }, '')

      return {
        points,
        linePath,
        areaPath: `${linePath} L ${plotRight} ${plotBottom} L ${plotLeft} ${plotBottom} Z`,
        plotBottom,
      }
    },
    [chartPoints],
  )

  const chartMarkerCount = Math.min(chartGeometry.points.length, 6)
  const chartMarkerIndexes = chartMarkerCount === 0
    ? []
    : chartMarkerCount === 1
      ? [0]
      : Array.from(
          { length: chartMarkerCount },
          (_, index) => Math.round(
            index * (chartGeometry.points.length - 1) / (chartMarkerCount - 1),
          ),
        )

  const dateRangeLabel = `${fromDate} ${fromTime || '00:00'} – ${toDate} ${toTime || '23:59'}`


  const exportCsv =
    () => {
      const csv =
        [
          [
            'Waktu',
            'Parameter',
            'Nilai',
            logType === 'sensor'
              ? 'Status'
              : 'Sumber',
          ],
          ...rows.map(
            (row) =>
              row.slice(
                0,
                4,
              ),
          ),
        ]
          .map(
            (row) =>
              row
                .map(
                  (cell) =>
                    `"${cell}"`,
                )
                .join(','),
          )
          .join('\n')


      const blob =
        new Blob(
          [
            csv,
          ],
          {
            type:
              'text/csv;charset=utf-8',
          },
        )


      const url =
        URL.createObjectURL(
          blob,
        )


      const link =
        document
          .createElement('a')


      link.href =
        url


      link.download =
        `fertigasi-datalog-${fromDate}-${toDate}.csv`


      document.body
        .appendChild(
          link,
        )


      link.click()


      link.remove()


      URL.revokeObjectURL(
        url,
      )
    }


  const resetFilters =
    () => {
      setLogType(
        'sensor',
      )

      setSensor(
        'all',
      )

      setActuator(
        'all',
      )

      const today = jakartaDateInputValue()
      setFromDate(today)
      setToDate(today)
      setFromTime('')
      setToTime('')

      setCurrentPage(
        1,
      )
    }


  return (
    <section
      className="secondary-page"
      aria-label="Datalog sensor dan pompa"
    >
      <div className="page-card">
        <div className="page-card-header logs-header">
          <div>
            <h2>
              Riwayat Sensor & Pompa
            </h2>

            <p>
              {
                logType
                === 'sensor'
                  ? 'Data sensor tersimpan'
                  : 'Aktivitas ON/OFF pompa'
              }
              untuk {dateRangeLabel}.
            </p>
          </div>


          <div className="log-actions">
            <label className="page-select compact-select">
              <span>
                Jenis Data
              </span>

              <select
                value={logType}
                onChange={(event) => {
                  setLogType(
                    event.target
                      .value
                    === 'actuator'
                      ? 'actuator'
                      : 'sensor',
                  )

                  setCurrentPage(
                    1,
                  )
                }}
              >
                <option value="sensor">
                  Sensor
                </option>

                <option value="actuator">
                  Aktivitas Pompa
                </option>
              </select>
            </label>


            <label className="page-select compact-select">
              <span>
                Parameter
              </span>

              <select
                value={
                  selectedParameter
                }
                onChange={(event) => {
                  if (
                    logType
                    === 'sensor'
                  ) {
                    setSensor(
                      event.target.value,
                    )
                  } else {
                    setActuator(
                      event.target.value,
                    )
                  }

                  setCurrentPage(
                    1,
                  )
                }}
              >
                <option value="all">
                  {
                    logType
                    === 'sensor'
                      ? 'Semua Sensor'
                      : 'Semua Pompa'
                  }
                </option>

                {
                  logType
                  === 'sensor'
                    ? sensorGroups.map(
                        (group) => (
                          <optgroup
                            key={
                              group.groupName
                            }
                            label={
                              group.groupName
                            }
                          >
                            {
                              group.definitions.map(
                                (definition) => (
                                  <option
                                    key={
                                      definition.sensorKey
                                    }
                                    value={
                                      definition.sensorKey
                                    }
                                  >
                                    {
                                      definition.displayName
                                    }
                                    {' · '}
                                    {
                                      definition.unit
                                    }
                                  </option>
                                ),
                              )
                            }
                          </optgroup>
                        ),
                      )
                    : (
                        data
                          ?.actuators
                          ?? []
                      ).map(
                        (pump) => (
                          <option
                            key={pump.id}
                            value={pump.id}
                          >
                            {pump.name}
                          </option>
                        ),
                      )
                }
              </select>
            </label>


            <label className="page-select compact-select datalog-date-filter">
              <span>
                Dari Tanggal
              </span>

              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => {
                  setFromDate(event.target.value)
                  setCurrentPage(1)
                }}
              />
            </label>

            <label className="page-select compact-select datalog-date-filter">
              <span>Sampai Tanggal</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => {
                  setToDate(event.target.value)
                  setCurrentPage(1)
                }}
              />
            </label>

            <label className="page-select compact-select datalog-time-filter">
              <span>Dari Jam</span>
              <input
                type="time"
                value={fromTime}
                onChange={(event) => {
                  setFromTime(event.target.value)
                  setCurrentPage(1)
                }}
              />
              <small>Kosong = 00:00</small>
            </label>

            <label className="page-select compact-select datalog-time-filter">
              <span>Sampai Jam</span>
              <input
                type="time"
                value={toTime}
                onChange={(event) => {
                  setToTime(event.target.value)
                  setCurrentPage(1)
                }}
              />
              <small>Kosong = 23:59</small>
            </label>


            <button
              className="secondary-button"
              type="button"
              onClick={
                resetFilters
              }
            >
              Reset
            </button>


            <button
              className="primary-button"
              type="button"
              onClick={
                exportCsv
              }
              disabled={rows.length === 0 || datalogLoading}
            >
              Ekspor CSV
            </button>
          </div>
        </div>

        {datalogError && (
          <div className="datalog-feedback is-error">
            <AlertTriangle size={16} /> {datalogError}
          </div>
        )}

        {datalogLoading && (
          <div className="datalog-feedback">
            Memuat data sesuai rentang waktu…
          </div>
        )}


        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  Waktu
                </th>

                <th>
                  Parameter
                </th>

                <th>
                  Nilai
                </th>

                <th>
                  {
                    logType
                    === 'sensor'
                      ? 'Status'
                      : 'Sumber'
                  }
                </th>
              </tr>
            </thead>

            <tbody>
              {
                visibleRows.map(
                  (
                    row,
                    index,
                  ) => (
                    <tr
                      key={
                        `${row[0]}-${row[1]}-${pageStart + index}`
                      }
                    >
                      <td>
                        {row[0]}
                      </td>

                      <td>
                        {row[1]}
                      </td>

                      <td>
                        <strong>
                          {row[2]}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={
                            row[3]
                            === 'Tersimpan'
                            || row[2]
                            === 'Aktif'
                              ? 'table-status'
                              : 'table-status table-status--watch'
                          }
                        >
                          {row[3]}
                        </span>
                      </td>
                    </tr>
                  ),
                )
              }
            </tbody>
          </table>
        </div>


        <div className="data-table-footer">
          <p className="table-caption">
            {
              connectionState
              === 'connected'
                ? (
                    rows.length > 0
                      ? (
                          'Menampilkan '
                          + (
                            pageStart
                            + 1
                          )
                          + '–'
                          + (
                            pageStart
                            + visibleRows.length
                          )
                          + ' dari '
                          + (datalogPage?.pagination.totalItems ?? rows.length)
                          + (
                            logType
                            === 'sensor'
                              ? ' data telemetry.'
                              : ' aktivitas pompa.'
                          )
                        )
                      : (
                          logType
                          === 'sensor'
                            ? 'Belum ada data telemetry untuk filter ini.'
                            : 'Belum ada aktivitas pompa untuk filter ini.'
                        )
                  )
                : 'Sistem belum tersambung.'
            }
          </p>


          <nav
            className="data-pagination"
            aria-label="Navigasi halaman datalog"
          >
            <button
              className="data-pagination-step"
              type="button"
              disabled={
                currentPage
                <= 1
              }
              onClick={() =>
                setCurrentPage(
                  (page) =>
                    Math.max(
                      1,
                      page - 1,
                    ),
                )
              }
            >
              Sebelumnya
            </button>


            <div className="data-pagination-pages">
              {
                visiblePages.map(
                  (page) => (
                    <button
                      className={
                        page
                        === currentPage
                          ? 'data-pagination-page is-active'
                          : 'data-pagination-page'
                      }
                      type="button"
                      key={page}
                      aria-label={
                        `Buka halaman ${page}`
                      }
                      aria-current={
                        page
                        === currentPage
                          ? 'page'
                          : undefined
                      }
                      onClick={() =>
                        setCurrentPage(
                          page,
                        )
                      }
                    >
                      {page}
                    </button>
                  ),
                )
              }
            </div>


            <button
              className="data-pagination-step"
              type="button"
              disabled={
                currentPage
                >= totalPages
              }
              onClick={() =>
                setCurrentPage(
                  (page) =>
                    Math.min(
                      totalPages,
                      page + 1,
                    ),
                )
              }
            >
              Berikutnya
            </button>
          </nav>
        </div>
      </div>

      <article className="page-card datalog-chart-card">
        <div className="datalog-chart-header">
          <div>
            <h2>Grafik Riwayat Sensor</h2>
            <p>{dateRangeLabel} · nilai rata-rata per interval</p>
          </div>

          <label className="page-select compact-select datalog-chart-select">
            <span>Parameter Grafik</span>
            <select
              value={chartSensor}
              onChange={(event) => setChartSensor(event.target.value)}
            >
              {sensorGroups.map((group) => (
                <optgroup key={group.groupName} label={group.groupName}>
                  {group.definitions.map((definition) => (
                    <option key={definition.sensorKey} value={definition.sensorKey}>
                      {definition.displayName} · {definition.unit}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="datalog-chart-visual">
          {chartLoading ? (
            <div className="datalog-chart-empty">Memuat grafik…</div>
          ) : chartPoints.length === 0 ? (
            <div className="datalog-chart-empty">
              Belum ada data sensor pada rentang waktu ini.
            </div>
          ) : (
            <svg
              viewBox="0 0 760 230"
              role="img"
              aria-label="Grafik riwayat sensor sesuai rentang Datalog"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="datalog-chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#27b484" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#27b484" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <line
                className="datalog-chart-baseline"
                x1="28"
                x2="732"
                y1={chartGeometry.plotBottom}
                y2={chartGeometry.plotBottom}
              />
              <path
                className="datalog-chart-area"
                d={chartGeometry.areaPath}
                fill="url(#datalog-chart-fill)"
              />
              <path className="datalog-chart-line" d={chartGeometry.linePath} />
              {chartMarkerIndexes.map((historyIndex) => {
                const point = chartGeometry.points[historyIndex]
                const historyPoint = chartPoints[historyIndex]
                const markerLabel = new Date(historyPoint.recordedAt).toLocaleString(
                  'id-ID',
                  {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Jakarta',
                  },
                )
                return (
                  <g key={`${historyPoint.recordedAt}-${historyIndex}`}>
                    <title>
                      {`${markerLabel}: ${historyPoint.average} ${chartSeries?.unit ?? ''} (${historyPoint.samples} data)`}
                    </title>
                    <line
                      className="datalog-chart-guide"
                      x1={point.x}
                      x2={point.x}
                      y1={point.y}
                      y2={chartGeometry.plotBottom}
                    />
                    <circle className="datalog-chart-point" cx={point.x} cy={point.y} r="4" />
                    <text
                      className="datalog-chart-time-label"
                      x={point.x}
                      y="222"
                      textAnchor={historyIndex === 0 ? 'start' : historyIndex === chartPoints.length - 1 ? 'end' : 'middle'}
                    >
                      {markerLabel}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </article>
    </section>
  )
}


type AlarmStatus =
  | 'Aktif'
  | 'Diakui'
  | 'Selesai'

type AlarmSeverity =
  | 'Kritis'
  | 'Peringatan'
  | 'Informasi'

type AlarmRecord = {
  id: string
  title: string
  sensor: string
  value: string
  threshold: string
  severity: AlarmSeverity
  status: AlarmStatus
  detectedAt: string
  lastSeenAt: string
  occurrenceCount: number
  location: string
  description: string
  recommendation: string
}

const formatAlarmTime = (
  value: string | null | undefined,
) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('id-ID')
    : '-'
}

const alarmMetadata = (
  alarm: ApiAlarm,
  key: string,
  fallback: string,
) => {
  const value = alarm.metadata?.[key]
  return (
    typeof value === 'string'
    || typeof value === 'number'
  )
    ? String(value)
    : fallback
}

const apiAlarmToRecord = (
  alarm: ApiAlarm,
): AlarmRecord => {
  const measuredValue =
    alarm.currentValue === null
      ? alarmMetadata(alarm, 'value', '-')
      : `${alarm.currentValue}${alarm.unit ? ` ${alarm.unit}` : ''}`

  return {
    id: alarm.id,
    title: alarm.title,
    sensor: alarm.sourceKey,
    value: measuredValue,
    threshold:
      alarm.thresholdText
      ?? alarmMetadata(alarm, 'threshold', '-'),
    severity:
      alarm.severity === 'critical'
        ? 'Kritis'
        : alarm.severity === 'warning'
          ? 'Peringatan'
          : 'Informasi',
    status:
      alarm.status === 'resolved'
        ? 'Selesai'
        : alarm.status === 'acknowledged'
          ? 'Diakui'
          : 'Aktif',
    detectedAt: formatAlarmTime(alarm.triggeredAt),
    lastSeenAt: formatAlarmTime(alarm.lastSeenAt),
    occurrenceCount: alarm.occurrenceCount,
    location: alarmMetadata(alarm, 'location', 'Lokasi Utama'),
    description: alarm.description,
    recommendation:
      alarm.recommendation
      ?? alarmMetadata(
        alarm,
        'recommendation',
        'Periksa sumber alarm dan data terkait sebelum mengambil tindakan.',
      ),
  }
}

const alarmStatusQuery = (
  status: 'Semua' | AlarmStatus,
) =>
  status === 'Aktif'
    ? 'open'
    : status === 'Diakui'
      ? 'acknowledged'
      : status === 'Selesai'
        ? 'resolved'
        : undefined

const alarmEventTitle = (
  event: ApiAlarmEvent,
) => {
  switch (event.eventType) {
    case 'detected':
      return 'Alarm terdeteksi oleh sistem'
    case 'acknowledged':
      return `Alarm diakui${event.actor ? ` oleh ${event.actor}` : ''}`
    case 'escalated':
      return 'Prioritas alarm ditingkatkan'
    case 'recovered':
      return 'Kondisi kembali normal'
    case 'resolved':
      return `Alarm diselesaikan${event.actor ? ` oleh ${event.actor}` : ''}`
    default:
      return 'Catatan alarm ditambahkan'
  }
}


function AlarmPage({
  data,
  onRefresh,
}: ConnectedPageProps) {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [alarms, setAlarms] = useState<AlarmRecord[]>(
    () => data?.alarms.map(apiAlarmToRecord) ?? [],
  )
  const [selectedId, setSelectedId] = useState(
    () => data?.alarms[0]?.id ?? '',
  )
  const [selectedDetail, setSelectedDetail] =
    useState<ApiAlarmDetail | null>(null)
  const [statusFilter, setStatusFilter] =
    useState<'Semua' | AlarmStatus>('Semua')
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(8)
  const [totalItems, setTotalItems] = useState(data?.alarms.length ?? 0)
  const [totalPages, setTotalPages] = useState(1)
  const [counts, setCounts] = useState({
    open: data?.alarms.filter((alarm) => alarm.status === 'open').length ?? 0,
    acknowledged:
      data?.alarms.filter((alarm) => alarm.status === 'acknowledged').length ?? 0,
    resolved:
      data?.alarms.filter((alarm) => alarm.status === 'resolved').length ?? 0,
    criticalActive:
      data?.alarms.filter(
        (alarm) => alarm.status !== 'resolved' && alarm.severity === 'critical',
      ).length ?? 0,
  })
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [actionNote, setActionNote] = useState('')
  const [isActing, setIsActing] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter, query])

  useEffect(() => {
    const controller = new AbortController()
    let loading = false

    const load = async () => {
      if (loading) return
      loading = true
      try {
        const page = await fetchAlarms({
          status: alarmStatusQuery(statusFilter),
          query,
          page: currentPage,
          pageSize,
          signal: controller.signal,
        })
        const records = page.items.map(apiAlarmToRecord)
        setAlarms(records)
        setCounts(page.counts)
        setTotalItems(page.pagination.totalItems)
        setTotalPages(page.pagination.totalPages)
        if (currentPage > page.pagination.totalPages) {
          setCurrentPage(page.pagination.totalPages)
        }
        setSelectedId((current) =>
          records.some((alarm) => alarm.id === current)
            ? current
            : records[0]?.id ?? '',
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Alarm refresh failed.', error)
        }
      } finally {
        loading = false
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [currentPage, pageSize, query, refreshVersion, statusFilter])

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null)
      return
    }
    setSelectedDetail(null)
    const controller = new AbortController()
    void fetchAlarmDetail(selectedId, controller.signal)
      .then(setSelectedDetail)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error('Alarm detail refresh failed.', error)
        }
      })
    return () => controller.abort()
  }, [refreshVersion, selectedId])

  const visibleAlarms = alarms
  const selectedAlarm = selectedDetail
    ? apiAlarmToRecord(selectedDetail)
    : alarms.find((alarm) => alarm.id === selectedId)
  const activeCount = counts.open + counts.acknowledged
  const criticalCount = counts.criticalActive
  const acknowledgedCount = counts.acknowledged
  const resolvedCount = counts.resolved

  const updateStatus = async (
    status: AlarmStatus,
  ) => {
    if (!selectedId || isActing) return
    setIsActing(true)
    setActionError('')
    try {
      const note = actionNote.trim() || undefined
      if (status === 'Diakui') {
        await acknowledgeAlarmRequest(selectedId, note)
      } else if (status === 'Selesai' && isAdmin) {
        await resolveAlarmRequest(selectedId, note)
      }
      setActionNote('')
      setRefreshVersion((version) => version + 1)
      onRefresh()
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Aksi alarm gagal disimpan.',
      )
    } finally {
      setIsActing(false)
    }
  }



  return (
    <section
      className="secondary-page alarm-page"
      aria-label="Detail alarm"
    >
      <div className="page-summary-grid">
        <article className="summary-card">
          <span>
            Alarm Aktif
          </span>

          <strong>
            {activeCount}
          </strong>

          <small>
            Memerlukan perhatian
          </small>
        </article>


        <article className="summary-card">
          <span>
            Prioritas Kritis
          </span>

          <strong>
            {criticalCount}
          </strong>

          <small className="alarm-critical-copy">
            Tindak lanjuti segera
          </small>
        </article>


        <article className="summary-card">
          <span>
            Sudah Diakui
          </span>

          <strong>
            {acknowledgedCount}
          </strong>

          <small>
            Dalam proses penanganan
          </small>
        </article>


        <article className="summary-card">
          <span>
            Selesai
          </span>

          <strong>
            {resolvedCount}
          </strong>

          <small className="positive-copy">
            Kondisi kembali normal
          </small>
        </article>
      </div>


      <div className="page-card alarm-page-card">
        <div className="page-card-header alarm-page-header">
          <div>
            <h2>
              Riwayat dan Detail Alarm
            </h2>

            <p>
              Pantau anomali sensor
              serta tindak lanjut operator.
            </p>
          </div>


          <div className="alarm-tools">
            <label className="alarm-search">
              <Search
                size={15}
                strokeWidth={1.9}
                aria-hidden="true"
              />

              <span className="sr-only">
                Cari alarm
              </span>

              <input
                type="search"
                value={query}
                placeholder="Cari alarm atau sensor"
                onChange={(event) =>
                  setQuery(
                    event.target.value,
                  )
                }
              />
            </label>


            <label className="page-select alarm-filter">
              <span>
                Status
              </span>

              <select
                value={
                  statusFilter
                }
                onChange={(event) => {
                  const value =
                    event.target.value

                  const nextStatus:
                  | 'Semua'
                  | AlarmStatus =
                    value === 'Aktif'
                      ? 'Aktif'
                      : value === 'Diakui'
                        ? 'Diakui'
                        : value === 'Selesai'
                          ? 'Selesai'
                          : 'Semua'

                  setStatusFilter(
                    nextStatus,
                  )
                }}
              >
                <option>
                  Semua
                </option>

                <option>
                  Aktif
                </option>

                <option>
                  Diakui
                </option>

                <option>
                  Selesai
                </option>
              </select>
            </label>
          </div>
        </div>


        <div className="alarm-layout">
          <div
            className="alarm-list"
            aria-label="Daftar alarm"
          >
            <div className="alarm-list-heading">
              <strong>
                Daftar Alarm
              </strong>

              <span>
                {totalItems}
                {' '}
                data
              </span>
            </div>


            <div className="alarm-list-items">
              {
                visibleAlarms.length > 0
                  ? visibleAlarms.map(
                      (alarm) => (
                        <button
                          className={
                            `alarm-list-item ${
                              selectedId
                              === alarm.id
                                ? 'is-selected'
                                : ''
                            }`
                          }
                          type="button"
                          key={alarm.id}
                          aria-pressed={
                            selectedId
                            === alarm.id
                          }
                          onClick={() => {
                            setSelectedId(
                              alarm.id,
                            )
                            setActionNote('')
                            setActionError('')
                          }}
                        >
                          <span
                            className={
                              `alarm-severity-icon alarm-severity--${alarm.severity.toLowerCase()}`
                            }
                            aria-hidden="true"
                          >
                            <AlertTriangle
                              size={17}
                              strokeWidth={2}
                            />
                          </span>


                          <span className="alarm-item-copy">
                            <span className="alarm-item-top">
                              <strong>
                                {alarm.title}
                              </strong>

                              <span
                                className={
                                  `alarm-status alarm-status--${alarm.status.toLowerCase()}`
                                }
                              >
                                {
                                  alarm.status
                                }
                              </span>
                            </span>

                            <small>
                              {alarm.sensor}
                              {' · '}
                              {alarm.value}
                            </small>

                            <time>
                              {
                                alarm.lastSeenAt
                              }
                            </time>
                          </span>
                        </button>
                      ),
                    )

                  : (
                    <div className="alarm-empty">
                      <CheckCircle2
                        size={22}
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />

                      <strong>
                        Tidak ada alarm ditemukan
                      </strong>

                      <span>
                        Coba ubah kata pencarian
                        atau filter status.
                      </span>
                    </div>
                  )
              }
            </div>

            <nav
              className="data-pagination"
              aria-label="Pagination alarm"
            >
              <button
                className="data-pagination-step"
                type="button"
                disabled={currentPage <= 1}
                onClick={() =>
                  setCurrentPage(
                    (page) =>
                      Math.max(1, page - 1),
                  )
                }
              >
                Sebelumnya
              </button>

              <span className="alarm-page-indicator">
                Halaman {currentPage} dari {totalPages}
              </span>

              <button
                className="data-pagination-step"
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  setCurrentPage(
                    (page) =>
                      Math.min(totalPages, page + 1),
                  )
                }
              >
                Berikutnya
              </button>
            </nav>
          </div>


          {
            selectedAlarm && (
              <article
                className="alarm-detail"
                aria-live="polite"
              >
                <div className="alarm-detail-head">
                  <div className="alarm-detail-title">
                    <span
                      className={
                        `alarm-severity-icon alarm-severity--${selectedAlarm.severity.toLowerCase()}`
                      }
                      aria-hidden="true"
                    >
                      <BellRing
                        size={19}
                        strokeWidth={1.9}
                      />
                    </span>

                    <div>
                      <span>
                        {selectedAlarm.id}
                      </span>

                      <h3>
                        {
                          selectedAlarm.title
                        }
                      </h3>
                    </div>
                  </div>


                  <div className="alarm-detail-chips">
                    <span
                      className={
                        `alarm-severity-chip alarm-severity-chip--${selectedAlarm.severity.toLowerCase()}`
                      }
                    >
                      {
                        selectedAlarm.severity
                      }
                    </span>

                    <span
                      className={
                        `alarm-status alarm-status--${selectedAlarm.status.toLowerCase()}`
                      }
                    >
                      {
                        selectedAlarm.status
                      }
                    </span>
                  </div>
                </div>


                <p className="alarm-description">
                  {
                    selectedAlarm.description
                  }
                </p>


                <dl className="alarm-detail-grid">
                  <div>
                    <dt>
                      Sensor
                    </dt>

                    <dd>
                      {
                        selectedAlarm.sensor
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Nilai Terbaca
                    </dt>

                    <dd>
                      {
                        selectedAlarm.value
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Batas Alarm
                    </dt>

                    <dd>
                      {
                        selectedAlarm.threshold
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>
                      <MapPin
                        size={13}
                        strokeWidth={1.9}
                        aria-hidden="true"
                      />

                      {' '}
                      Lokasi
                    </dt>

                    <dd>
                      {
                        selectedAlarm.location
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Pertama Terdeteksi
                    </dt>

                    <dd>
                      {selectedAlarm.detectedAt}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Jumlah Pengamatan
                    </dt>

                    <dd>
                      {selectedAlarm.occurrenceCount} kali
                    </dd>
                  </div>
                </dl>


                <div className="alarm-recommendation">
                  <ShieldCheck
                    size={20}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />

                  <div>
                    <strong>
                      Rekomendasi Penanganan
                    </strong>

                    <p>
                      {
                        selectedAlarm.recommendation
                      }
                    </p>
                  </div>
                </div>


                <div className="alarm-activity">
                  <h4>
                    Aktivitas Alarm
                  </h4>

                  {
                    (selectedDetail?.events.length ?? 0) > 0
                      ? selectedDetail?.events.map(
                          (event) => (
                            <div key={event.id}>
                              {
                                event.eventType === 'resolved'
                                || event.eventType === 'recovered'
                                  ? (
                                      <CheckCircle2
                                        size={16}
                                        strokeWidth={1.8}
                                        aria-hidden="true"
                                      />
                                    )
                                  : event.eventType === 'acknowledged'
                                    ? (
                                        <ShieldCheck
                                          size={16}
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />
                                      )
                                    : (
                                        <Clock3
                                          size={16}
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />
                                      )
                              }

                              <span>
                                <strong>
                                  {alarmEventTitle(event)}
                                </strong>

                                <small>
                                  {formatAlarmTime(event.occurredAt)}
                                  {
                                    event.note
                                      ? ` · ${event.note}`
                                      : ''
                                  }
                                </small>
                              </span>
                            </div>
                          ),
                        )
                      : (
                          <div>
                            <Clock3
                              size={16}
                              strokeWidth={1.8}
                              aria-hidden="true"
                            />

                            <span>
                              <strong>
                                Alarm terdeteksi oleh sistem
                              </strong>

                              <small>
                                {selectedAlarm.detectedAt}
                              </small>
                            </span>
                          </div>
                        )
                  }
                </div>

                {
                  selectedAlarm.status !== 'Selesai'
                  && (
                    <label className="alarm-action-note">
                      <span>
                        Catatan tindakan (opsional)
                      </span>

                      <textarea
                        value={actionNote}
                        maxLength={500}
                        rows={2}
                        placeholder="Contoh: sensor sudah diperiksa di lokasi"
                        onChange={(event) =>
                          setActionNote(event.target.value)
                        }
                      />
                    </label>
                  )
                }

                {
                  actionError
                  && (
                    <p className="alarm-action-error">
                      {actionError}
                    </p>
                  )
                }



                <div className="alarm-detail-actions">
                  {
                    selectedAlarm.status
                    === 'Aktif'
                    && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isActing}
                        onClick={() =>
                          void updateStatus(
                            'Diakui',
                          )
                        }
                      >
                        {
                          isActing
                            ? 'Menyimpan...'
                            : 'Akui Alarm'
                        }
                      </button>
                    )
                  }


                  {
                    selectedAlarm.status
                    !== 'Selesai'
                      ? (
                          isAdmin
                            ? (
                              <button
                                className="primary-button"
                                type="button"
                                disabled={isActing}
                                onClick={() =>
                                  void updateStatus(
                                    'Selesai',
                                  )
                                }
                              >
                                {
                                  isActing
                                    ? 'Menyimpan...'
                                    : 'Tandai Selesai'
                                }
                              </button>
                            )

                            : (
                              <span className="alarm-resolved">
                                Penyelesaian alarm hanya
                                dapat dilakukan admin
                              </span>
                            )
                        )

                      : (
                        <span className="alarm-resolved">
                          <CheckCircle2
                            size={16}
                            strokeWidth={2}
                          />

                          {' '}
                          Alarm sudah selesai
                        </span>
                      )
                  }
                </div>
              </article>
            )
          }
        </div>
      </div>
    </section>
  )
}


function DevicesPage({
  data,
  connectionState,
  onRefresh,
}: ConnectedPageProps) {
  const [
    refreshLabel,
    setRefreshLabel,
  ] =
    useState(
      'Belum diperbarui',
    )


  const devices =
    (
      data?.devices ?? []
    ).map(
      (device) => ({
        id:
          device.deviceId,

        name:
          device.displayName,

        type:
          'Alat pemantauan utama',

        connectionStatus:
          device.connectionStatus,

        onlineLabel:
          device.connectionStatus
          === 'online'
            ? 'Online'
            : device.connectionStatus
              === 'stale'
              ? 'Stale'
              : 'Offline',

        lastSeen:
          device.recordedAt
            ? new Date(
                device.recordedAt,
              ).toLocaleString(
                'id-ID',
              )
            : 'Belum ada status event',

        firmware:
          device.firmwareVersion
          ?? '-',
      }),
    )


  const refreshDevices =
    () => {
      onRefresh()

      setRefreshLabel(
        `Diperbarui ${
          new Date()
            .toLocaleTimeString(
              'id-ID',
              {
                hour:
                  '2-digit',

                minute:
                  '2-digit',
              },
            )
        }`,
      )
    }


  const testDevice =
    (
      id: string,
    ) => {
      onRefresh()

      setRefreshLabel(
        ['Kondisi ', id, ' sedang diperbarui.'].join(''),
      )
    }


  return (
    <section
      className="secondary-page"
      aria-label="Status perangkat"
    >
      <div className="page-card device-page-header">
        <div>
          <h2>
            Perangkat Terhubung
          </h2>

          <p>
            {
              connectionState
              === 'connected'
                ? refreshLabel
                : 'Sistem belum tersambung'
            }
          </p>
        </div>


        <button
          className="primary-button"
          type="button"
          onClick={
            refreshDevices
          }
        >
          Refresh Status
        </button>
      </div>


      <div className="device-grid">
        {
          devices.map(
            (device) => (
              <article
                className="connected-device-card"
                key={device.id}
              >
                <div className="connected-device-top">
                  <span
                    className="device-symbol"
                    aria-hidden="true"
                  >
                    <Cpu
                      size={20}
                      strokeWidth={1.9}
                    />
                  </span>

                  <span
                    className={
                      device.connectionStatus
                      === 'online'
                        ? 'online-status'
                        : device.connectionStatus
                          === 'stale'
                          ? 'stale-status'
                          : 'offline-status'
                    }
                  >
                    {
                      device.onlineLabel
                    }
                  </span>
                </div>


                <h3>
                  {device.name}
                </h3>

                <p>
                  {device.type}
                </p>


                <dl>
                  <div>
                    <dt>
                      Terakhir aktif
                    </dt>

                    <dd>
                      {
                        device.lastSeen
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Firmware
                    </dt>

                    <dd>
                      {
                        device.firmware
                      }
                    </dd>
                  </div>
                </dl>


                <button
                  className="secondary-button full-button"
                  type="button"
                  onClick={() =>
                    testDevice(
                      device.id,
                    )
                  }
                >
                  Perbarui Status
                </button>
              </article>
            ),
          )
        }
      </div>
    </section>
  )
}


const blankSettings:
ApiSettings = {
  greenhouseName: '',

  temperatureMin:
    null,

  temperatureMax:
    null,

  humidityMin:
    null,

  humidityMax:
    null,

  notifications:
    true,

  sound:
    false,

  autoSchedule:
    true,
}


function SettingsPage({
  data,
  connectionState,
  onRefresh,
}: ConnectedPageProps) {
  const { user } =
    useAuth()

  const isAdmin =
    user.role === 'admin'


  const [
    settings,
    setSettings,
  ] =
    useState<ApiSettings>(
      blankSettings,
    )


  const [
    notice,
    setNotice,
  ] =
    useState('')


  useEffect(
    () => {
      if (
        data?.settings
      ) {
        setSettings(
          data.settings,
        )
      } else if (
        data?.site
      ) {
        setSettings(
          (current) => ({
            ...current,

            greenhouseName:
              data.site?.name
              ?? '',
          }),
        )
      }
    },
    [
      data,
    ],
  )


  const update =
    <
      K extends
      keyof ApiSettings,
    >(
      key: K,
      value: ApiSettings[K],
    ) => {
      if (!isAdmin) {
        return
      }

      setSettings(
        (current) => ({
          ...current,
          [key]: value,
        }),
      )

      setNotice('')
    }


  const save =
    async (
      event:
      React.FormEvent<
        HTMLFormElement
      >,
    ) => {
      event.preventDefault()


      if (!isAdmin) {
        setNotice(
          'Hanya admin yang dapat mengubah pengaturan.',
        )

        return
      }


      if (
        connectionState
        !== 'connected'
      ) {
        setNotice(
          'Sistem belum tersambung; pengaturan belum disimpan.',
        )

        return
      }


      try {
        const saved =
          await saveSettingsRequest(
            settings,
          )


        setSettings(
          saved,
        )


        setNotice(
          'Pengaturan berhasil disimpan.',
        )


        onRefresh()
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Pengaturan gagal disimpan.',
        )
      }
    }


  const resetFromDatabase =
    () => {
      if (!isAdmin) {
        return
      }


      setSettings(
        data?.settings
        ?? {
          ...blankSettings,

          greenhouseName:
            data?.site?.name
            ?? '',
        },
      )


      setNotice(
        'Perubahan dibatalkan; pengaturan dikembalikan ke nilai terakhir.',
      )
    }


  return (
    <section
      className="secondary-page"
      aria-label="Pengaturan sistem"
    >
      <form
        className="settings-form"
        onSubmit={save}
      >
        {
          !isAdmin && (
            <div className="page-card">
              <strong>
                Mode baca saja
              </strong>

              <p>
                Operator dapat melihat
                pengaturan, tetapi hanya
                admin yang dapat mengubahnya.
              </p>
            </div>
          )
        }


        <div className="page-card settings-section">
          <div className="page-card-header">
            <div>
              <h2>
                Profil Lokasi
              </h2>

              <p>
                Identitas dan preferensi
                utama sistem.
              </p>
            </div>
          </div>


          <label className="field-label">
            <span>
              Nama Lokasi
            </span>

            <input
              disabled={!isAdmin}
              value={
                settings.greenhouseName
              }
              onChange={(event) =>
                update(
                  'greenhouseName',
                  event.target.value,
                )
              }
            />
          </label>
        </div>


        <div className="page-card settings-section">
          <div className="setting-toggle-row">
            <div>
              <strong>
                Notifikasi Alarm
              </strong>

              <p>
                Preferensi notifikasi site.
              </p>
            </div>

            <button
              className={
                `switch ${
                  settings.notifications
                    ? 'is-on'
                    : ''
                }`
              }
              type="button"
              role="switch"
              aria-checked={
                settings.notifications
              }
              disabled={!isAdmin}
              onClick={() =>
                update(
                  'notifications',
                  !settings.notifications,
                )
              }
            >
              <span />
            </button>
          </div>


          <div className="setting-toggle-row">
            <div>
              <strong>
                Suara Alarm
              </strong>

              <p>
                Preferensi suara dashboard.
              </p>
            </div>

            <button
              className={
                `switch ${
                  settings.sound
                    ? 'is-on'
                    : ''
                }`
              }
              type="button"
              role="switch"
              aria-checked={
                settings.sound
              }
              disabled={!isAdmin}
              onClick={() =>
                update(
                  'sound',
                  !settings.sound,
                )
              }
            >
              <span />
            </button>
          </div>


          <div className="setting-toggle-row">
            <div>
              <strong>
                Jadwal Otomatis
              </strong>

              <p>
                Aktifkan eksekusi
                jadwal lokal.
              </p>
            </div>

            <button
              className={
                `switch ${
                  settings.autoSchedule
                    ? 'is-on'
                    : ''
                }`
              }
              type="button"
              role="switch"
              aria-checked={
                settings.autoSchedule
              }
              disabled={!isAdmin}
              onClick={() =>
                update(
                  'autoSchedule',
                  !settings.autoSchedule,
                )
              }
            >
              <span />
            </button>
          </div>
        </div>


        <div className="settings-actions">
          {
            notice && (
              <p role="status">
                {notice}
              </p>
            )
          }

          <button
            className="secondary-button"
            type="button"
            onClick={
              resetFromDatabase
            }
            disabled={!isAdmin}
          >
            Batalkan Perubahan
          </button>

          <button
            className="primary-button"
            type="submit"
            disabled={
              !isAdmin
              || connectionState
                !== 'connected'
            }
          >
            Simpan Pengaturan
          </button>
        </div>
      </form>
    </section>
  )
}


type SecondaryPageProps =
  ConnectedPageProps & {
    page:
      Exclude<
        PageKey,
        'dashboard'
      >
  }


export function SecondaryPage({
  page,
  data,
  connectionState,
  onRefresh,
}: SecondaryPageProps) {
  const connectedProps = {
    data,
    connectionState,
    onRefresh,
  }


  if (
    page === 'plants'
  ) {
    return (
      <PlantStatusPage
        {...connectedProps}
      />
    )
  }

  if (
    page === 'smart-soil'
  ) {
    return (
      <SmartSoilPage
        connectionState={connectionState}
        onRefresh={onRefresh}
      />
    )
  }


  if (
    page === 'controls'
  ) {
    return (
      <ControlsPage
        {...connectedProps}
      />
    )
  }


  if (
    page === 'logs'
  ) {
    return (
      <LogsPage
        {...connectedProps}
      />
    )
  }


  if (
    page === 'alarms'
  ) {
    return (
      <AlarmPage
        {...connectedProps}
      />
    )
  }


  if (
    page === 'devices'
  ) {
    return (
      <DevicesPage
        {...connectedProps}
      />
    )
  }
if (
  page === 'users'
) {
  return (
    <UserManagementPage />
  )
}

  return (
    <SettingsPage
      {...connectedProps}
    />
  )
}
