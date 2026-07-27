import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardService } from '../services/dashboardService';
import type { DashboardData } from '../types';

export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await dashboardService.dashboard();
      if (mounted.current) { setData(next); setError(''); }
    } catch { if (mounted.current) setError('Data dashboard belum dapat dimuat.'); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(true); }, 10_000);
    return () => { mounted.current = false; window.clearInterval(id); };
  }, [load]);
  return { data, loading, error, retry: load };
}
