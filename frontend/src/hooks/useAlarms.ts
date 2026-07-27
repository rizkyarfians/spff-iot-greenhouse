import { useCallback, useEffect, useState } from 'react';
import { dashboardService } from '../services/dashboardService';
import type { Alarm } from '../types';

export function useAlarms(initial: Alarm[] = []) {
  const [alarms, setAlarms] = useState(initial);
  const refresh = useCallback(() => dashboardService.alarms().then(setAlarms), []);
  useEffect(() => { setAlarms(initial); }, [initial]);
  return { alarms, refresh };
}
