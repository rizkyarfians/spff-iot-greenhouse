import {userFacingMessage} from './userFacingMessage'
import type {ProtocolGuideState,ProtocolGuideSave,ProtocolGuideRevision} from '@spff/contracts'
import type {
  ApiActuator,
  ApiAutomaticControl,
  ApiAutomaticControlUpdateRequest,
  ApiAlarmActionRequest,
  ApiAlarmActionResult,
  ApiAlarmDetail,
  ApiAlarmPage,
  ApiHistorySeries,
  ApiDatalogItem,
  ApiDatalogPage,
  HistoryBucket,
  ApiPumpCommandRequest,
  ApiScheduleCreateRequest,
  ApiScheduleUpdateRequest,
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
import { readDatalogExportStream } from './datalogExportStream'


export type ConnectionState =
  | 'loading'
  | 'connected'
  | 'unavailable'


function createClientUuid() {

  const cryptoApi =
    globalThis.crypto


  if (
    typeof cryptoApi?.randomUUID ===
      'function'
  ) {

    return cryptoApi.randomUUID()
  }


  const bytes =
    new Uint8Array(16)


  if (
    typeof cryptoApi?.getRandomValues ===
      'function'
  ) {

    cryptoApi.getRandomValues(bytes)
  }
  else {

    for (
      let index = 0
      ; index < bytes.length
      ; index += 1
    ) {

      bytes[index] =
        Math.floor(Math.random() * 256)
    }
  }


  bytes[6] =
    (bytes[6] & 0x0f) | 0x40

  bytes[8] =
    (bytes[8] & 0x3f) | 0x80


  const hex =
    Array.from(
      bytes,
      (byte) =>
        byte.toString(16).padStart(2, '0'),
    )


  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}


export type {
  ApiActuator,
  ApiAutomaticControl,
  ApiAutomaticControlUpdateRequest,
  ApiDatalogItem,
  ApiDatalogPage,
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

    super(userFacingMessage(message))

    this.name =
      'ApiError'

    this.status =
      status

    this.errors =
      errors.map(userFacingMessage)
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
    from?: Date
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

  if (options.from) {
    params.set(
      'from',
      options.from.toISOString(),
    )
  }


  return request<ApiHistorySeries>(
    `/sensors/history?${params.toString()}`,
    {
      signal,
    },
  )
}

export function fetchDatalog(
  options: {
    kind: 'sensor' | 'actuator'
    parameter: string
    from: Date
    to: Date
    page: number
    pageSize?: number
  },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    kind: options.kind,
    parameter: options.parameter,
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    page: String(options.page),
    pageSize: String(options.pageSize ?? 10),
  })

  return request<ApiDatalogPage>(
    `/datalog?${params.toString()}`,
    { signal },
  )
}


export async function fetchDatalogExport(
  options: { kind: 'sensor' | 'actuator'; parameter: string; from: Date; to: Date },
  signal: AbortSignal,
  onBatch: (items: ApiDatalogItem[]) => Promise<void>,
) {
  const params = new URLSearchParams({
    kind: options.kind, parameter: options.parameter,
    from: options.from.toISOString(), to: options.to.toISOString(),
  })
  const response = await fetch(`/api/datalog/export?${params}`, {
    signal, credentials: 'include', cache: 'no-store',
    headers: { Accept: 'application/x-ndjson' },
  })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent('spff:unauthorized'))
    const error = await response.json().catch(() => null)
    throw new ApiError(error?.message || `HTTP ${response.status}`, response.status)
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    await response.body?.cancel()
    throw new Error('Server belum mendukung ekspor ini. Perbarui backend lalu coba lagi.')
  }
  return readDatalogExportStream(response.body, signal, onBatch)
}

export function updateActuator(
  id: string,
  isActive: boolean,
  commandId =
    `web-${createClientUuid()}`,
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


export function updateSchedule(id:string,input:ApiScheduleUpdateRequest) {
  return request<ApiSchedule>(`/schedules/${encodeURIComponent(id)}`,{
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),
  })
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


export function saveSensorEnabled(group: string, enabled: boolean) {
  return request<{ group: string; enabled: boolean }>(
    '/settings/sensors/' + encodeURIComponent(group),
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) },
  )
}

export function fetchAutomaticCycleStatus(deviceId: string, signal: AbortSignal) {
  return request<import('@spff/contracts').AutomaticCycleStatus>(
    '/fertigation/automatic-cycle?deviceId=' + encodeURIComponent(deviceId), { signal })
}

export function fetchHstFertilizationStarts(deviceId: string, signal: AbortSignal) {
  return request<{
    start_id: string; device_id: string; hst: number; product: string; method: string;
    status: 'queued' | 'started' | 'failed'; created_at: string; started_at: string | null;
  }[]>('/fertigation/hst-starts?deviceId=' + encodeURIComponent(deviceId), { signal })
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


// Uses the existing session cookie, CSRF token and API error handling.
export const fetchFertigationRecipes = () => request<import('@spff/contracts').FertigationRecipe[]>('/fertigation/recipes')
export const saveFertigationRecipe = (input: import('@spff/contracts').FertigationRecipeMutation, recipe?: import('@spff/contracts').FertigationRecipe) =>
  request<import('@spff/contracts').FertigationRecipe>(recipe ? `/fertigation/recipes/${recipe.recipeId}` : '/fertigation/recipes', {
    method: recipe ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe ? { ...input, expectedRevision: recipe.revision } : input),
  })
export const approveFertigationRecipe = (recipe: import('@spff/contracts').FertigationRecipe, approvalReference: string) =>
  request<import('@spff/contracts').FertigationRecipe>(`/fertigation/recipes/${recipe.recipeId}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: recipe.revision, approvalReference }),
  })
export const evaluateFertigationSite = (recipeId: string, deviceId: string) =>
  request<import('@spff/contracts').FertigationLiveDecision>('/fertigation/evaluate-site', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, deviceId }),
  })

export type SoilEcSessionView = {
  session_id: string; status: string; reason: string; cycles: number; total_on_ms: string;
  previous_ec: number | null; commands: Array<{cycle:number;status:string;operation:string}>;
}
export function fetchSoilEcPulseSessions(deviceId:string) {
  return request<{enabled:boolean;executionEnabled:boolean;automatic:{recipe_id:string;profile:import('@spff/contracts').SoilEcPulseProfile;armed:boolean;reason:string}|null;sessions:SoilEcSessionView[]}>(`/fertigation/pulse-sessions?deviceId=${encodeURIComponent(deviceId)}`)
}
export function startSoilEcPulseSession(input: import('@spff/contracts').StartSoilEcSession) {
  return request<SoilEcSessionView>('/fertigation/pulse-sessions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
}
export function stopSoilEcPulseSession(id:string) {
  return request<null>(`/fertigation/pulse-sessions/${encodeURIComponent(id)}/stop`,{method:'POST'})
}

export function releaseSoilEcPulseSession(id:string) {
  return request<null>(`/fertigation/pulse-sessions/${encodeURIComponent(id)}/release`,{method:'POST'})
}

export function fetchWaterInterlock(deviceId:string){
  return request<import('@spff/contracts').WaterInterlockView>(`/settings/water-interlock?deviceId=${encodeURIComponent(deviceId)}`,{signal:AbortSignal.timeout(15000)})
}

export function fetchSoilEcExecution(deviceId:string){
  return request<import('@spff/contracts').SoilEcExecutionView>(`/settings/soil-ec-execution?deviceId=${encodeURIComponent(deviceId)}`,{signal:AbortSignal.timeout(15000)})
}
export function saveSoilEcExecution(deviceId:string,expectedRevision:number,enabled:boolean){
  return request<import('@spff/contracts').SoilEcExecutionView>('/settings/soil-ec-execution',{
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,expectedRevision,enabled}),signal:AbortSignal.timeout(15000),
  })
}
export function saveWaterInterlock(deviceId:string,expectedRevision:number,enabled:boolean){
  return request<import('@spff/contracts').WaterInterlockView>('/settings/water-interlock',{
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,expectedRevision,enabled}),signal:AbortSignal.timeout(15000),
  })
}

export function saveSoilEcAutomaticProfile(input:import('@spff/contracts').StartSoilEcSession) {
 return request('/fertigation/automatic-profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
}

export const fetchFertigationProgress=(deviceId:string,recipeId?:string,signal?:AbortSignal)=>request<import('@spff/contracts').FertigationProgress>(`/fertigation/progress?deviceId=${encodeURIComponent(deviceId)}${recipeId?`&recipeId=${encodeURIComponent(recipeId)}`:''}`,{signal})

export function fetchProtocolGuide(cropId:string,signal?:AbortSignal){return request<ProtocolGuideState>(`/guide/${encodeURIComponent(cropId)}`,{signal})}
export function saveProtocolGuide(cropId:string,input:ProtocolGuideSave){return request<ProtocolGuideState>(`/guide/${encodeURIComponent(cropId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})}
export function fetchProtocolGuideHistory(cropId:string){return request<ProtocolGuideRevision[]>(`/guide/${encodeURIComponent(cropId)}/history`)}

export const fetchGuidePrograms=()=>request<import('@spff/contracts').GuideProgram[]>('/guide-programs');
export const previewGuideProgram=(config:import('@spff/contracts').GuideProgramConfig)=>request<import('@spff/contracts').GuideProgramPreview>('/guide-programs/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});
export const saveGuideProgram=(input:import('@spff/contracts').GuideProgramInput,existing?:import('@spff/contracts').GuideProgram)=>request<import('@spff/contracts').GuideProgram>(`/guide-programs${existing?`/${existing.programId}`:''}`,{method:existing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,...(existing?{expectedRevision:existing.revision}:{})})});
export const completeGuideProgram=(program:import('@spff/contracts').GuideProgram,activityId:string,note:string)=>request(`/guide-programs/${program.programId}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:program.revision,activityId,note})});

export const fetchGuideProgramHistory=(id:string)=>request<import('@spff/contracts').GuideProgramRevision[]>(`/guide-programs/${id}/history`);

export type AdaptiveProgressReport={activities:{activityId:string;targetMassG:number|null;estimatedDeliveredMassG:number;remainingMassG:number|null;requiresReconciliation:boolean;sessions:{status:string;reason:string|null;water_volume_l:number;fert_volume_l:number;command_snapshot:{targetEcUs:number;targetWaterVolumeL:number;targetFertVolumeL:number};last_telemetry:{timestamp:string;filteredEc:number;waterPump:boolean;fertPump:boolean}|null}[]}[]}
export const fetchGuideEcConversions=(id:string)=>request<import('@spff/contracts').GuideEcConversion[]>(`/guide-programs/${encodeURIComponent(id)}/ec-conversion`)
export const fetchAdaptiveProgress=(id:string)=>request<AdaptiveProgressReport>(`/adaptive-fertigation/programs/${encodeURIComponent(id)}/progress`)
export const saveGuideEcProfile=(id:string,input:import('@spff/contracts').GuideEcProfileInput)=>request<{revision:number}>(`/guide-programs/${encodeURIComponent(id)}/ec-profile`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})

// AI HST: observation and one authenticated SHADOW operator review (no pump dispatch).
export function fetchAiHstProposals(signal?: AbortSignal) {
  return request<import('@spff/contracts').AiHstProposals>('/unified-ai/hst/proposals', {signal})
}
export function reviewAiHstApproval(input: import('@spff/contracts').AiHstApprovalRequest) {
  return request<import('@spff/contracts').AiHstApprovalResult>('/unified-ai/hst/approvals', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input),
  })
}

// Read-only HST execution capability. Real pump dispatch is intentionally absent
// until the independent firmware/volume-session/ACK contract is verified.
export function fetchAiHstExecutionReadiness(signal?: AbortSignal) {
  return request<import('@spff/contracts').AiHstExecutionReadiness>('/unified-ai/hst/execution-readiness', {signal})
}

export function fetchAiHstRealPreflight(obligationId: string, signal?: AbortSignal) {
  return request<import('@spff/contracts').AiHstRealPreflight>(
    '/unified-ai/hst/real-preview/' + encodeURIComponent(obligationId), { signal })
}

export const fetchAiHstRealProfile=(programId:string,activityId:string,sourceRow:number)=>
 request<import('@spff/contracts').AiHstHardwareProfile|null>(
 '/unified-ai/hst/real-profile?'+new URLSearchParams({programId,activityId,sourceRow:String(sourceRow)}));
export const saveAiHstRealProfile=(input:import('@spff/contracts').AiHstHardwareProfile)=>
 request<{profile:import('@spff/contracts').AiHstHardwareProfile;verifiedAt:string}>('/unified-ai/hst/real-profile',
 {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
export const executeAiHstReal=(input:import('@spff/contracts').AiHstRealExecuteRequest)=>
 request<import('@spff/contracts').AiHstRealSessionSummary>('/unified-ai/hst/real-sessions',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
export const fetchAiHstRealSession=(id:string)=>
 request<import('@spff/contracts').AiHstRealSessionSummary>(
 '/unified-ai/hst/real-sessions/'+encodeURIComponent(id));
export const stopAiHstRealSession=(id:string,requestId:string)=>
 request<{commandId:string;status:string}>('/unified-ai/hst/real-sessions/'+encodeURIComponent(id)+'/stop',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId})});

export const fetchAiHstRealLatest=(obligationId:string)=>
 request<import('@spff/contracts').AiHstRealSessionSummary|null>(
 '/unified-ai/hst/real-sessions/latest/'+encodeURIComponent(obligationId));

export const fetchAiHstMode=(signal?:AbortSignal)=>
 request<import('@spff/contracts').AiHstMode>('/unified-ai/hst/mode',{signal});
export const setAiHstMode=(shadowEnabled:boolean)=>
 request<import('@spff/contracts').AiHstMode>('/unified-ai/hst/mode',{
 method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shadowEnabled}),
});


/** Existing Python conversion results; this GET never creates a plan or ACC. */
export function fetchAiHstLiquidSummary(signal?:AbortSignal){
 return request<{
  planning_status:'CURRENT'|'STALE'|'UNAVAILABLE';
  planning_recorded_at:string|null;
  tank_preview:{estimated_available_l:number|null;level_status:string;capacity_l?:number|null};
  fertilizer_tank_preview:{estimated_liquid_volume_l:number|null;level_status:string;capacity_l?:number|null};
  water_carryover:{status:string;remaining_for_reassessment_l:number|null;planning_date:string|null};
  irrigation_schedule_preview?:{status:string;tomorrow_at_least_l:number|null;fuzzy_demand_l:number|null};
  fuzzy_preview?:{illustrative_water_l:number|null;recorded_at:string|null;basis?:'SIMULATION_PROFILE'|'OPERATIONAL_PROFILE'}|null;
  operational_profile?:{status:'MISSING'|'REVIEW_REQUIRED'|'GUIDE_BOUND';version:string|null;target_water_l:number|null;calculation_ready:boolean;blockers:string[]};
 }>('/unified-ai/dashboard',{signal});
}



export type AiHstVolumePlan = {
 planId:string;
 validUntil:string;
 calculationReady:boolean;
 executionReady:boolean;
 recipe:{
  mode:'water_only'|'fertigation';
  product:string|null;
  sourceMethod:string;
  routeApprovalRequired:boolean;
  pastDue:boolean;
  waterUntilLowSeconds?:number|null;
  serverWater?:boolean;
  waterFirst?:boolean;
  hstPulse?:{onDurationMs:number};
  blockers:string[];
  recipe:{
   batchMassG:number;
   batchVolumeL:number|null;
   waterInventoryL:number;
   targetWaterL:number|null;
   targetStockL:number|null;
   plannedMassG:number|null;
   remainingAfterSessionG:number|null;
  };
 };
};

export type AiHstVolumeSession = {
 session_id:string;
 device_id:string;
 status:string;
 reason:string|null;
 product:string|null;
 water_volume_l:number;
 fert_volume_l:number;
 credited_g:number;
 evidence_verified:boolean;
 evidence_basis:string|null;
};

const aiHstVolumePath='/unified-ai/hst/dose-volume';
function aiHstVolumePost<T>(path:string,input:unknown){
 return request<T>(aiHstVolumePath+path,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),
 });
}

export const fetchAiHstVolumeSessions=(signal?:AbortSignal)=>
 request<AiHstVolumeSession[]>(aiHstVolumePath+'/sessions',{signal});
export const executeAiHstVolumePlan=(input:import('@spff/contracts').DoseVolumePlanRequest)=>
 aiHstVolumePost<AiHstVolumePlan>('/plans',input);
export const executeAiHstVolumeApproval=(input:{
 planId:string;approvalId:string;preparedBatchConfirmed:true;confirmApplicationRoute:boolean;confirmPastDue:boolean;
})=>aiHstVolumePost<AiHstVolumeSession>('/approvals',input);
export const stopAiHstVolumeSession=(id:string,requestId:string)=>
 aiHstVolumePost('/sessions/'+encodeURIComponent(id)+'/stop',{requestId});
