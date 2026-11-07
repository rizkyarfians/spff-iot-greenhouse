import type {ScheduleExecutionAuthority, ScheduleSyncMessage} from '@spff/contracts';

export const hstScheduleId = (startId: string, target: string) =>
  `hst-${startId}-${target === 'pump_water' ? 'water' : 'fert'}`;

export type NativeHstSchedule = {site_id:string;device_id:string;start_id:string;run_date:string};

/** Real server-authority schedule registrations, acknowledged before any HST ON.
 * They authorize HST during its application day; the existing firmware owns OFF.
 * Never publish these registrations under device authority (which executes timers).
 */
export function nativeHstSchedules(rows: NativeHstSchedule[], authority: ScheduleExecutionAuthority,
  site: string, device: string): ScheduleSyncMessage['schedules'] {
  if (authority !== 'server') return [];
  return rows.filter(row=>row.site_id===site&&row.device_id===device).flatMap(row=>
    (['pump_water','pump_fert'] as const).map(target=>({
      scheduleId:hstScheduleId(row.start_id,target),targetId:target,
      onTime:'00:00:00',offTime:'23:59:59',repeatRule:'once' as const,
      runDate:row.run_date,timezone:'Asia/Jakarta',enabled:true,
    })));
}

export function retryableModeRejection(start: Record<string, any> | null, heartbeatAt: Date): boolean {
  if(!start || start.status!=='failed' || !(start.water_expires instanceof Date) ||
    !(start.fert_expires instanceof Date) || heartbeatAt<start.water_expires || heartbeatAt<start.fert_expires) return false;
  const rejectedMode=start.water_status==='rejected' && start.fert_status==='rejected' &&
    start.water_reason==='automatic_mode' && start.fert_reason==='automatic_mode' && !start.retried;
  const unpublishedAuthorityTimeout=start.native_schedule===true && start.sync_authority==='device' &&
    start.water_status==='timed_out' && start.fert_status==='timed_out' &&
    start.water_reason==='command_expired' && start.fert_reason==='command_expired' &&
    start.water_published===null && start.fert_published===null && !start.authority_retried;
  return rejectedMode || unpublishedAuthorityTimeout;
}
