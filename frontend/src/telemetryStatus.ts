export type TelemetryFreshness =
  | 'waiting'
  | 'fresh'
  | 'stale'
  | 'expired'


const staleAfterSeconds = 120
const expiredAfterSeconds = 600


export function getTelemetryFreshness(
  recordedAt: string | null | undefined,
  hasData: boolean,
  now = Date.now(),
): TelemetryFreshness {
  if (!hasData || !recordedAt) {
    return 'waiting'
  }


  const recordedTime =
    Date.parse(recordedAt)


  if (!Number.isFinite(recordedTime)) {
    return 'waiting'
  }


  const ageSeconds =
    Math.max(
      0,
      (now - recordedTime) / 1000,
    )


  if (ageSeconds < staleAfterSeconds) {
    return 'fresh'
  }


  if (ageSeconds < expiredAfterSeconds) {
    return 'stale'
  }


  return 'expired'
}


export function formatTelemetryAge(
  recordedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!recordedAt) {
    return null
  }


  const recordedTime =
    Date.parse(recordedAt)


  if (!Number.isFinite(recordedTime)) {
    return null
  }


  const ageSeconds =
    Math.max(
      0,
      Math.floor(
        (now - recordedTime) / 1000,
      ),
    )


  if (ageSeconds < 60) {
    return `${ageSeconds} detik lalu`
  }


  if (ageSeconds < 3600) {
    return `${Math.floor(ageSeconds / 60)} menit lalu`
  }


  if (ageSeconds < 86400) {
    return `${Math.floor(ageSeconds / 3600)} jam lalu`
  }


  return `${Math.floor(ageSeconds / 86400)} hari lalu`
}
