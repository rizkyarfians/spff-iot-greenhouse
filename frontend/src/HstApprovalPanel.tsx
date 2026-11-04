import { useCallback, useEffect, useState } from 'react';
import { canReviewShadow, type HstOperatorMode } from './hstExecutionMode';
import { CalendarCheck2, CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import type { AiHstApprovalResult, AiHstProposal, AiHstProposals } from '@spff/contracts';
import { fetchAiHstExecutionReadiness, fetchAiHstProposals, fetchAiHstRealPreflight, reviewAiHstApproval } from './api';
import type { AiHstExecutionReadiness, AiHstRealPreflight } from '@spff/contracts';
import { HstRealExecutionCard } from './HstRealExecutionCard';
import './HstApprovalPanel.css';

const previewOnly = import.meta.env.DEV && import.meta.env.VITE_SPFF_AI_PREVIEW === 'true';

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const mass = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? 'Perlu verifikasi' : number.format(n / 1000) + ' kg';

function newApprovalId(): string {
  // No Math.random fallback for an idempotency identifier.
  if (!globalThis.crypto?.getRandomValues) throw new Error('WebCrypto tidak tersedia untuk ACC.');
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function HstApprovalPanel() {
  const [data, setData] = useState<AiHstProposals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [review, setReview] = useState<AiHstApprovalResult | null>(null);
  const [mode, setMode] = useState<HstOperatorMode>('SHADOW');
  const [readiness, setReadiness] = useState<AiHstExecutionReadiness | null>(null);
  const [realPreflights, setRealPreflights] = useState<Record<string, AiHstRealPreflight>>({});
  const [realPreflightErrors, setRealPreflightErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchAiHstProposals(signal);
      if (signal?.aborted) return;
      setData(next);
      setError('');
    } catch (cause) {
      if (signal?.aborted) return;
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Usulan HST tidak tersedia.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAiHstExecutionReadiness(controller.signal)
      .then(result => { if (!controller.signal.aborted) setReadiness(result); })
      .catch(() => { if (!controller.signal.aborted) setReadiness(null); });
    void refresh(controller.signal);
    // Refresh the UI, not the AI decision. Scheduler persists only HST events.
    const interval = setInterval(() => { void refresh(controller.signal); }, 300000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [refresh]);

  useEffect(() => {
    if (mode !== 'TEST_REAL' || !data?.proposals.length) return;
    const controller = new AbortController();
    setRealPreflights({});
    setRealPreflightErrors({});
    for (const proposal of data.proposals) {
      void fetchAiHstRealPreflight(proposal.obligation_id, controller.signal)
        .then(next => {
          if (!controller.signal.aborted) setRealPreflights(prev => ({
            ...prev, [proposal.obligation_id]: next,
          }));
        }).catch(cause => {
          if (!controller.signal.aborted) setRealPreflightErrors(prev => ({
            ...prev,
            [proposal.obligation_id]: cause instanceof Error
              ? cause.message : 'Tidak dapat memeriksa kesiapan sesi.',
          }));
        });
    }
    return () => { controller.abort(); };
  }, [mode, data]);

  async function approve(proposal: AiHstProposal) {
    if (mode !== 'SHADOW' || previewOnly || pendingId || confirmId !== proposal.obligation_id || proposal.status === 'COMPLETED' ||
        proposal.status === 'REQUIRES_REVIEW' || proposal.remaining_g === null ||
        proposal.remaining_g <= 0) return;
    setPendingId(proposal.obligation_id);
    setError('');
    setReview(null);
    try {
      const result = await reviewAiHstApproval({
        obligationId: proposal.obligation_id,
        approvalId: newApprovalId(),
        expectedRemainingG: proposal.remaining_g,
        confirmation: 'REVIEW_HST_SHADOW_SESSION',
      });
      setReview(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ACC tidak bisa dicatat.');
    } finally {
      setConfirmId(null);
      setPendingId(null);
    }
  }

  return (
    <article className="ain-panel hst-panel" aria-label="Usulan pemupukan berbasis HST">
      <div className="ain-panel-heading">
        <h3><CalendarCheck2 size={18} /> Usulan Pemupukan HST</h3>
        <span>{mode === 'SHADOW' ? 'SHADOW · ACC per sesi' : 'TEST REAL · BELUM DIAKTIFKAN'}</span>
      </div>
      <div className="hst-mode-selector" role="group" aria-label="Pilihan mode pengujian HST">
        <button type="button" className={mode === 'SHADOW' ? 'is-selected' : ''}
          aria-pressed={mode === 'SHADOW'}
          onClick={() => { setMode('SHADOW'); setConfirmId(null); setReview(null); }}>
          <ShieldAlert size={16} /> SHADOW
        </button>
        <button type="button" className={mode === 'TEST_REAL' ? 'is-selected is-real' : ''}
          aria-pressed={mode === 'TEST_REAL'}
          onClick={() => { setMode('TEST_REAL'); setConfirmId(null); setReview(null); }}>
          <ClipboardCheck size={16} /> TEST POMPA REAL
        </button>
      </div>
      {mode === 'TEST_REAL' && <div className="hst-real-readiness" role="status">
        <strong>{readiness?.realTest.ready?'TEST REAL: periksa kesiapan sesi sebelum ACC':'TEST REAL: dispatch belum aktif pada server'}</strong>
        <p>Setelah ACC operator dan seluruh preflight lolos, hasil perhitungan AI
          HST disimpan sebagai sesi adaptif dan diteruskan ke ESP32. Status
          dilacak melalui ACK dan telemetry asli. Pindah mode tidak menyalakan pompa.</p>
        {readiness?.realTest.blockers.map(blocker =>
          <small key={blocker}>{blocker.replaceAll('_', ' ')}</small>)}
        {!readiness && <small>Status kesiapan backend tidak tersedia; default aman: diblokir.</small>}
      </div>}
      <p className="hst-note">
        {mode === 'SHADOW'
          ? 'Usulan dibuat dari jadwal HST. Sensor tandon dan Soil 2 diperiksa setelah ACC. Tidak ada perintah pompa dalam mode SHADOW.'
          : 'TEST REAL ditujukan untuk eksekusi setelah ACC dan preflight perangkat, bukan mengaktifkan relay saat berpindah mode.'}
      </p>
      {previewOnly && <p className="hst-review" role="note">
        <ShieldAlert size={16} /> Mode preview tidak memiliki login operator; ACC HST hanya tersedia
        melalui API operasional yang menerapkan autentikasi dan CSRF.
      </p>}
      <button className="hst-refresh" type="button" onClick={() => { setLoading(true); void refresh(); }}>
        <RefreshCw size={15} /> Perbarui usulan
      </button>
      {loading && !data && <p role="status">Memuat kewajiban HST…</p>}
      {error && <p role="alert" className="ain-acc-error">{error}</p>}
      {data?.proposals.length === 0 && <p className="hst-empty">
        Tidak ada pemupukan jatuh tempo atau kewajiban yang sedang dicatat oleh AI HST.
      </p>}
      <div className="hst-cards">
        {data?.proposals.map(proposal => {
          const canApprove = canReviewShadow({
            mode,
            previewOnly,
            status: proposal.status,
            remainingG: proposal.remaining_g,
          });
          return (
            <section key={proposal.obligation_id} className="hst-card">
              <div className="hst-card-title">
                <strong>{proposal.product ?? 'Produk belum terverifikasi'} · HST {proposal.hst ?? '—'}</strong>
                <span>{proposal.status.replaceAll('_', ' ')}</span>
              </div>
              <small>Jadwal {proposal.due_date ?? 'belum tersedia'} · {proposal.activity_id}</small>
              <div className="hst-figures">
                <div><small>Target</small><strong>{mass(proposal.target_g)}</strong></div>
                <div><small>Terpenuhi</small><strong>{mass(proposal.delivered_g)}</strong></div>
                <div><small>Sisa</small><strong>{mass(proposal.remaining_g)}</strong></div>
              </div>
              {mode === 'TEST_REAL' && <HstRealExecutionCard
                proposal={proposal}
                preflight={realPreflights[proposal.obligation_id]??null}
                preflightError={realPreflightErrors[proposal.obligation_id]??null}
                refreshPreflight={() => {
                  void fetchAiHstRealPreflight(proposal.obligation_id)
                   .then(next=>setRealPreflights(prev=>({...prev,[proposal.obligation_id]:next})))
                   .catch(cause=>setRealPreflightErrors(prev=>({
                     ...prev,[proposal.obligation_id]:cause instanceof Error?cause.message:'Gagal cek kesiapan',
                   })));
                }}
              />}
              {proposal.review_reasons.length > 0 &&
                <p className="hst-review"><ShieldAlert size={16} />
                  Perlu rekonsiliasi: {proposal.review_reasons.join(', ').replaceAll('_', ' ')}
                </p>}
              {mode === 'SHADOW' && (proposal.status === 'COMPLETED' ?
                <p className="hst-success"><CheckCircle2 size={16} /> Kewajiban selesai</p> :
                <label className="hst-confirm">
                  <input type="checkbox" disabled={!canApprove || !!pendingId}
                    checked={confirmId === proposal.obligation_id}
                    onChange={event => setConfirmId(event.target.checked ? proposal.obligation_id : null)}/>
                  Saya meninjau sisa dosis dan ingin memeriksa sesi ini. ACC berikutnya harus diberikan ulang.
                </label>)}
              {mode === 'SHADOW' && <button type="button" className="hst-approve"
                disabled={!canApprove || confirmId !== proposal.obligation_id || !!pendingId}
                onClick={() => { void approve(proposal); }}>
                <ClipboardCheck size={16} />
                {pendingId === proposal.obligation_id ? 'Memeriksa sensor…' : 'ACC & Periksa Sesi (SHADOW)'}
              </button>}
              <small>Review tercatat: {proposal.approval_count} · Belum ada bukti dosis dari ACC saja.</small>
            </section>
          );
        })}
      </div>
      {review && <div className="hst-result" role="status">
        <strong><ShieldAlert size={16} /> Review ACC tercatat, eksekusi tetap BLOCKED</strong>
        <p>Sensor diperiksa pada saat ACC. Pompa tidak dinyalakan dan dosis belum dikreditkan.</p>
        <p>Alasan: {review.hold_reasons.join(', ').replaceAll('_', ' ')}</p>
      </div>}
    </article>
  );
}
