import {hstIrrigationDisplay} from './hstIrrigationSummary';
import { useCallback, useEffect, useState } from 'react';
import { canReviewShadow, type HstOperatorMode } from './hstExecutionMode';
import { CalendarCheck2, CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import type { AiHstApprovalResult, AiHstProposal, AiHstProposals } from '@spff/contracts';
import { fetchAiHstLiquidSummary, fetchAiHstProposals, reviewAiHstApproval, fetchAiHstMode, setAiHstMode } from './api';
import {useAuth} from './authContext';
import {HstDoseVolumeCard,HstDoseVolumeSessions,HstWaterVolumeControl} from './HstDoseVolumeCard';
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
  const {user}=useAuth();
  const [liquidData,setLiquidData]=useState<Awaited<ReturnType<typeof fetchAiHstLiquidSummary>>|null>(null);
  const [liquidError,setLiquidError]=useState('');
  const [data, setData] = useState<AiHstProposals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [review, setReview] = useState<AiHstApprovalResult | null>(null);
  const [mode, setMode] = useState<HstOperatorMode>('SHADOW');
  const [modeReady,setModeReady]=useState(false);
  const [modeSaving,setModeSaving]=useState(false);
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
    void fetchAiHstMode(controller.signal)
      .then(value=>{if(!controller.signal.aborted){setMode(value.shadowEnabled?'SHADOW':'TEST_REAL');setModeReady(true);}})
      .catch(()=>{if(!controller.signal.aborted){setMode('SHADOW');setModeReady(false);}});
    void refresh(controller.signal);
    // Refresh the UI, not the AI decision. Scheduler persists only HST events.
    const interval = setInterval(() => { void refresh(controller.signal); }, 300000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [refresh]);

  useEffect(()=>{
    const controller=new AbortController();
    let pending=false;
    async function refreshLiquid(){
      if(pending)return;
      pending=true;
      try{
        const result=await fetchAiHstLiquidSummary(controller.signal);
        if(!controller.signal.aborted){setLiquidData(result);setLiquidError('');}
      }catch(cause){
        if(!controller.signal.aborted){
          setLiquidData(null);
          setLiquidError(cause instanceof Error?cause.message:'Hasil konversi larutan belum tersedia.');
        }
      }finally{pending=false;}
    }
    void refreshLiquid();
    const timer=setInterval(()=>void refreshLiquid(),15000);
    return()=>{controller.abort();clearInterval(timer);};
  },[]);

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

  const liquidLitres=(value:number|null|undefined)=>
    typeof value==='number'&&Number.isFinite(value)&&value>=0?number.format(value)+' L':'Belum tersedia';
  const liquidCurrent=liquidData?.planning_status==='CURRENT';
  const waterLitres=liquidCurrent&&liquidData?.tank_preview?.level_status==='ESTIMATED'
    ?liquidData.tank_preview.estimated_available_l:null;
  const stockLitres=liquidCurrent&&liquidData?.fertilizer_tank_preview?.level_status==='ESTIMATED'
    ?liquidData.fertilizer_tank_preview.estimated_liquid_volume_l:null;
  const irrigation=hstIrrigationDisplay(liquidData);

  return (
    <article className="ain-panel hst-panel" aria-label="Usulan pemupukan berbasis HST">
      <div className="ain-panel-heading">
        <h3><CalendarCheck2 size={18} /> Usulan Pemupukan HST</h3>
        <span>{mode === 'SHADOW' ? 'SHADOW MODE ON' : 'SHADOW MODE OFF'}</span>
      </div>
      <section aria-label="Sisa larutan dalam liter">
        <div className="hst-figures" aria-live="polite">
          <div><small>Sisa air di tandon</small><strong>{liquidLitres(waterLitres)}</strong></div>
          <div><small>Sisa larutan di tandon pupuk</small><strong>{liquidLitres(stockLitres)}</strong></div>
          <div><small>{irrigation.label}</small><strong>{liquidLitres(irrigation.valueL)}</strong></div>
        </div>
        <small>Volume tandon memakai hasil konversi AI yang sudah tersedia. {irrigation.note}</small>
        {liquidData?.planning_recorded_at&&<p className="hst-note">Data tandon: {new Date(liquidData.planning_recorded_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB</p>}
        {liquidError&&<p role="status" className="hst-note">{liquidError}</p>}
        {!liquidError&&liquidData&&(waterLitres===null||stockLitres===null)&&<p className="hst-note">Volume tandon menunggu hasil konversi dari sensor yang valid dan terbaru.</p>}
      </section>
      {!!data?.proposals.length&&<section className="hst-needs" aria-label="Sisa kebutuhan pupuk tanaman">
        <strong>Sisa kebutuhan tanaman</strong>
        <div className="hst-needs-list">{data.proposals.map(proposal=><div key={proposal.obligation_id}>
          <small>{proposal.product??'Pupuk'} · HST {proposal.hst??'—'}</small>
          <strong>{mass(proposal.status!=='REQUIRES_REVIEW'&&proposal.review_reasons.length===0?proposal.remaining_g:null)}</strong>
        </div>)}</div>
      </section>}
      <div className="hst-shadow-mode-row">
        <div className="hst-shadow-mode-label">
          <strong>SHADOW MODE</strong>
          <small>{mode === 'SHADOW'
            ? 'ON · AI menghitung, ACC tidak menjalankan pompa'
            : 'OFF · ACC dapat menjalankan sesi pompa real jika perangkat siap'}</small>
        </div>
        <button type="button" role="switch" aria-label="SHADOW MODE"
          aria-checked={mode === 'SHADOW'}
          className={`hst-shadow-toggle ${mode === 'SHADOW' ? 'is-on' : 'is-off'}`}
          disabled={!modeReady||modeSaving||user.role!=='admin'}
          onClick={() => {
            if(!modeReady||modeSaving||user.role!=='admin')return;
            setModeSaving(true);
            setError('');
            void setAiHstMode(mode !== 'SHADOW').then(next=>{
              setMode(next.shadowEnabled?'SHADOW':'TEST_REAL');
              setConfirmId(null);
              setReview(null);
            }).catch(cause=>{
              setError(cause instanceof Error?cause.message:'Gagal mengubah SHADOW MODE.');
            }).finally(()=>setModeSaving(false));
          }}>
          <span className="hst-shadow-toggle-track" aria-hidden="true">
            <span className="hst-shadow-toggle-thumb" />
          </span>
          <strong>{mode === 'SHADOW' ? 'ON' : 'OFF'}</strong>
        </button>
      </div>
      {!modeReady && <p role="alert" className="hst-review">Mode SHADOW server tidak tersedia: switch terkunci ON demi keamanan.</p>}
      {modeReady&&user.role!=='admin' && <small>Hanya admin dapat mengubah SHADOW MODE.</small>}
      {!previewOnly && <HstDoseVolumeSessions refreshProposals={refresh}/>}
      {modeReady && mode === 'TEST_REAL' && !previewOnly && <HstWaterVolumeControl/>}
      <p className="hst-note">
        {mode === 'SHADOW'
          ? 'Usulan dibuat dari jadwal HST. Sensor tandon dan Soil 2 diperiksa setelah ACC. Tidak ada perintah pompa dalam mode SHADOW.'
          : 'SHADOW OFF: ACC menjalankan sesi fertigasi fisik sesuai hasil AI HST apabila semua syarat perangkat terpenuhi.'}
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
                <div><small>Tercatat diberikan</small><strong>{mass(proposal.delivered_g)}</strong></div>
                <div className="hst-remaining-need"><small>Sisa kebutuhan</small><strong>{mass(proposal.status!=='REQUIRES_REVIEW'&&proposal.review_reasons.length===0?proposal.remaining_g:null)}</strong></div>
              </div>
              {modeReady && mode === 'TEST_REAL' && !previewOnly &&
                <HstDoseVolumeCard proposal={proposal}/>}
              <HstRealExecutionCard shadowEnabled proposal={proposal}
                preflight={null} preflightError={null} refreshPreflight={()=>{}}/>
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
      {mode === 'SHADOW' && review && <div className="hst-result" role="status">
        <strong><ShieldAlert size={16} /> Review ACC tercatat, eksekusi tetap BLOCKED</strong>
        <p>Sensor diperiksa pada saat ACC. Pompa tidak dinyalakan dan dosis belum dikreditkan.</p>
        <p>Alasan: {review.hold_reasons.join(', ').replaceAll('_', ' ')}</p>
      </div>}
    </article>
  );
}
