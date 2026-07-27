import { useState } from 'react';
import { dashboardService } from '../services/dashboardService';
import type { Pump } from '../types';

export function usePumpControl(onUpdated: (pump: Pump) => void, notify: (message: string, kind: 'success' | 'error') => void) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const update = async (pump: Pump, isActive: boolean) => {
    if (pendingId) return;
    setPendingId(pump.id);
    onUpdated({ ...pump, isActive, state: 'processing' });
    try {
      const saved = await dashboardService.updatePump(pump.id, isActive);
      onUpdated(saved); notify(`${pump.name} berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
    } catch {
      onUpdated(pump); notify(`Kontrol ${pump.name} gagal. Status dikembalikan.`, 'error');
    } finally { setPendingId(null); }
  };
  return { pendingId, update };
}
