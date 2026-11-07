import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck2, RefreshCw } from 'lucide-react';
import type { AiHstProposal, AiHstProposals } from '@spff/contracts';
import { fetchAiHstLiquidSummary, fetchAiHstProposals } from './api';
import { hstIrrigationDisplay } from './hstIrrigationSummary';
import { HstDoseVolumeSessions } from './HstDoseVolumeCard';
import './HstApprovalPanel.css';

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const litres = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? number.format(value) + ' L' : 'Belum tersedia';
const mass = (value: number | null) =>
  value === null || !Number.isFinite(value) ? 'Perlu verifikasi' : number.format(value / 1000) + ' kg';
const statuses: Record<AiHstProposal['status'], string> = {
  WAITING_APPROVAL: 'Belum tercatat diberikan',
  PARTIAL_WAITING_APPROVAL: 'Sebagian tercatat',
  COMPLETED: 'Selesai',
  REQUIRES_REVIEW: 'Data perlu diperiksa',
};

export function HstApprovalPanel() {
  const [section, setSection] = useState<'watering' | 'fertilizer' | null>(null);
  const [data, setData] = useState<AiHstProposals | null>(null);
  const [liquid, setLiquid] = useState<Awaited<ReturnType<typeof fetchAiHstLiquidSummary>> | null>(null);
  const [error, setError] = useState('');
  const [liquidError, setLiquidError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await fetchAiHstProposals(signal);
      if (!signal?.aborted) { setData(next); setError(''); }
    } catch {
      if (!signal?.aborted) { setData(null); setError('Estimasi pupuk belum tersedia.'); }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 300000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function update() {
      if (pending) return;
      pending = true;
      try {
        const next = await fetchAiHstLiquidSummary(controller.signal);
        if (!controller.signal.aborted) { setLiquid(next); setLiquidError(''); }
      } catch {
        if (!controller.signal.aborted) { setLiquid(null); setLiquidError('Estimasi air belum tersedia.'); }
      } finally { pending = false; }
    }
    void update();
    const timer = setInterval(() => void update(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  const current = liquid?.planning_status === 'CURRENT';
  const water = current && liquid?.tank_preview.level_status === 'ESTIMATED'
    ? liquid.tank_preview.estimated_available_l : null;
  const stock = current && liquid?.fertilizer_tank_preview.level_status === 'ESTIMATED'
    ? liquid.fertilizer_tank_preview.estimated_liquid_volume_l : null;
  const irrigation = hstIrrigationDisplay(liquid);

  return <article className="ain-panel hst-panel" aria-label="Estimasi air dan pupuk">
    <div className="ain-panel-heading"><h3><CalendarCheck2 size={18} /> Estimasi air dan pupuk</h3></div>
    <nav className="hst-guide-nav" aria-label="Bagian Panduan">
      {(['watering', 'fertilizer'] as const).map(value => <button type="button" key={value}
        className={section === value ? 'hst-approve' : 'hst-refresh'}
        aria-expanded={section === value} aria-controls={'guide-' + value}
        onClick={() => setSection(previous => previous === value ? null : value)}>
        {value === 'watering' ? 'Estimasi air' : 'Kebutuhan pupuk HST'}
      </button>)}
      <button type="button" className="hst-refresh" onClick={() =>
        document.getElementById('guide-table-heading')?.scrollIntoView({ block: 'start' })}>Jadwal</button>
    </nav>
    <section className="hst-inventory" aria-label="Isi tandon">
      <div className="hst-figures">
        <div><small>Isi tandon air</small><strong>{litres(water)}</strong></div>
        <div><small>Isi tandon pupuk</small><strong>{litres(stock)}</strong></div>
        <div><small>{irrigation.label}</small><strong>{litres(irrigation.valueL)}</strong></div>
      </div>
    </section>
    <HstDoseVolumeSessions refreshProposals={refresh} />
    <section id="guide-watering" className="hst-guide-section" hidden={section !== 'watering'}>
      <h4>Estimasi kebutuhan air</h4>
      {liquidError ? <p role="status">{liquidError}</p> : <>
        <p>{litres(irrigation.valueL)}</p>
        <small>{irrigation.note}</small>
      </>}
    </section>
    <section id="guide-fertilizer" className="hst-guide-section" hidden={section !== 'fertilizer'}>
      <div className="hst-guide-section-heading">
        <h4>Kebutuhan pupuk per HST</h4>
        <button type="button" className="hst-refresh" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={15} /> {loading ? 'Memuat…' : 'Perbarui'}
        </button>
      </div>
      {error && <p role="status">{error}</p>}
      {data?.proposals.length === 0 && <p>Belum ada kebutuhan pupuk jatuh tempo.</p>}
      <div className="hst-cards">{data?.proposals.map(proposal => <section className="hst-card" key={proposal.obligation_id}>
        <div className="hst-card-title">
          <strong>{proposal.product ?? 'Pupuk'} · HST {proposal.hst ?? '—'}</strong>
          <span>{statuses[proposal.status]}</span>
        </div>
        <small>Jadwal {proposal.due_date ?? 'belum tersedia'}</small>
        <div className="hst-figures">
          <div className="hst-remaining-need"><small>Sisa kebutuhan</small><strong>
            {mass(proposal.status !== 'REQUIRES_REVIEW' && proposal.review_reasons.length === 0 ? proposal.remaining_g : null)}
          </strong></div>
          <div><small>Target</small><strong>{mass(proposal.target_g)}</strong></div>
          <div><small>Sudah diberikan</small><strong>{mass(proposal.delivered_g)}</strong></div>
        </div>
      </section>)}</div>
    </section>
  </article>;
}
