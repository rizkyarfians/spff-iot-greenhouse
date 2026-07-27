import { useEffect, useState } from 'react';
import { dashboardService } from '../services/dashboardService';
import type { HistoryPoint, SensorType } from '../types';

export function useSensorHistory(type: SensorType) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    dashboardService.history(type).then((value) => { if (active) { setData(value); setError(''); } })
      .catch(() => { if (active) setError('Riwayat sensor gagal dimuat.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [type]);
  return { data, loading, error };
}
