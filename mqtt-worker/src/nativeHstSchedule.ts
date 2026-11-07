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
  return !!start && start.status==='failed' &&
    start.water_status==='rejected' && start.fert_status==='rejected' &&
    start.water_reason==='automatic_mode' && start.fert_reason==='automatic_mode' &&
    start.water_expires instanceof Date && start.fert_expires instanceof Date &&
    heartbeatAt>=start.water_expires && heartbeatAt>=start.fert_expires && !start.retried;
}
