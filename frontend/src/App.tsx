import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BatteryMedium,
  Bell,
  BellRing,
  CalendarDays,
  ChartNoAxesCombined,
  Cpu,
  Droplets,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Leaf,
  LogOut,
  MapPin,
  Ruler,
  Settings,
  SlidersHorizontal,
  Sprout,
  Thermometer,
  UserRound,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react'

import {
  SecondaryPage,
} from './SecondaryPages'

import {
  pageDescriptions,
  pageTitles,
  type PageKey,
} from './pageConfig'

import {
  formatTelemetryAge,
  getTelemetryFreshness,
  type TelemetryFreshness,
} from './telemetryStatus'

import {
  fetchBootstrap,
  fetchLatestTelemetry,
  fetchSensorHistory,
} from './api'

import type {
  ApiHistorySeries,
  BootstrapData,
  ConnectionState,
} from './api'

import {
  useAuth,
} from './authContext'

import './App.css'


type SensorKey = string


type SensorData = {
  key: SensorKey
  label: string
  value: number | null
  unit: string
  glyph: string
  color: string
  softColor: string
  history: number[]
  ideal: string
  telemetryFreshness: TelemetryFreshness
}


type SensorDefinition =
  Omit<
    SensorData,
    'history' | 'telemetryFreshness' | 'value'
  >


const sensorDefinitions:
SensorDefinition[] = [
  {
    key: 'soil_1_moisture',
    label: 'Kelembapan Tanah 1',
    unit: '%',
    glyph: 'M1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_1_temp',
    label: 'Suhu Tanah 1',
    unit: '°C',
    glyph: 'T1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_1_ec_us_cm',
    label: 'EC Tanah 1',
    unit: 'µS/cm',
    glyph: 'E1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_1_ph',
    label: 'pH Tanah 1',
    unit: 'pH',
    glyph: 'pH1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_1_n',
    label: 'Nitrogen Tanah 1',
    unit: 'mg/kg',
    glyph: 'N1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_1_p',
    label: 'Fosfor Tanah 1',
    unit: 'mg/kg',
    glyph: 'P1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_1_k',
    label: 'Kalium Tanah 1',
    unit: 'mg/kg',
    glyph: 'K1',
    color: '#299b70',
    softColor: '#e6f5ef',
    ideal: 'Soil Sensor 1',
  },
  {
    key: 'soil_2_moisture',
    label: 'Kelembapan Tanah 2',
    unit: '%',
    glyph: 'M2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'soil_2_temp',
    label: 'Suhu Tanah 2',
    unit: '°C',
    glyph: 'T2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'soil_2_ec_us_cm',
    label: 'EC Tanah 2',
    unit: 'µS/cm',
    glyph: 'E2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'soil_2_ph',
    label: 'pH Tanah 2',
    unit: 'pH',
    glyph: 'pH2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'soil_2_n',
    label: 'Nitrogen Tanah 2',
    unit: 'mg/kg',
    glyph: 'N2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'soil_2_p',
    label: 'Fosfor Tanah 2',
    unit: 'mg/kg',
    glyph: 'P2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'soil_2_k',
    label: 'Kalium Tanah 2',
    unit: 'mg/kg',
    glyph: 'K2',
    color: '#708f3d',
    softColor: '#f0f4e7',
    ideal: 'Soil Sensor 2',
  },
  {
    key: 'liquid_ph',
    label: 'pH Larutan',
    unit: 'pH',
    glyph: 'pHL',
    color: '#2e918d',
    softColor: '#e6f4f2',
    ideal: 'Nutrisense',
  },
  {
    key: 'liquid_ec_us_cm',
    label: 'EC Larutan',
    unit: 'µS/cm',
    glyph: 'ECL',
    color: '#2e918d',
    softColor: '#e6f4f2',
    ideal: 'Nutrisense',
  },
  {
    key: 'liquid_temp',
    label: 'Suhu Larutan',
    unit: '°C',
    glyph: 'TL',
    color: '#2e918d',
    softColor: '#e6f4f2',
    ideal: 'Nutrisense',
  },
  {
    key: 'air_temp',
    label: 'Suhu Udara',
    unit: '°C',
    glyph: 'TU',
    color: '#3c8ca3',
    softColor: '#e5f2f5',
    ideal: 'SHT20',
  },
  {
    key: 'air_humidity',
    label: 'Kelembapan Udara',
    unit: '%RH',
    glyph: 'RH',
    color: '#3c8ca3',
    softColor: '#e5f2f5',
    ideal: 'SHT20',
  },
  {
    key: 'tank_water_distance_cm',
    label: 'Jarak Tandon Air',
    unit: 'cm',
    glyph: 'JA',
    color: '#259bb7',
    softColor: '#e5f5f8',
    ideal: 'Tandon air',
  },
  {
    key: 'tank_water_level_pct',
    label: 'Level Tandon Air',
    unit: '%',
    glyph: 'LA',
    color: '#259bb7',
    softColor: '#e5f5f8',
    ideal: 'Tandon air',
  },
  {
    key: 'tank_fert_distance_cm',
    label: 'Jarak Tandon Pupuk',
    unit: 'cm',
    glyph: 'JP',
    color: '#8a963d',
    softColor: '#f2f4e6',
    ideal: 'Tandon pupuk',
  },
  {
    key: 'tank_fert_level_pct',
    label: 'Level Tandon Pupuk',
    unit: '%',
    glyph: 'LP',
    color: '#8a963d',
    softColor: '#f2f4e6',
    ideal: 'Tandon pupuk',
  },
  {
    key: 'flow_water_lpm',
    label: 'Debit Air',
    unit: 'L/min',
    glyph: 'FA',
    color: '#357fa9',
    softColor: '#e7f1f7',
    ideal: 'Flow air',
  },
  {
    key: 'flow_water_total_l',
    label: 'Total Aliran Air',
    unit: 'Liter',
    glyph: 'TA',
    color: '#357fa9',
    softColor: '#e7f1f7',
    ideal: 'Flow air',
  },
  {
    key: 'flow_fert_lpm',
    label: 'Debit Pupuk',
    unit: 'L/min',
    glyph: 'FP',
    color: '#7b9140',
    softColor: '#eef3e5',
    ideal: 'Flow pupuk',
  },
  {
    key: 'flow_fert_total_l',
    label: 'Total Aliran Pupuk',
    unit: 'Liter',
    glyph: 'TP',
    color: '#7b9140',
    softColor: '#eef3e5',
    ideal: 'Flow pupuk',
  },
  {
    key: 'battery_voltage',
    label: 'Tegangan Baterai',
    unit: 'Volt',
    glyph: 'V',
    color: '#b07c26',
    softColor: '#faf1df',
    ideal: 'Daya',
  },
]


const sensorData:
SensorData[] =
  sensorDefinitions.map(
    (sensor) => ({
      key: sensor.key,
      label: sensor.label,
      value: null,
      unit: sensor.unit,
      glyph: sensor.glyph,
      color: sensor.color,
      softColor: sensor.softColor,
      history: [],
      ideal: sensor.ideal,
      telemetryFreshness: 'waiting',
    }),
  )


const dashboardSensorKeys:
SensorKey[] = [
  'soil_1_moisture',
  'soil_1_ec_us_cm',
  'soil_2_moisture',
  'soil_2_ec_us_cm',
  'liquid_ph',
  'liquid_ec_us_cm',
  'tank_water_level_pct',
  'tank_fert_level_pct',
]


const heroSensorKeys:
SensorKey[] = [
  'air_temp',
  'air_humidity',
]


const navItems:
Array<{
  key: PageKey
  icon: LucideIcon
  label: string
}> = [
  {
    key: 'dashboard',
    icon: LayoutDashboard,
    label: 'Dashboard',
  },
  {
    key: 'plants',
    icon: Sprout,
    label: 'Status Tanaman',
  },
  {
    key: 'smart-soil',
    icon: Droplets,
    label: 'Smart Soil',
  },
  {
    key: 'controls',
    icon: SlidersHorizontal,
    label: 'Kontrol Perangkat',
  },
  {
    key: 'logs',
    icon: ChartNoAxesCombined,
    label: 'Datalog',
  },
  {
    key: 'alarms',
    icon: BellRing,
    label: 'Detail Alarm',
  },
  {
    key: 'devices',
    icon: Cpu,
    label: 'Status Perangkat',
  },
  {
    key: 'settings',
    icon: Settings,
    label: 'Pengaturan',
  },
  {
    key: 'users',
    icon: Users,
    label: 'Manajemen User',
  },
]


const pageKeys =
  navItems.map(
    (item) =>
      item.key,
  )


function pageFromHash():
PageKey {
  const page =
    window.location.hash
      .replace(/^#\/*/, '')
      .replace(/\/$/, '') as PageKey


  return pageKeys.includes(page)
    ? page
    : 'dashboard'
}


function NavigationIcon({
  icon: Icon,
}: {
  icon: LucideIcon
}) {
  return (
    <Icon
      size={18}
      strokeWidth={1.9}
    />
  )
}


function SensorIcon({
  sensorKey,
  size = 18,
}: {
  sensorKey: SensorKey
  size?: number
}) {
  let Icon:
  LucideIcon =
    Gauge


  if (
    sensorKey.includes('moisture')
    || sensorKey.includes('humidity')
  ) {
    Icon =
      Droplets
  } else if (
    sensorKey.includes('_temp')
  ) {
    Icon =
      Thermometer
  } else if (
    sensorKey.includes('_ec_')
  ) {
    Icon =
      Activity
  } else if (
    sensorKey.includes('_ph')
    || sensorKey === 'liquid_ph'
  ) {
    Icon =
      FlaskConical
  } else if (
    /_(n|p|k)$/.test(sensorKey)
  ) {
    Icon =
      Sprout
  } else if (
    sensorKey.includes('distance')
  ) {
    Icon =
      Ruler
  } else if (
    sensorKey.includes('level')
  ) {
    Icon =
      Waves
  } else if (
    sensorKey === 'battery_voltage'
  ) {
    Icon =
      BatteryMedium
  }


  return (
    <Icon
      size={size}
      strokeWidth={1.9}
    />
  )
}


function formatSensorValue(
  value: number | null,
) {
  if (
    value === null
  ) {
    return '--'
  }


  return new Intl.NumberFormat(
    'id-ID',
    {
      maximumFractionDigits: 2,
    },
  ).format(value)
}


function formatScheduleDate(
  date: Date,
) {
  return new Intl.DateTimeFormat(
    'id-ID',
    {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    },
  ).format(date)
}


function formatHistoryTimestamp(
  value: string,
) {
  return new Intl.DateTimeFormat(
    'id-ID',
    {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    },
  ).format(
    new Date(value),
  )
}


const historyHourOptions =
  Array.from(
    {
      length: 24,
    },
    (
      _,
      hour,
    ) =>
      `${String(hour).padStart(2, '0')}:00`,
  )


function App() {
  const {
    user,
    logout,
  } =
    useAuth()


  const [
    activePage,
    setActivePage,
  ] =
    useState<PageKey>(
      pageFromHash,
    )


  const [
    navOpen,
    setNavOpen,
  ] =
    useState(false)


  const [
    selectedSensor,
    setSelectedSensor,
  ] =
    useState<SensorKey>(
      'soil_1_moisture',
    )


  const [
    chartDate,
    setChartDate,
  ] =
    useState('')


  const [
    chartHour,
    setChartHour,
  ] =
    useState('')


  const [
    notificationsOpen,
    setNotificationsOpen,
  ] =
    useState(false)


  const [
    notificationsRead,
    setNotificationsRead,
  ] =
    useState(false)


  const [
    clock,
    setClock,
  ] =
    useState(
      () => new Date(),
    )


  const [
    backendData,
    setBackendData,
  ] =
    useState<
      BootstrapData | null
    >(null)


  const [
    connectionState,
    setConnectionState,
  ] =
    useState<ConnectionState>(
      'loading',
    )


  const [
    refreshVersion,
    setRefreshVersion,
  ] =
    useState(0)


  const [
    historyBySensor,
    setHistoryBySensor,
  ] =
    useState<
      Record<
        string,
        ApiHistorySeries
      >
    >({})


  const visibleNavItems =
    useMemo(
      () =>
        navItems.filter(
          (item) =>
            item.key !== 'users'
            || user.role === 'admin',
        ),
      [
        user.role,
      ],
    )


  useEffect(
    () => {
      const handleLocationChange =
        () =>
          setActivePage(
            pageFromHash(),
          )


      window.addEventListener(
        'hashchange',
        handleLocationChange,
      )


      window.addEventListener(
        'popstate',
        handleLocationChange,
      )


      return () => {
        window.removeEventListener(
          'hashchange',
          handleLocationChange,
        )


        window.removeEventListener(
          'popstate',
          handleLocationChange,
        )
      }
    },
    [],
  )


  useEffect(
    () => {
      const timer =
        window.setInterval(
          () =>
            setClock(
              new Date(),
            ),
          30_000,
        )


      return () =>
        window.clearInterval(
          timer,
        )
    },
    [],
  )


  useEffect(
    () => {
      let active =
        true


      const controller =
        new AbortController()


      const load =
        async () => {
          try {
            const data =
              await fetchBootstrap(
                controller.signal,
              )


            if (!active) {
              return
            }


            setBackendData(
              data,
            )


            setConnectionState(
              'connected',
            )
          } catch (error) {
            if (
              !active
              || (
                error instanceof DOMException
                && error.name === 'AbortError'
              )
            ) {
              return
            }


            setConnectionState(
              'unavailable',
            )
          }
        }


      void load()


      return () => {
        active =
          false


        controller.abort()
      }
    },
    [
      refreshVersion,
    ],
  )


  useEffect(
    () => {
      if (
        connectionState !== 'connected'
      ) {
        return
      }


      let active =
        true


      let loading =
        false


      let queued =
        false


      const controller =
        new AbortController()


      const loadLatest =
        async () => {
          if (loading) {
            queued =
              true


            return
          }


          loading =
            true


          do {
            queued =
              false


            try {
              const snapshot =
                await fetchLatestTelemetry(
                  controller.signal,
                )


              if (!active) {
                return
              }


              setBackendData(
                (current) =>
                  current
                    ? {
                        ...current,

                        sensors:
                          snapshot.sensors,

                        latestTelemetry:
                          snapshot.latestTelemetry,

                        devices:
                          snapshot.devices,

                        telemetryLog:
                          snapshot.telemetryLog,

                        actuators:
                          snapshot.actuators,

                        actuatorLog:
                          snapshot.actuatorLog,
                      }
                    : current,
              )
            } catch (error) {
              if (
                !active
                || (
                  error instanceof DOMException
                  && error.name === 'AbortError'
                )
              ) {
                return
              }


              console.error(
                'Latest telemetry refresh failed.',
                error,
              )
            }
          } while (
            active
            && queued
          )


          loading =
            false
        }


      const events =
        new EventSource(
          '/api/events',
        )


      const refreshLatest =
        () => {
          void loadLatest()
        }


      events.addEventListener(
        'telemetry.updated',
        refreshLatest,
      )


      events.addEventListener(
        'device_status.updated',
        refreshLatest,
      )


      events.addEventListener(
        'actuator_state.updated',
        refreshLatest,
      )

      events.addEventListener(
        'automatic_control.updated',
        () => setRefreshVersion(
          (version) => version + 1,
        ),
      )


      events.addEventListener(
        'open',
        refreshLatest,
      )


      return () => {
        active =
          false


        controller.abort()


        events.close()
      }
    },
    [
      connectionState,
    ],
  )


  useEffect(
    () => {
      if (
        connectionState !== 'connected'
      ) {
        return
      }


      const controller =
        new AbortController()


      const filteredTo =
        chartDate
        && chartHour
          ? new Date(
              `${chartDate}T${chartHour}:00+07:00`,
            )
          : undefined


      void fetchSensorHistory(
        selectedSensor,
        controller.signal,
        {
          to:
            filteredTo,

          hours: 6,

          bucket:
            '5m',
        },
      )
        .then(
          (series) => {
            setHistoryBySensor(
              (current) => ({
                ...current,

                [selectedSensor]:
                  series,
              }),
            )
          },
        )
        .catch(
          (error) => {
            if (
              error instanceof DOMException
              && error.name === 'AbortError'
            ) {
              return
            }


            setHistoryBySensor(
              (current) => {
                const next = {
                  ...current,
                }


                delete next[
                  selectedSensor
                ]


                return next
              },
            )
          },
        )


      return () =>
        controller.abort()
    },
    [
      selectedSensor,
      connectionState,
      chartDate,
      chartHour,
      backendData
        ?.latestTelemetry
        ?.recordedAt,
    ],
  )


  const navigateTo =
    (
      page: PageKey,
    ) => {
      if (
        page === 'users'
        && user.role !== 'admin'
      ) {
        return
      }


      const nextHash =
        `#/${page}`


      if (
        window.location.hash
        !== nextHash
      ) {
        window.history.pushState(
          {
            page,
          },
          '',
          nextHash,
        )
      }


      setActivePage(
        page,
      )


      setNavOpen(
        false,
      )


      setNotificationsOpen(
        false,
      )


      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }


  const latestTelemetry =
    backendData?.latestTelemetry
    ?? null


  const hasTelemetry =
    latestTelemetry !== null


  const telemetryFreshness =
    getTelemetryFreshness(
      latestTelemetry?.recordedAt,
      hasTelemetry,
      clock.getTime(),
    )


  const telemetryAgeLabel =
    formatTelemetryAge(
      latestTelemetry?.recordedAt,
      clock.getTime(),
    )


  const mergedSensorData =
    useMemo(
      () => {
        const apiSensors =
          new Map(
            (
              backendData?.sensors
              ?? []
            ).map(
              (sensor) => [
                sensor.id,
                sensor,
              ],
            ),
          )


        return sensorData.map(
          (sensor) => {
            const source =
              apiSensors.get(
                sensor.key,
              )


            return {
              ...sensor,

              label:
                source?.name
                ?? sensor.label,

              unit:
                source?.unit
                ?? sensor.unit,

              ideal:
                source?.groupName
                ?? sensor.ideal,

              value:
                source?.value
                ?? null,

              telemetryFreshness:
                source?.value === null
                || source?.value === undefined
                  ? 'waiting'
                  : telemetryFreshness,

              history:
                (
                  historyBySensor[
                    sensor.key
                  ]
                    ?.points
                  ?? []
                ).map(
                  (point) =>
                    point.value,
                ),
            }
          },
        )
      },
      [
        backendData,
        historyBySensor,
        telemetryFreshness,
      ],
    )


  const currentSensor =
    mergedSensorData.find(
      (sensor) =>
        sensor.key === selectedSensor,
    )
    ?? mergedSensorData[0]


  const dashboardSensors =
    dashboardSensorKeys.map(
      (key) =>
        mergedSensorData.find(
          (sensor) =>
            sensor.key === key,
        ) as SensorData,
    )


  const heroSensors =
    heroSensorKeys.map(
      (key) =>
        mergedSensorData.find(
          (sensor) =>
            sensor.key === key,
        ) as SensorData,
    )


  const chartSensorOptions =
    backendData
      ?.sensorDefinitions
      ?.length
      ? backendData.sensorDefinitions.map(
          (definition) => ({
            key:
              definition.sensorKey,

            label:
              definition.displayName,
          }),
        )
      : sensorDefinitions.map(
          (definition) => ({
            key:
              definition.key,

            label:
              definition.label,
          }),
        )
const soilNpkGroups =
  [
    {
      soil: 'Tanah 1',

      sensors: [
        {
          label: 'N',
          key: 'soil_1_n',
        },
        {
          label: 'P',
          key: 'soil_1_p',
        },
        {
          label: 'K',
          key: 'soil_1_k',
        },
      ],
    },

    {
      soil: 'Tanah 2',

      sensors: [
        {
          label: 'N',
          key: 'soil_2_n',
        },
        {
          label: 'P',
          key: 'soil_2_p',
        },
        {
          label: 'K',
          key: 'soil_2_k',
        },
      ],
    },
  ].map(
    (group) => ({
      ...group,

      sensors:
        group.sensors.map(
          (item) => ({
            ...item,

            sensor:
              mergedSensorData.find(
                (sensor) =>
                  sensor.key ===
                  item.key,
              ),
          }),
        ),
    }),
  )

  const primaryDevice =
    backendData?.devices[0]


  const openAlarms =
    backendData?.alarms.filter(
      (alarm) =>
        alarm.status !== 'resolved',
    ) ?? []


  const currentHistorySeries =
    historyBySensor[
      selectedSensor
    ] ?? null


  const currentHistory =
    useMemo(
      () =>
        currentHistorySeries
          ?.points
        ?? [],
      [
        currentHistorySeries,
      ],
    )


  const historyWindowLabel =
    currentHistorySeries
      ? `${formatHistoryTimestamp(currentHistorySeries.from)} – ${formatHistoryTimestamp(currentHistorySeries.to)} · rata-rata ${currentHistorySeries.bucketMinutes} menit`
      : 'Memuat histori telemetry...'


  const homeSchedules =
    (
      backendData?.schedules
      ?? []
    )
      .filter(
        (schedule) =>
          schedule.enabled,
      )
      .slice(
        0,
        4,
      )


  const chartGeometry =
    useMemo(
      () => {
        const plotLeft =
          28

        const plotRight =
          732

        const plotBottom =
          202


        const values =
          currentHistory.map(
            (point) =>
              point.value,
          )


        if (
          values.length === 0
        ) {
          return {
            points: [],
            linePath: '',
            areaPath: '',
            plotBottom,
          }
        }


        const maxValue =
          Math.max(
            ...values,
          )


        const minValue =
          Math.min(
            ...values,
          )


        const range =
          Math.max(
            maxValue - minValue,
            1,
          )


        const points =
          values.map(
            (
              value,
              index,
            ) => ({
              x:
                values.length === 1
                  ? (
                      plotLeft
                      + plotRight
                    ) / 2

                  : plotLeft
                    + (
                      index
                      * (
                        plotRight
                        - plotLeft
                      )
                    )
                    / (
                      values.length
                      - 1
                    ),

              y:
                plotBottom
                - 18
                - (
                  (
                    value
                    - minValue
                  )
                  / range
                )
                * 132,
            }),
          )


        const linePath =
          points.reduce(
            (
              path,
              point,
              index,
            ) => {
              if (
                index === 0
              ) {
                return (
                  'M '
                  + point.x
                  + ' '
                  + point.y
                )
              }


              const previous =
                points[
                  index - 1
                ]


              const controlX =
                (
                  previous.x
                  + point.x
                ) / 2


              return (
                path
                + ' C '
                + controlX
                + ' '
                + previous.y
                + ', '
                + controlX
                + ' '
                + point.y
                + ', '
                + point.x
                + ' '
                + point.y
              )
            },
            '',
          )


        return {
          points,

          linePath,

          areaPath:
            linePath
            + ' L '
            + plotRight
            + ' '
            + plotBottom
            + ' L '
            + plotLeft
            + ' '
            + plotBottom
            + ' Z',

          plotBottom,
        }
      },
      [
        currentHistory,
      ],
    )


  const chartMarkerCount =
    Math.min(
      chartGeometry
        .points
        .length,
      6,
    )


  const chartMarkerIndexes =
    chartMarkerCount === 0
      ? []
      : (
          chartMarkerCount === 1
            ? [
                0,
              ]
            : Array.from(
                {
                  length:
                    chartMarkerCount,
                },
                (
                  _,
                  markerIndex,
                ) =>
                  Math.round(
                    markerIndex
                    * (
                      chartGeometry
                        .points
                        .length
                      - 1
                    )
                    / (
                      chartMarkerCount
                      - 1
                    ),
                  ),
              )
        )


  const clockLabel =
    clock.toLocaleTimeString(
      'id-ID',
      {
        hour: '2-digit',
        minute: '2-digit',
      },
    )


  return (
    <div
      className={
        `app-shell ${
          navOpen
            ? 'nav-is-open'
            : ''
        }`
      }
    >
      <aside
        className="side-drawer"
        aria-label="Navigasi utama"
      >
        <div className="drawer-brand">
          <span
            className="brand-mark"
            aria-hidden="true"
          >
            <Leaf
              size={21}
              strokeWidth={2}
            />
          </span>


          <div>
            <strong>
              SMART FERTIGASI
            </strong>

            <small>
              Panel kontrol fertigasi
            </small>
          </div>
        </div>


        <nav className="drawer-nav">
          {
            visibleNavItems.map(
              (item) => (
                <button
                  className={
                    `drawer-nav-item ${
                      activePage
                      === item.key
                        ? 'is-active'
                        : ''
                    }`
                  }
                  type="button"
                  key={
                    item.key
                  }
                  aria-current={
                    activePage
                    === item.key
                      ? 'page'
                      : undefined
                  }
                  onClick={() =>
                    navigateTo(
                      item.key,
                    )
                  }
                >
                  <span
                    className="drawer-nav-icon"
                    aria-hidden="true"
                  >
                    <NavigationIcon
                      icon={
                        item.icon
                      }
                    />
                  </span>

                  <span>
                    {
                      item.label
                    }
                  </span>
                </button>
              ),
            )
          }
        </nav>


        <div className="drawer-device-card">
          <div>
            <strong>
              {
                primaryDevice
                  ?.deviceId
                  .toUpperCase()
                ?? 'ESP32-S3-01'
              }
            </strong>

            <span
              className={
                `device-status is-${
                  connectionState === 'loading'
                    ? 'loading'
                    : connectionState === 'unavailable'
                      ? 'offline'
                      : primaryDevice
                        ?.connectionStatus
                        ?? 'offline'
                }`
              }
            >
              {
                connectionState === 'loading'
                  ? 'Menghubungkan'

                  : connectionState === 'unavailable'
                    ? 'API Offline'

                    : primaryDevice
                      ?.connectionStatus === 'online'
                      ? 'Online'

                      : primaryDevice
                        ?.connectionStatus === 'stale'
                        ? 'Stale'

                        : 'Offline'
              }
            </span>
          </div>


          <small>
            {
              connectionState === 'connected'
                ? (
                    telemetryFreshness === 'fresh'
                      ? `Telemetry ${telemetryAgeLabel ?? 'baru saja'}`
                      : telemetryFreshness === 'stale'
                        ? `Telemetry terlambat · ${telemetryAgeLabel ?? '-'}`
                        : telemetryFreshness === 'expired'
                          ? `Menunggu telemetry baru · terakhir ${telemetryAgeLabel ?? '-'}`
                          : `${
                          backendData
                            ?.sensorDefinitions
                            .length
                          ?? 0
                        } sensor terdaftar · menunggu telemetry`
                  )

                : 'Backend SPFF belum terhubung'
            }
          </small>
        </div>


        <button
          className="drawer-profile"
          type="button"
          onClick={() =>
            navigateTo(
              'settings',
            )
          }
        >
          <span
            className="avatar"
            aria-hidden="true"
          >
            <UserRound
              size={17}
              strokeWidth={1.9}
            />
          </span>


          <span>
            <strong>
              {
                user.displayName
              }
            </strong>

            <small>
              {
                user.role === 'admin'
                  ? 'Admin'
                  : 'Operator'
              }
            </small>
          </span>
        </button>
      </aside>


      <button
        className="nav-scrim"
        type="button"
        aria-label="Tutup navigasi"
        onClick={() =>
          setNavOpen(
            false,
          )
        }
      />


      <div className="compact-account-dock">
  <button
    className="menu-button compact-menu-button"
    type="button"
    aria-label="Buka navigasi"
    aria-expanded={
      navOpen
    }
    onClick={() =>
      setNavOpen(
        (open) =>
          !open,
      )
    }
  >
    <span />
    <span />
    <span />
  </button>


  <div className="compact-divider compact-menu-divider" />


  <div className="notification-wrap">
    <button
      className="compact-icon-button"
      type="button"
      aria-label="Buka notifikasi"
      aria-expanded={
        notificationsOpen
      }
      onClick={() =>
        setNotificationsOpen(
          (open) =>
            !open,
        )
      }
    >
      <Bell
        className="header-bell-icon"
        size={17}
        strokeWidth={1.8}
        aria-hidden="true"
      />

      {
        !notificationsRead
        && openAlarms.length > 0
        && (
          <span className="notification-dot" />
        )
      }
    </button>


    {
      notificationsOpen
      && (
        <div
          className="notification-panel"
          role="status"
        >
          <div className="notification-panel-head">
            <strong>
              Notifikasi
            </strong>

            {
              !notificationsRead
              && openAlarms.length > 0
              && (
                <span>
                  {
                    openAlarms.length
                  }
                  {' '}
                  aktif
                </span>
              )
            }
          </div>


          {
            notificationsRead
            || openAlarms.length === 0
              ? (
                  <p className="notification-empty">
                    {
                      connectionState === 'connected'
                        ? 'Tidak ada alarm aktif di database.'
                        : 'Menunggu koneksi backend SPFF.'
                    }
                  </p>
                )

              : (
                  <div className="notification-list">
                    {
                      openAlarms
                        .slice(
                          0,
                          3,
                        )
                        .map(
                          (alarm) => (
                            <button
                              type="button"
                              key={
                                alarm.id
                              }
                              onClick={() =>
                                navigateTo(
                                  'alarms',
                                )
                              }
                            >
                              <b>
                                {
                                  alarm.title
                                }
                              </b>

                              <small>
                                {
                                  alarm.description
                                }
                              </small>
                            </button>
                          ),
                        )
                    }
                  </div>
                )
          }


          <button
            className="mark-read-button"
            type="button"
            onClick={() =>
              setNotificationsRead(
                (read) =>
                  !read,
              )
            }
          >
            {
              notificationsRead
                ? 'Tampilkan notifikasi'
                : 'Tandai semua dibaca'
            }
          </button>
        </div>
      )
    }
  </div>


  <div className="compact-divider" />


  <div className="compact-user-copy">
    <span>
      Hi,
    </span>

    <strong>
      {user.displayName}!
    </strong>
  </div>


  <button
    className="compact-avatar-button"
    type="button"
    aria-label="Buka pengaturan profil"
    title="Pengaturan"
    onClick={() =>
      navigateTo(
        'settings',
      )
    }
  >
    <span
      className="compact-avatar"
      aria-hidden="true"
    >
      <UserRound
        size={16}
        strokeWidth={1.9}
      />
    </span>
  </button>


  <div className="compact-divider" />


  <button
    className="compact-icon-button"
    type="button"
    aria-label="Logout"
    title="Logout"
    onClick={() => {
      void logout()
    }}
  >
    <LogOut
      size={16}
      strokeWidth={1.9}
      aria-hidden="true"
    />
  </button>
</div>





      <main className="app-main">
        <header className="page-shell-header">
          <div className="page-shell-header-copy">
            <h1>
              {
                pageTitles[
                  activePage
                ]
              }
            </h1>

            <p>
              {
                pageDescriptions[
                  activePage
                ]
              }
            </p>
          </div>
        </header>


        {
          activePage === 'dashboard'
            ? (
                <section
                  className="dashboard-home"
                  aria-label="Dashboard Smart Fertigasi"
                >
                  <div className="overview-grid">
                    <article className="hero-card">
                      <div className="hero-shade" />


                      <div className="hero-content">
                        <time
                          dateTime={
                            clock.toISOString()
                          }
                        >
                          {
                            clockLabel
                          }
                        </time>


                        <p>
                          <MapPin
                            className="hero-location-icon"
                            size={14}
                            strokeWidth={2}
                            aria-hidden="true"
                          />

                          {
                            backendData
                              ?.site
                              ?.name
                            ?? 'Lokasi Utama'
                          }
                        </p>


                        <div className="hero-sensors">
                          {
                            heroSensors.map(
                              (sensor) => (
                                <button
                                  className={
                                    `hero-sensor ${
                                      selectedSensor === sensor.key
                                        ? 'is-selected'
                                        : ''
                                    }`
                                  }
                                  type="button"
                                  key={
                                    sensor.key
                                  }
                                  aria-pressed={
                                    selectedSensor === sensor.key
                                  }
                                  onClick={() =>
                                    setSelectedSensor(
                                      sensor.key,
                                    )
                                  }
                                >
                                  <span className="hero-sensor-label">
                                    <SensorIcon
                                      sensorKey={
                                        sensor.key
                                      }
                                      size={16}
                                    />

                                    {
                                      sensor.label
                                    }
                                  </span>

                                  <strong>
                                    {
                                      formatSensorValue(
                                        sensor.value,
                                      )
                                    }
                                    {' '}

                                    <small>
                                      {
                                        sensor.unit
                                      }
                                    </small>
                                  </strong>
                                </button>
                              ),
                            )
                          }
                        </div>
                      </div>
                      <div
  className="hero-npk-groups"
  aria-label="NPK tanah"
>
  {
    soilNpkGroups.map(
      (group) => (
        <div
          className="hero-npk-card"
          key={group.soil}
        >
          <div className="hero-npk-title">
            <Sprout
              size={12}
              strokeWidth={2}
              aria-hidden="true"
            />

            <h3>
              {group.soil}
            </h3>
          </div>

          <div className="hero-npk-values">
            {
              group.sensors.map(
                ({
                  label,
                  key,
                  sensor,
                }) => (
                  <button
                    type="button"
                    className={
                      `hero-npk-item ${
                        selectedSensor === key
                          ? 'is-selected'
                          : ''
                      }`
                    }
                    key={key}
                    aria-pressed={
                      selectedSensor === key
                    }
                    onClick={() =>
                      setSelectedSensor(
                        key,
                      )
                    }
                    title={
                      sensor?.label
                      ?? label
                    }
                  >
                    <span>
                      {label}
                    </span>

                    <strong>
                      {
                        formatSensorValue(
                          sensor?.value
                          ?? null,
                        )
                      }
                    </strong>

                    <small>
                      mg/kg
                    </small>
                  </button>
                ),
              )
            }
          </div>
        </div>
      ),
    )
  }
</div>
                    </article>


                    <aside
                      className="schedule-card"
                      aria-label="Jadwal hari ini"
                    >
                      <div className="schedule-head">
                        <div>
                          

                          <h2>
                            Jadwal
                          </h2>
                        </div>

                        <h3 className="today-chip">
                          Hari ini
                        </h3>
                      </div>


                      <div className="schedule-list">
                        {
                          homeSchedules.length > 0
                            ? homeSchedules.map(
                                (schedule) => (
                                  <button
                                    type="button"
                                    key={
                                      schedule.id
                                    }
                                    onClick={() =>
                                      navigateTo(
                                        'controls',
                                      )
                                    }
                                  >
                                    <CalendarDays
                                      className="schedule-calendar-icon"
                                      size={16}
                                      strokeWidth={1.8}
                                      aria-hidden="true"
                                    />

                                    <span className="schedule-copy">
                                      <strong>
                                        {
                                          formatScheduleDate(
                                            clock,
                                          )
                                        }
                                      </strong>

                                      <small>
                                        {
                                          schedule.actuatorName
                                        }
                                        {' · '}
                                        {
                                          {
                                            daily:
                                              'Setiap Hari',

                                            weekdays:
                                              'Senin–Jumat',

                                            weekends:
                                              'Akhir Pekan',

                                            once:
                                              'Satu Kali',
                                          }[
                                            schedule.repeatRule
                                          ]
                                        }
                                      </small>
                                    </span>

                                    <time>
                                      {
                                        schedule.onTime
                                      }
                                    </time>
                                  </button>
                                ),
                              )

                            : (
                                <div className="schedule-empty-inline">
                                  Belum ada jadwal aktif di PostgreSQL.
                                </div>
                              )
                        }
                      </div>


                      <button
                        className="see-more-button"
                        type="button"
                        onClick={() =>
                          navigateTo(
                            'controls',
                          )
                        }
                      >
                        Lihat semua jadwal

                        <ArrowRight
                          size={14}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </button>
                    </aside>
                  </div>


                  <div className="monitoring-grid">
                    <div
                      className="sensor-panel"
                      aria-label="Ringkasan sensor"
                    >
                      {
                        dashboardSensors.map(
                          (sensor) => (
                            <button
                              className={
                                `metric-card ${
                                  selectedSensor === sensor.key
                                    ? 'is-selected'
                                    : ''
                                }`
                              }
                              type="button"
                              key={
                                sensor.key
                              }
                              aria-pressed={
                                selectedSensor === sensor.key
                              }
                              style={
                                {
                                  '--sensor-color':
                                    sensor.color,

                                  '--sensor-soft':
                                    sensor.softColor,
                                } as CSSProperties
                              }
                              onClick={() =>
                                setSelectedSensor(
                                  sensor.key,
                                )
                              }
                            >
                              <span className="metric-card-head">
                                <span
                                  className="metric-icon"
                                  aria-hidden="true"
                                >
                                  <SensorIcon
                                    sensorKey={
                                      sensor.key
                                    }
                                  />
                                </span>

                                <span
                                  className="metric-arrow"
                                  aria-hidden="true"
                                >
                                  <ArrowUpRight
                                    size={18}
                                    strokeWidth={1.8}
                                  />
                                </span>
                              </span>


                              <h3 className="metric-label">
                                {
                                  sensor.label
                                }
                              </h3>


                              <span className="metric-reading">
                                <h2>
                                  {
                                    formatSensorValue(
                                      sensor.value,
                                    )
                                  }
                                </h2>

                                {
                                  sensor.unit
                                  && (
                                    <small>
                                      {
                                        sensor.unit
                                      }
                                    </small>
                                  )
                                }

                              </span>


                            </button>
                          ),
                        )
                      }
                    </div>


                    <article className="chart-card">
                      <div className="chart-head">
                        <div>
                          <h2>
                            Latest Data
                          </h2>

                          <small className="metric-update">
                            {
                              hasTelemetry
                                ? historyWindowLabel
                                : 'Belum ada telemetry tersimpan'
                            }
                          </small>
                        </div>


                        <div className="chart-filters">
                          <label className="chart-select chart-sensor-select">
                            <span className="sr-only">
                              Pilih sensor untuk grafik
                            </span>

                            <select
                              value={
                                selectedSensor
                              }
                              onChange={(event) =>
                                setSelectedSensor(
                                  event.target.value,
                                )
                              }
                            >
                              {
                                chartSensorOptions.map(
                                  (sensor) => (
                                    <option
                                      value={
                                        sensor.key
                                      }
                                      key={
                                        sensor.key
                                      }
                                    >
                                      {
                                        sensor.label
                                      }
                                    </option>
                                  ),
                                )
                              }
                            </select>
                          </label>


                          <label className="chart-date-field">
                            <span className="sr-only">
                              Tanggal akhir grafik
                            </span>

                            <input
                              type="date"
                              value={
                                chartDate
                              }
                              onChange={(event) => {
                                const nextDate =
                                  event.target.value


                                setChartDate(
                                  nextDate,
                                )


                                if (!nextDate) {
                                  setChartHour('')
                                } else if (!chartHour) {
                                  setChartHour('23:00')
                                }
                              }}
                            />
                          </label>


                          <label className="chart-select chart-hour-select">
                            <span className="sr-only">
                              Jam akhir grafik
                            </span>

                            <select
                              value={
                                chartHour
                              }
                              disabled={
                                !chartDate
                              }
                              onChange={(event) =>
                                setChartHour(
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">
                                Jam
                              </option>

                              {
                                historyHourOptions.map(
                                  (hour) => (
                                    <option
                                      value={
                                        hour
                                      }
                                      key={
                                        hour
                                      }
                                    >
                                      {hour}
                                    </option>
                                  ),
                                )
                              }
                            </select>
                          </label>


                          <button
                            className="chart-latest-button"
                            type="button"
                            disabled={
                              !chartDate
                              && !chartHour
                            }
                            onClick={() => {
                              setChartDate('')
                              setChartHour('')
                            }}
                          >
                            Terbaru
                          </button>
                        </div>
                      </div>


                      <div className="chart-visual">
                        {
                          currentHistory.length === 0
                            ? (
                                <div className="chart-empty-state">
                                  Belum ada histori telemetry untuk sensor ini.
                                </div>
                              )

                            : (
                                <svg
                                  viewBox="0 0 760 238"
                                  preserveAspectRatio="none"
                                  role="img"
                                  aria-label={
                                    `Grafik ${currentSensor.label}`
                                  }
                                >
                                  <title>
                                    Riwayat telemetry
                                    {' '}
                                    {
                                      currentSensor.label
                                    }
                                    {' '}
                                    dari PostgreSQL
                                  </title>


                                  <defs>
                                    <linearGradient
                                      id={
                                        `chart-fill-${selectedSensor}`
                                      }
                                      x1="0"
                                      y1="0"
                                      x2="0"
                                      y2="1"
                                    >
                                      <stop
                                        offset="0"
                                        stopColor="#28ad79"
                                        stopOpacity="0.36"
                                      />

                                      <stop
                                        offset="1"
                                        stopColor="#28ad79"
                                        stopOpacity="0.04"
                                      />
                                    </linearGradient>
                                  </defs>


                                  <line
                                    className="chart-baseline"
                                    x1="28"
                                    y1={
                                      chartGeometry.plotBottom
                                    }
                                    x2="732"
                                    y2={
                                      chartGeometry.plotBottom
                                    }
                                  />


                                  <path
                                    className="chart-area"
                                    d={
                                      chartGeometry.areaPath
                                    }
                                    fill={
                                      `url(#chart-fill-${selectedSensor})`
                                    }
                                  />


                                  <path
                                    className="chart-line"
                                    d={
                                      chartGeometry.linePath
                                    }
                                  />


                                  {
                                    chartMarkerIndexes.map(
                                      (
                                        historyIndex,
                                      ) => {
                                        const point =
                                          chartGeometry
                                            .points[
                                              historyIndex
                                            ]


                                        const historyPoint =
                                          currentHistory[
                                            historyIndex
                                          ]


                                        return (
                                          <g
                                            key={
                                              `${selectedSensor}-${historyIndex}`
                                            }
                                          >
                                            <title>
                                              {
                                                historyPoint
                                                  ? [
                                                      historyPoint.time,
                                                      ': rata-rata ',
                                                      formatSensorValue(
                                                        historyPoint.average,
                                                      ),
                                                      ' ',
                                                      currentSensor.unit,
                                                      ', min ',
                                                      formatSensorValue(
                                                        historyPoint.min,
                                                      ),
                                                      ', max ',
                                                      formatSensorValue(
                                                        historyPoint.max,
                                                      ),
                                                      ', ',
                                                      historyPoint.samples,
                                                      ' sampel',
                                                    ].join('')
                                                  : ''
                                              }
                                            </title>

                                            <line
                                              className="chart-guide"
                                              x1={
                                                point.x
                                              }
                                              y1={
                                                point.y
                                              }
                                              x2={
                                                point.x
                                              }
                                              y2={
                                                chartGeometry.plotBottom
                                              }
                                            />

                                            <circle
                                              className="chart-point"
                                              cx={
                                                point.x
                                              }
                                              cy={
                                                point.y
                                              }
                                              r="4.5"
                                            />

                                            <text
                                              className="chart-time-label"
                                              x={
                                                point.x
                                              }
                                              y="226"
                                              textAnchor="middle"
                                            >
                                              {
                                                currentHistory[
                                                  historyIndex
                                                ]?.time
                                                ?? ''
                                              }
                                            </text>
                                          </g>
                                        )
                                      },
                                    )
                                  }
                                </svg>
                              )
                        }
                      </div>
                    </article>
                  </div>
                </section>
              )

            : (
                <SecondaryPage
                  page={
                    activePage
                  }
                  data={
                    backendData
                  }
                  connectionState={
                    connectionState
                  }
                  onRefresh={() =>
                    setRefreshVersion(
                      (version) =>
                        version + 1,
                    )
                  }
                />
              )
        }
      </main>
    </div>
  )
}


export default App
