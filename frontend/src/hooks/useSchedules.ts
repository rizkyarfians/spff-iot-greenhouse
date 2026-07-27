import { useEffect, useState } from 'react';
import type { Schedule } from '../types';

export function useSchedules(initial: Schedule[] = []) {
  const [schedules, setSchedules] = useState(initial);
  useEffect(() => { setSchedules(initial); }, [initial]);
  return schedules;
}
