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
  resolveAlarm as resolveAlarmRequest,
  saveSettings as saveSettingsRequest,
  setScheduleEnabled as setScheduleEnabledRequest,
  updateActuator,
} from './api'

import type {
  ApiAlarm,
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
  formatTelemetryAge,
  getTelemetryFreshness,
} from './telemetryStatus'

import {
  UserManagementPage,
} from './UserManagementPage'

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
                ? 'Telemetry Tersedia'
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
                ? 'Nilai zona berasal dari telemetry sensor tanah terbaru; tidak ada skor kesehatan sintetis.'
                : 'Belum ada telemetry tanah tersimpan pada database SPFF.',
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
            Schema database SPFF
          </small>
        </article>


        <article className="summary-card">
          <span>
            Telemetry
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
                ? 'Belum ada telemetry tersimpan'
                : `Telemetry ${telemetryAgeLabel ?? '-'}`
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
                ? 'ESP32 melaporkan sensor tidak valid'
                : 'Berdasarkan PostgreSQL'
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
                Telemetry Tersedia
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
                          : 'Menunggu telemetry'
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


      const eligible =
        controls.filter(
          (control) =>
            !control.pending,
        )


      if (
        eligible.length === 0
      ) {
        setCommandNotice(
          'Semua aktuator masih menunggu penyelesaian command sebelumnya.',
        )

        return
      }


      setCommandNotice(
        'Menyimpan command ke PostgreSQL...',
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
          'Command tersimpan. State UI tidak berubah sampai ACK aktual diterima dari ESP32.',
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


      setCommandNotice(
        `Menyimpan command ${target.name}...`,
      )


      try {
        await updateActuator(
          id,
          !target.isActive,
        )


        setCommandNotice(
          `${target.name}: command pending. Menunggu ACK actual state dari ESP32.`,
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


      const actuator =
        controls.find(
          (control) =>
            control.id ===
            scheduleDraft.controlId,
        )


      if (!actuator) {
        setCommandNotice(
          'Pilih aktuator yang terdaftar di PostgreSQL.',
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
          'Jadwal tersimpan di PostgreSQL dan akan dieksekusi oleh MQTT Worker lokal.',
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


      try {
        await setScheduleEnabledRequest(
          id,
          !enabled,
        )


        setCommandNotice(
          'Status jadwal tersimpan di PostgreSQL.',
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
          'Jadwal dihapus dari PostgreSQL.',
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
              mode === 'automatic'
                ? 'ESP32 melaporkan mode otomatis.'
                : mode === 'manual'
                  ? 'ESP32 melaporkan mode manual.'
                  : 'Belum ada mode aktual dari ESP32.'
            }
          </p>
        </div>


        <div
          className="segmented-control"
          aria-label="Mode operasi aktual dari perangkat"
        >
          <button
            className={
              mode === 'automatic'
                ? 'is-selected'
                : ''
            }
            type="button"
            disabled
          >
            Otomatis
          </button>

          <button
            className={
              mode === 'manual'
                ? 'is-selected'
                : ''
            }
            type="button"
            disabled
          >
            Manual
          </button>
        </div>


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
            }
          >
            Aktifkan Semua
          </button>
        </div>
      </div>


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
                        {control.deviceId}
                        {' · '}
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
                            ? `Menunggu ACK ${
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
                      }
                    >
                      <span />
                    </button>
                  </article>
                ),
              )

            : (
              <div className="schedule-empty">
                Belum ada aktuator aktif
                yang terdaftar di PostgreSQL.
              </div>
            )
        }
      </div>


      <div className="actuator-schedule-card page-card">
        <div className="schedule-card-header">
          <div>
            <h2>
              Penjadwalan Aktuator
            </h2>

            <p>
              {
                isAdmin
                  ? 'Jadwal disimpan lokal di PostgreSQL dan dieksekusi MQTT Worker.'
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
                Source of truth: PostgreSQL
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
                          disabled={!isAdmin}
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
                ? `${activeCount} dari ${controls.length} aktuator aktif berdasarkan actual state terakhir.`
                : 'Backend SPFF belum terhubung.'
            )
          }
        </p>
      </div>
    </section>
  )
}


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


  const [
    range,
    setRange,
  ] =
    useState(
      'Hari Ini',
    )


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
      data?.telemetryLog ?? []
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

        row.sensorKey,

        row.recordedAt,
      ],
    )


  const actuatorRows =
    (
      data?.actuatorLog ?? []
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
          row.state
        ]


        const sourceLabel = {
          telemetry:
            'Telemetry ESP',
          command_ack:
            'Konfirmasi perintah',
          manual:
            'Manual',
          system:
            'Sistem ESP',
        }[
          row.source
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
              + row.reason
            : sourceLabel,

          row.actuatorKey,

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


  const rangeDays = {
    'Hari Ini':
      1,
    '7 Hari':
      7,
    '30 Hari':
      30,
  }[
    range
  ] ?? 1


  const rangeStart =
    new Date()


  rangeStart.setHours(
    0,
    0,
    0,
    0,
  )


  rangeStart.setDate(
    rangeStart.getDate()
    - (
      rangeDays
      - 1
    ),
  )


  const rows =
    databaseRows.filter(
      (row) =>
        (
          selectedParameter
          === 'all'
          || row[4]
          === selectedParameter
        )
        && Date.parse(
          row[5],
        )
        >= rangeStart.getTime(),
    )


  const rowsPerPage =
    10


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        rows.length
        / rowsPerPage,
      ),
    )


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
    rows.slice(
      pageStart,
      pageStart
      + rowsPerPage,
    )


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
        `fertigasi-datalog-${
          range
            .toLowerCase()
            .replaceAll(
              ' ',
              '-',
            )
        }.csv`


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

      setRange(
        'Hari Ini',
      )

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
              untuk periode{' '}
              {range.toLowerCase()}.
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


            <label className="page-select compact-select">
              <span>
                Periode
              </span>

              <select
                value={range}
                onChange={(event) => {
                  setRange(
                    event.target.value,
                  )

                  setCurrentPage(
                    1,
                  )
                }}
              >
                <option>
                  Hari Ini
                </option>

                <option>
                  7 Hari
                </option>

                <option>
                  30 Hari
                </option>
              </select>
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
            >
              Ekspor CSV
            </button>
          </div>
        </div>


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
                          + rows.length
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
                : 'Backend SPFF belum terhubung.'
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
  location: string
  description: string
  recommendation: string
}


const alarmMetadata = (
  alarm: ApiAlarm,
  key: string,
  fallback: string,
) => {
  const value =
    alarm.metadata?.[key]

  return (
    typeof value === 'string'
    || typeof value === 'number'
  )
    ? String(value)
    : fallback
}


const apiAlarmToRecord = (
  alarm: ApiAlarm,
): AlarmRecord => ({
  id:
    alarm.id,

  title:
    alarm.title,

  sensor:
    alarm.sourceKey,

  value:
    alarmMetadata(
      alarm,
      'value',
      '-',
    ),

  threshold:
    alarmMetadata(
      alarm,
      'threshold',
      '-',
    ),

  severity:
    alarm.severity
    === 'critical'
      ? 'Kritis'
      : alarm.severity
        === 'warning'
        ? 'Peringatan'
        : 'Informasi',

  status:
    alarm.status
    === 'resolved'
      ? 'Selesai'
      : alarm.status
        === 'acknowledged'
        ? 'Diakui'
        : 'Aktif',

  detectedAt:
    new Date(
      alarm.triggeredAt,
    ).toLocaleString(
      'id-ID',
    ),

  location:
    alarmMetadata(
      alarm,
      'location',
      alarm.deviceId,
    ),

  description:
    alarm.description,

  recommendation:
    alarmMetadata(
      alarm,
      'recommendation',
      'Periksa sumber alarm dan data sensor terkait.',
    ),
})


function AlarmPage({
  data,
  onRefresh,
}: ConnectedPageProps) {
  const { user } =
    useAuth()

  const isAdmin =
    user.role === 'admin'


  const [
    alarms,
    setAlarms,
  ] =
    useState<
      AlarmRecord[]
    >([])


  const [
    selectedId,
    setSelectedId,
  ] =
    useState('')


  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<
      | 'Semua'
      | AlarmStatus
    >('Semua')


  const [
    query,
    setQuery,
  ] =
    useState('')


  useEffect(
    () => {
      const nextAlarms =
        data
          ? data.alarms.map(
              apiAlarmToRecord,
            )
          : []


      setAlarms(
        nextAlarms,
      )


      setSelectedId(
        (current) =>
          nextAlarms.some(
            (alarm) =>
              alarm.id === current,
          )
            ? current
            : (
                nextAlarms[0]
                  ?.id ?? ''
              ),
      )
    },
    [
      data,
    ],
  )


  const visibleAlarms =
    alarms.filter(
      (alarm) => {
        const matchesStatus =
          statusFilter === 'Semua'
          || alarm.status
            === statusFilter


        const search =
          query
            .trim()
            .toLowerCase()


        const matchesSearch =
          !search
          || alarm.title
            .toLowerCase()
            .includes(search)
          || alarm.sensor
            .toLowerCase()
            .includes(search)
          || alarm.id
            .toLowerCase()
            .includes(search)


        return (
          matchesStatus
          && matchesSearch
        )
      },
    )


  const selectedAlarm =
    alarms.find(
      (alarm) =>
        alarm.id
        === selectedId,
    )


  const activeCount =
    alarms.filter(
      (alarm) =>
        alarm.status
        !== 'Selesai',
    ).length


  const criticalCount =
    alarms.filter(
      (alarm) =>
        alarm.status
        !== 'Selesai'
        && alarm.severity
          === 'Kritis',
    ).length


  const acknowledgedCount =
    alarms.filter(
      (alarm) =>
        alarm.status
        === 'Diakui',
    ).length


  const resolvedCount =
    alarms.filter(
      (alarm) =>
        alarm.status
        === 'Selesai',
    ).length


  const updateStatus =
    async (
      status:
      AlarmStatus,
    ) => {
      if (!selectedId) {
        return
      }


      try {
        if (
          status === 'Diakui'
        ) {
          await acknowledgeAlarmRequest(
            selectedId,
          )
        } else if (
          status === 'Selesai'
        ) {
          if (!isAdmin) {
            return
          }

          await resolveAlarmRequest(
            selectedId,
          )
        }


        setAlarms(
          (current) =>
            current.map(
              (alarm) =>
                alarm.id
                === selectedId
                  ? {
                      ...alarm,
                      status,
                    }
                  : alarm,
            ),
        )


        onRefresh()
      } catch {
        return
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
                {visibleAlarms.length}
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
                          onClick={() =>
                            setSelectedId(
                              alarm.id,
                            )
                          }
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
                                alarm.detectedAt
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
                        {
                          selectedAlarm.detectedAt
                        }
                      </small>
                    </span>
                  </div>


                  {
                    selectedAlarm.status
                    !== 'Aktif'
                    && (
                      <div>
                        <ShieldCheck
                          size={16}
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />

                        <span>
                          <strong>
                            Alarm diakui oleh operator
                          </strong>

                          <small>
                            Operator fertigasi
                          </small>
                        </span>
                      </div>
                    )
                  }


                  {
                    selectedAlarm.status
                    === 'Selesai'
                    && (
                      <div>
                        <CheckCircle2
                          size={16}
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />

                        <span>
                          <strong>
                            Kondisi kembali normal
                          </strong>

                          <small>
                            Alarm ditandai selesai
                          </small>
                        </span>
                      </div>
                    )
                  }
                </div>


                <div className="alarm-detail-actions">
                  {
                    selectedAlarm.status
                    === 'Aktif'
                    && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          void updateStatus(
                            'Diakui',
                          )
                        }
                      >
                        Akui Alarm
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
                                onClick={() =>
                                  void updateStatus(
                                    'Selesai',
                                  )
                                }
                              >
                                Tandai Selesai
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
          `${
            device.hardwareModel
            ?? 'Controller'
          } - ${device.deviceId}`,

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

        signal:
          device.sensorValid
          === true
            ? 'Sensor valid'
            : device.sensorValid
              === false
              ? 'Sensor bermasalah'
              : 'Menunggu status',

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
        `Status ${id} diminta ulang dari backend SPFF.`,
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
                : 'Backend SPFF belum terhubung'
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
                      Sinyal
                    </dt>

                    <dd>
                      {device.signal}
                    </dd>
                  </div>

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


  const numericValue =
    (
      value: string,
    ) =>
      value.trim() === ''
        ? null
        : Number(value)


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
          'Backend SPFF belum terhubung; pengaturan tidak disimpan.',
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
          'Pengaturan tersimpan di PostgreSQL lokal.',
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
        'Perubahan lokal dibatalkan; nilai dikembalikan dari data terakhir PostgreSQL.',
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
          <div className="page-card-header">
            <div>
              <h2>
                Ambang Sensor
              </h2>

              <p>
                Nilai disimpan lokal
                sebagai konfigurasi site.
              </p>
            </div>
          </div>


          <div className="field-grid">
            <label className="field-label">
              <span>
                Suhu Minimum (°C)
              </span>

              <input
                disabled={!isAdmin}
                type="number"
                value={
                  settings.temperatureMin
                  ?? ''
                }
                onChange={(event) =>
                  update(
                    'temperatureMin',
                    numericValue(
                      event.target.value,
                    ),
                  )
                }
              />
            </label>


            <label className="field-label">
              <span>
                Suhu Maksimum (°C)
              </span>

              <input
                disabled={!isAdmin}
                type="number"
                value={
                  settings.temperatureMax
                  ?? ''
                }
                onChange={(event) =>
                  update(
                    'temperatureMax',
                    numericValue(
                      event.target.value,
                    ),
                  )
                }
              />
            </label>


            <label className="field-label">
              <span>
                Kelembapan Minimum (%)
              </span>

              <input
                disabled={!isAdmin}
                type="number"
                value={
                  settings.humidityMin
                  ?? ''
                }
                onChange={(event) =>
                  update(
                    'humidityMin',
                    numericValue(
                      event.target.value,
                    ),
                  )
                }
              />
            </label>


            <label className="field-label">
              <span>
                Kelembapan Maksimum (%)
              </span>

              <input
                disabled={!isAdmin}
                type="number"
                value={
                  settings.humidityMax
                  ?? ''
                }
                onChange={(event) =>
                  update(
                    'humidityMax',
                    numericValue(
                      event.target.value,
                    ),
                  )
                }
              />
            </label>
          </div>
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
            Simpan ke PostgreSQL
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
