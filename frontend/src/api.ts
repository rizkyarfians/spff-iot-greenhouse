import type {
  ApiActuator,
  ApiAutomaticControl,
  ApiAutomaticControlUpdateRequest,
  ApiAlarmActionRequest,
  ApiAlarmActionResult,
  ApiAlarmDetail,
  ApiAlarmPage,
  ApiHistorySeries,
  HistoryBucket,
  ApiPumpCommandRequest,
  ApiScheduleCreateRequest,
  ApiScheduleEnabledRequest,
  ApiResponse,
  ApiSchedule,
  ApiSettings,
  ApiTelemetrySnapshot,
  AuditLogEntry,
  AuthUser,
  BootstrapData,
  CreateUserRequest,
  DeleteUserResult,
  LoginRequest,
  ManagedUser,
  SmartSoilSnapshot,
  SmartSoilReferenceInput,
  SelectedCropInput,
  UpdateUserRequest,
} from '@spff/contracts'


export type ConnectionState =
  | 'loading'
  | 'connected'
  | 'unavailable'


export type {
  ApiActuator,
  ApiAutomaticControl,
  ApiAutomaticControlUpdateRequest,
  ApiAlarm,
  ApiAlarmDetail,
  ApiAlarmEvent,
  ApiAlarmPage,
  ApiDevice,
  ApiHistoryPoint,
  ApiHistorySeries,
  ApiSchedule,
  ApiSensor,
  ApiSensorDefinition,
  ApiSettings,
  ApiSystemLog,
  ApiTelemetryLog,
  AppRole,
  AuditLogEntry,
  AuthUser,
  BootstrapData,
  ManagedUser,
  ScheduleRepeatRule,
} from '@spff/contracts'


export class ApiError
  extends Error {

  status: number

  errors: string[]


  constructor(
    message: string,
    status: number,
    errors: string[] = [],
  ) {

    super(message)

    this.name =
      'ApiError'

    this.status =
      status

    this.errors =
      errors
  }
}


function cookieValue(
  name: string,
) {

  const prefix =
    `${encodeURIComponent(name)}=`


  for (
    const part
    of document.cookie
      .split(';')
  ) {

    const value =
      part.trim()


    if (
      value.startsWith(
        prefix,
      )
    ) {

      return decodeURIComponent(
        value.slice(
          prefix.length,
        ),
      )
    }
  }


  return ''
}


async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {

  const method =
    (
      init.method
      ?? 'GET'
    )
      .toUpperCase()


  const headers =
    new Headers(
      init.headers,
    )


  if (
    ![
      'GET',
      'HEAD',
      'OPTIONS',
    ].includes(
      method,
    )
  ) {

    const csrf =
      cookieValue(
        'spff_csrf',
      )


    if (csrf) {

      headers.set(
        'X-CSRF-Token',
        csrf,
      )
    }
  }


  const response =
    await fetch(
      '/api' + path,
      {
        ...init,

        cache:
          init.cache
          ?? (
            method === 'GET'
              ? 'no-store'
              : undefined
          ),

        headers,

        credentials:
          'include',
      },
    )


  let payload: ApiResponse<T>

try {
  payload = (await response.json()) as ApiResponse<T>
} catch {
  throw new ApiError(
    `HTTP ${response.status}`,
    response.status,
  )
}


  if (
    !response.ok
    || !payload.success
  ) {

    if (
      response.status
      === 401

      && path
        !== '/auth/login'
    ) {

      window.dispatchEvent(
        new CustomEvent(
          'spff:unauthorized',
        ),
      )
    }


    throw new ApiError(
      payload.message
      || `HTTP ${response.status}`,

      response.status,

      payload.errors
      ?? [],
    )
  }


  return payload.data
}


export function login(
  input: LoginRequest,
) {

  return request<AuthUser>(
    '/auth/login',
    {
      method:
        'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          input,
        ),
    },
  )
}


export function fetchCurrentUser(
  signal?: AbortSignal,
) {

  return request<AuthUser>(
    '/auth/me',
    {
      signal,
    },
  )
}


export function logout() {

  return request<null>(
    '/auth/logout',
    {
      method:
        'POST',
    },
  )
}


export function fetchUsers(
  signal?: AbortSignal,
) {

  return request<ManagedUser[]>(
    '/admin/users',
    {
      signal,
    },
  )
}


export function createUser(
  input: CreateUserRequest,
) {

  return request<ManagedUser>(
    '/admin/users',
    {
      method:
        'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          input,
        ),
    },
  )
}


export function updateUser(
  id: string,
  input: UpdateUserRequest,
) {

  return request<ManagedUser>(
    `/admin/users/${encodeURIComponent(id)}`,
    {
      method:
        'PATCH',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          input,
        ),
    },
  )
}

export function deleteUser(
  id: string,
) {

  return request<DeleteUserResult>(
    `/admin/users/${encodeURIComponent(id)}`,
    {
      method:
        'DELETE',
    },
  )
}


export function fetchAuditLogs(
  limit = 100,
  signal?: AbortSignal,
) {

  return request<AuditLogEntry[]>(
    `/admin/audit-logs?limit=${encodeURIComponent(limit)}`,
    {
      signal,
    },
  )
}


export function fetchBootstrap(
  signal?: AbortSignal,
) {

  return request<BootstrapData>(
    '/bootstrap',
    {
      signal,
    },
  )
}


export function fetchLatestTelemetry(
  signal?: AbortSignal,
) {

  return request<ApiTelemetrySnapshot>(
    '/telemetry/latest',
    {
      signal,
    },
  )
}

export function fetchSmartSoil(
  signal?: AbortSignal,
) {
  return request<SmartSoilSnapshot>(
    '/smart-soil',
    { signal },
  )
}

export function saveSmartSoilSelection(
  input: SelectedCropInput,
) {
  return request<SmartSoilSnapshot>(
    '/smart-soil/selection',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function saveSmartSoilReference(
  input: SmartSoilReferenceInput,
) {
  return request<SmartSoilSnapshot>(
    '/smart-soil/reference',
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}


export function fetchSensorHistory(
  sensorKey: string,
  signal?: AbortSignal,
  options: {
    to?: Date
    hours?: number
    bucket?: HistoryBucket
  } = {},
) {
  const params =
    new URLSearchParams({
      type:
        sensorKey,

      bucket:
        options.bucket
        ?? '5m',

      hours:
        String(
          options.hours
          ?? 6,
        ),
    })


  if (options.to) {
    params.set(
      'to',
      options.to.toISOString(),
    )
  }


  return request<ApiHistorySeries>(
    `/sensors/history?${params.toString()}`,
    {
      signal,
    },
  )
}


export function updateActuator(
  id: string,
  isActive: boolean,
  commandId =
    `web-${crypto.randomUUID()}`,
) {

  const body = {
    isActive,
    commandId,
  } satisfies ApiPumpCommandRequest


  return request<ApiActuator>(
    `/pumps/${encodeURIComponent(id)}`,
    {
      method:
        'PATCH',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          body,
        ),
    },
  )
}

export function fetchAlarms(
  options: {
    status?: 'open' | 'acknowledged' | 'resolved'
    severity?: 'info' | 'warning' | 'critical'
    query?: string
    page?: number
    pageSize?: number
    signal?: AbortSignal
  } = {},
) {
  const params =
    new URLSearchParams({
      page:
        String(options.page ?? 1),

      pageSize:
        String(options.pageSize ?? 10),
    })

  if (options.status) {
    params.set('status', options.status)
  }

  if (options.severity) {
    params.set('severity', options.severity)
  }

  if (options.query?.trim()) {
    params.set('query', options.query.trim())
  }

  return request<ApiAlarmPage>(
    `/alarms?${params.toString()}`,
    {
      signal:
        options.signal,
    },
  )
}


export function fetchAlarmDetail(
  id: string,
  signal?: AbortSignal,
) {
  return request<ApiAlarmDetail>(
    `/alarms/${encodeURIComponent(id)}`,
    {
      signal,
    },
  )
}


export function acknowledgeAlarm(
  id: string,
  note?: string,
) {

  const body = {
    note,
  } satisfies ApiAlarmActionRequest

  return request<ApiAlarmActionResult>(
    `/alarms/${encodeURIComponent(id)}/acknowledge`,
    {
      method:
        'PATCH',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(body),
    },
  )
}


export function resolveAlarm(
  id: string,
  note?: string,
) {

  const body = {
    note,
  } satisfies ApiAlarmActionRequest

  return request<ApiAlarmActionResult>(
    `/alarms/${encodeURIComponent(id)}/resolve`,
    {
      method:
        'PATCH',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(body),
    },
  )
}


export function createSchedule(
  input: ApiScheduleCreateRequest,
) {

  return request<ApiSchedule>(
    '/schedules',
    {
      method:
        'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          input,
        ),
    },
  )
}


export function setScheduleEnabled(
  id: string,
  enabled: boolean,
) {

  const body = {
    enabled,
  } satisfies ApiScheduleEnabledRequest


  return request<ApiSchedule>(
    `/schedules/${encodeURIComponent(id)}`,
    {
      method:
        'PATCH',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          body,
        ),
    },
  )
}


export function deleteSchedule(
  id: string,
) {

  return request<{
    id: string
  }>(
    `/schedules/${encodeURIComponent(id)}`,
    {
      method:
        'DELETE',
    },
  )
}


export function saveSettings(
  settings: ApiSettings,
) {

  return request<ApiSettings>(
    '/settings',
    {
      method:
        'PUT',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify(
          settings,
        ),
    },
  )
}

export function saveAutomaticControl(
  config: ApiAutomaticControlUpdateRequest,
) {
  return request<ApiAutomaticControl>(
    '/automatic-control',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    },
  )
}
