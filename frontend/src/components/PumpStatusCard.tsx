import { LoaderCircle, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePumpControl } from '../hooks/usePumpControl';
import type { Pump, PumpState } from '../types';
import { formatTime } from '../utils/format';
import { ConfirmationDialog } from './Overlay';
import { EmptyState } from './Feedback';
import { useToast } from './ToastProvider';

const stateLabel: Record<PumpState, string> = { active: 'Aktif', inactive: 'Tidak Aktif', processing: 'Memproses', offline: 'Offline', fault: 'Gangguan' };

export function PumpToggle({ pump, pending, onRequest }: { pump: Pump; pending: boolean; onRequest: (pump: Pump) => void }) {
  const disabled = pending || pump.state === 'offline' || pump.state === 'fault';
  return <button role="switch" aria-checked={pump.isActive} aria-label={`${pump.isActive ? 'Nonaktifkan' : 'Aktifkan'} ${pump.name}`} disabled={disabled} className={`switch ${pump.isActive ? 'on' : ''}`} onClick={() => onRequest(pump)}>{pending ? <LoaderCircle className="spinner" size={14} /> : <span />}</button>;
}

export function PumpStatusCard({ initialPumps, onDetail }: { initialPumps: Pump[]; onDetail: () => void }) {
  const [pumps, setPumps] = useState(initialPumps);
  const [selected, setSelected] = useState<Pump | null>(null);
  const notify = useToast();
  const { pendingId, update } = usePumpControl((updated) => setPumps((current) => current.map((item) => item.id === updated.id ? updated : item)), notify);
  useEffect(() => { if (!pendingId) setPumps(initialPumps); }, [initialPumps, pendingId]);
  const confirm = () => { if (selected) void update(selected, !selected.isActive); setSelected(null); };
  return <section className="card pump-card" aria-labelledby="pump-title"><div className="panel-heading"><h2 id="pump-title">Status Pompa</h2><button className="text-button" onClick={onDetail}>Lihat Detail</button></div>{pumps.length === 0 ? <EmptyState message="Belum ada pompa terdaftar." /> : <div className="pump-list">{pumps.map((pump) => <article className="pump-row" key={pump.id}><div className={`pump-icon state-${pump.state}`}><Radio /></div><div className="pump-info"><h3>{pump.name}</h3><div className="pump-meta"><span>Durasi aktif <b>{pump.activeDuration}</b></span><span>Update {formatTime(pump.updatedAt)}</span></div></div><div className="pump-action"><span className={`state-text state-${pump.state}`}>{pendingId === pump.id ? 'Memproses' : stateLabel[pump.state]}</span><PumpToggle pump={pump} pending={pendingId === pump.id} onRequest={setSelected} /></div></article>)}</div>}<ConfirmationDialog open={Boolean(selected)} title={`${selected?.isActive ? 'Nonaktifkan' : 'Aktifkan'} pompa?`} description={`Pastikan kondisi greenhouse aman sebelum ${selected?.name ?? 'pompa'} diubah.`} confirmLabel={selected?.isActive ? 'Nonaktifkan' : 'Aktifkan'} onConfirm={confirm} onClose={() => setSelected(null)} /></section>;
}
