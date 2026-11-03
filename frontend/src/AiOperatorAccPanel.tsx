import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, ShieldAlert } from 'lucide-react';
import type { AiOperatorAccResult, AiAccTrialStatus, UnifiedAiDashboard, AiExecutionMode, AiExecutionModeState } from '@spff/contracts';
import { checkAiOperatorAccDryRun, fetchAiAccPreparation, startAiAccWaterTrial, fetchAiAccWaterTrialStatus, requestAiAccWaterTrialStop, fetchAiExecutionMode, updateAiExecutionMode } from './api';
import './AiOperatorAccPanel.css';

const previewOnly = import.meta.env.DEV && import.meta.env.VITE_SPFF_AI_PREVIEW === 'true';

// Local-browser UUID without Math.random; WebCrypto getRandomValues also works on LAN HTTP.
function createCommandId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}

export function AiOperatorAccPanel({ report }: { report: UnifiedAiDashboard | null }) {
  const action = report?.decision.proposed_action;
  const canReview = action === 'IRRIGATE' || action === 'FERTIGATE';
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AiOperatorAccResult | null>(null);
  const [previewReasons, setPreviewReasons] = useState<string[] | null>(null);
  const [physicalConfirmed, setPhysicalConfirmed] = useState(false);
  const [trialCapL, setTrialCapL] = useState(1);
  const [durationSec, setDurationSec] = useState(10);
  const [liveCommandId, setLiveCommandId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<AiAccTrialStatus | null>(null);
  const [livePending, setLivePending] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  // This setting is device-scoped and persisted in local PostgreSQL.
  const deviceId = 'esp32-s3-01';
  const [aiMode, setAiMode] = useState<AiExecutionModeState | null>(null);
  const [chosenAiMode, setChosenAiMode] = useState<AiExecutionMode>('shadow');
  const [aiModeError, setAiModeError] = useState('');
  const [savingAiMode, setSavingAiMode] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  async function refreshAiMode() {
    if (previewOnly) return;
    try {
      const response = await fetchAiExecutionMode(deviceId);
      setAiMode(response);
      setChosenAiMode(response.mode);
      setAiModeError('');
      setConfirmLive(false);
    } catch (cause) {
      setAiMode(null); // fail closed
      setAiModeError(cause instanceof Error ? cause.message : 'Mode AI tidak dapat dibaca.');
    }
  }

  useEffect(() => {
    if (previewOnly) return;
    let active = true;
    void fetchAiExecutionMode(deviceId)
      .then(response => {
        if (!active) return;
        setAiMode(response);
        setChosenAiMode(response.mode);
      })
      .catch(cause => {
        if (!active) return;
        setAiModeError(cause instanceof Error ? cause.message : 'Mode AI tidak dapat dibaca.');
      });
    return () => { active = false; };
  }, []);

  async function saveAiMode() {
    if (previewOnly || !aiMode || savingAiMode || chosenAiMode === aiMode.mode ||
        (chosenAiMode === 'live' && (!aiMode.liveSelectable || !confirmLive))) return;
    setSavingAiMode(true);
    setAiModeError('');
    try {
      const saved = await updateAiExecutionMode({
        deviceId,
        mode: chosenAiMode,
        expectedRevision: aiMode.revision,
        confirmation: chosenAiMode === 'live' ? 'ENABLE_AI_LIVE_SUPERVISED' : 'CHANGE_AI_MODE',
      });
      setAiMode(saved);
      setChosenAiMode(saved.mode);
      setConfirmLive(false);
    } catch(cause) {
      setAiModeError(cause instanceof Error ? cause.message : 'Mode AI gagal disimpan.');
      // Leave error visible; admin can press Refresh to resolve revision conflicts.
    } finally {
      setSavingAiMode(false);
    }
  }


  useEffect(() => {
    setConfirmed(false);
    setPhysicalConfirmed(false);
    setResult(null);
    setPreviewReasons(null);
    setError('');
  }, [action, report?.evaluated_at]);

  async function checkAcc() {
    if (!confirmed || !canReview || !report?.evaluated_at || checking) return;
    setChecking(true);
    setError('');
    setResult(null);
    setPreviewReasons(null);
    try {
      if (previewOnly) {
        // The preview API is unauthenticated and must remain GET/read-only.
        const draft = await fetchAiAccPreparation();
        setPreviewReasons([
          'PREVIEW_TANPA_LOGIN_TIDAK_DAPAT_MEREKAM_ACC',
          ...draft.readiness.blockers,
        ]);
      } else {
        const response = await checkAiOperatorAccDryRun({
          expectedAction: action,
          expectedEvaluatedAt: report.evaluated_at,
          confirmation: 'CHECK_OPERATOR_ACC_DRY_RUN',
        });
        setResult(response);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pemeriksaan ACC gagal.');
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!liveCommandId || previewOnly) return;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const update = await fetchAiAccWaterTrialStatus(liveCommandId);
        if (active) setLiveStatus(update);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Tidak bisa membaca ACK.');
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [liveCommandId]);

  const aiWaterL = report?.calculation.water_l ?? null;
  const canPhysicalTrial = !previewOnly && aiMode?.apiTrialEnabled === true && !!report && report.status === 'CURRENT' &&
    canReview && report.sensors.device_mode === 'automatic' &&
    aiWaterL !== null && aiWaterL >= 1 &&
    report.decision.hold_reasons.length === 0;
  const liveTerminal = ['completed','rejected','timed_out','expired','failed'].includes(liveStatus?.status ?? '');

  async function startPhysicalTrial() {
    if (!canPhysicalTrial || !confirmed || !physicalConfirmed ||
        livePending || liveCommandId !== null || !report?.evaluated_at ||
        (action !== 'IRRIGATE' && action !== 'FERTIGATE')) return;
    setLivePending(true);
    setError('');
    try {
      const queued = await startAiAccWaterTrial({
        deviceId: 'esp32-s3-01',
        commandId: createCommandId(),
        expectedAction: action,
        expectedEvaluatedAt: report.evaluated_at,
        trialCapL, durationSec,
        confirmation: 'APPROVE_AI_WATER_ONLY_TRIAL',
      });
      setLiveCommandId(queued.commandId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ACC gagal; tidak ada command yang diantrekan.');
    } finally { setLivePending(false); }
  }

  async function stopPhysicalTrial() {
    if (!liveCommandId || stopRequested || liveTerminal) return;
    setStopRequested(true);
    try {
      await requestAiAccWaterTrialStop(liveCommandId);
      // A queued STOP is NOT proof that the physical pump is OFF.
    } catch (cause) {
      setStopRequested(false);
      setError(cause instanceof Error ? cause.message : 'STOP gagal diantrekan.');
    }
  }

  const reasons = result?.blockers ?? previewReasons ?? [];
  return (
    <article className="ain-panel ain-operator-acc" aria-label="Trial ACC operator">
      <div className="ain-panel-heading">
        <h3><ClipboardCheck size={18} /> Mode AI &amp; ACC Operator</h3>
        <span>{previewOnly ? 'PREVIEW · SHADOW' : aiMode?.apiTrialEnabled ? 'LIVE SUPERVISED' : 'AI · NON-AKTUASI'}</span>
      </div>
      <section className="ain-mode-settings" aria-label="Pengaturan mode eksekusi AI">
        <div className="ain-mode-heading">
          <h4>Mode eksekusi AI</h4>
          <button type="button" onClick={() => { void refreshAiMode(); }}
            disabled={previewOnly || savingAiMode}>Refresh</button>
        </div>
        <p>Berbeda dari selector Manual / Automatic ESP32. Mengubah mode AI tidak
          mengubah selector, tidak otomatis menjalankan pompa, dan bukan perintah STOP.</p>
        <div className="ain-mode-current" role="status">
          <strong>{previewOnly ? 'SHADOW · Preview read-only' :
            aiMode ? aiMode.mode.toUpperCase() : 'Mode belum terverifikasi'}</strong>
          <small>{previewOnly ? 'Tidak ada perintah pompa dari preview.' :
            aiMode ? `Revisi ${aiMode.revision} · ${aiMode.updatedAt ? new Date(aiMode.updatedAt).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'}) + ' WIB' : 'default SHADOW'}` :
            'Gagal membaca PostgreSQL/API. Eksekusi diblokir.'}</small>
        </div>
        {!previewOnly && aiMode && (
          <>
            <label className="ain-mode-select">Pilih mode AI
              <select value={chosenAiMode} disabled={savingAiMode}
                onChange={event => { setChosenAiMode(event.target.value as AiExecutionMode); setConfirmLive(false); }}>
                <option value="off">OFF — tidak boleh dispatch AI</option>
                <option value="shadow">SHADOW — rekomendasi saja</option>
                <option value="live" disabled={!aiMode.liveSelectable}>LIVE — ACC operator, air saja</option>
              </select>
            </label>
            {chosenAiMode === 'live' && (
              <label className="ain-acc-confirm">
                <input type="checkbox" checked={confirmLive}
                  onChange={event => setConfirmLive(event.target.checked)}/>
                <span>Saya memahami LIVE hanya untuk water-only trial dengan ACC,
                  pemeriksaan safety dan ACK aktual. Bukan kontrol otomatis tanpa pengawasan.</span>
              </label>
            )}
            {!aiMode.liveSelectable && <p className="ain-mode-note">LIVE masih dikunci oleh backend
              sampai flag commissioning disetujui dan perangkat 1.5.07 terverifikasi.</p>}
            <button type="button" className="ain-acc-check"
              disabled={savingAiMode || chosenAiMode === aiMode.mode ||
                (chosenAiMode === 'live' && (!aiMode.liveSelectable || !confirmLive))}
              onClick={() => { void saveAiMode(); }}>
              {savingAiMode ? 'Menyimpan…' : 'Simpan mode AI (admin)'}
            </button>
          </>
        )}
        {aiModeError && <p className="ain-acc-error" role="alert"><AlertTriangle size={15}/>{aiModeError}</p>}
        {aiMode?.mode === 'live' && <p className="ain-mode-note">
          {aiMode.apiTrialEnabled ? 'API trial tersedia untuk ACC bersyarat.' :
            'LIVE tersimpan, tetapi gate API dinonaktifkan: eksekusi BLOCKED.'}
          {' '}Worker dan hardware tetap mempunyai gate independen.
          Mode OFF/SHADOW tidak menghentikan command yang sudah terkirim.
        </p>}
      </section>
      <p>Operator meninjau usulan AI sebelum perangkat dapat menerima perintah.
        Tahap ini hanya menguji pemeriksaan ACC, <strong>tidak menjalankan pompa</strong>.</p>
      <div className="ain-acc-summary">
        <div><small>Aksi AI</small><strong>{canReview ? action : 'Tidak ada rekomendasi yang dapat direview'}</strong></div>
        <div><small>Keputusan</small><strong>{report?.status ?? 'Tidak tersedia'}</strong></div>
        <div><small>Eksekusi</small><strong>{!previewOnly && aiMode?.apiTrialEnabled ? 'ACC wajib / gate safety' : 'BLOCKED'}</strong></div>
      </div>
      <label className="ain-acc-confirm">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>Saya sudah meninjau rekomendasi. Saya paham pemeriksaan ini tidak menghidupkan pompa.</span>
      </label>
      <button type="button" className="ain-acc-check"
        disabled={!confirmed || !canReview || !report?.evaluated_at || checking}
        onClick={() => { void checkAcc(); }}>
        {checking ? 'Memeriksa…' : 'Cek ACC (tanpa eksekusi pompa)'}
      </button>
      {error && <p role="alert" className="ain-acc-error"><AlertTriangle size={15}/>{error}</p>}
      {(result || previewReasons) && (
        <div className="ain-acc-blocked" role="status">
          <strong><ShieldAlert size={16}/> ACC diperiksa — eksekusi tetap BLOCKED</strong>
          {result?.decisionMatched && <p><CheckCircle2 size={15}/> Keputusan cocok, tetapi bukan izin dispatch.</p>}
          <ul>{reasons.map(reason => <li key={reason}>{reason.replaceAll('_', ' ').toLowerCase()}</li>)}</ul>
        </div>
      )}
      {!previewOnly && (
        <section className="ain-acc-live" aria-label="ACC water-only supervised commissioning">
          <h4>ACC & Jalankan Uji Pompa Air (Operator)</h4>
          <p>Trial fisik ini hanya mengalirkan AIR ke wadah ukur. FERTIGATE dari AI tidak
            berarti pompa pupuk dinyalakan. Semua safety gate backend dan firmware tetap berlaku.</p>
          <div className="ain-acc-live-fields">
            <label>Volume maksimum uji (liter)
              <input type="number" min={1} max={5} step={0.5} value={trialCapL}
                disabled={!!liveCommandId} onChange={event => setTrialCapL(Number(event.target.value))}/>
            </label>
            <label>Timeout lokal ESP32 (detik)
              <input type="number" min={5} max={30} step={1} value={durationSec}
                disabled={!!liveCommandId} onChange={event => setDurationSec(Number(event.target.value))}/>
            </label>
          </div>
          <label className="ain-acc-confirm">
            <input type="checkbox" checked={physicalConfirmed} disabled={!!liveCommandId}
              onChange={event => setPhysicalConfirmed(event.target.checked)}/>
            <span>Operator berada di site, sensor tandon/flow siap, arahkan air ke wadah ukur,
              pompa pupuk OFF, STOP fisik tersedia dan tidak ada jadwal otomatis.</span>
          </label>
          <button type="button" className="ain-acc-check" onClick={() => { void startPhysicalTrial(); }}
            disabled={!canPhysicalTrial || !confirmed || !physicalConfirmed || livePending ||
              !!liveCommandId || !Number.isFinite(trialCapL) || trialCapL < 1 || trialCapL > 5 ||
              !Number.isInteger(durationSec) || durationSec < 5 || durationSec > 30}>
            {livePending ? 'Mengirim permintaan ACC…' : 'ACC Operator & Antrekan Trial Air'}
          </button>
          {!canPhysicalTrial && <p className="ain-acc-error">
            <AlertTriangle size={15}/> Perintah fisik belum tersedia:
            perlu AI mode LIVE, AI CURRENT, rencana liter operasional, dan selector Automatic.
          </p>}
          {liveCommandId && (
            <div className="ain-acc-live-status" role="status">
              <strong>Command {liveCommandId}</strong>
              <p>Status: {liveStatus?.status ?? 'pending / menunggu pembacaan ACK'}</p>
              <p>Menunggu ACK ESP32 dan actual state. Pending bukan bukti pompa ON.</p>
              <button type="button" onClick={() => { void stopPhysicalTrial(); }}
                disabled={stopRequested || liveTerminal}>
                {stopRequested ? 'STOP diantrekan; verifikasi OFF fisik' : 'STOP pompa air'}
              </button>
            </div>
          )}
        </section>
      )}
      <p className="ain-footnote">
        {previewOnly
          ? 'Preview port 5002 hanya menerima GET. Tidak ada login, approval tersimpan, MQTT publish, atau command.'
          : 'Hanya operator/admin terautentikasi dengan CSRF valid yang bisa menjalankan preflight ini. Tidak ada approval tersimpan atau command.'}
        {' '}Firmware 1.5.07 belum terverifikasi di hardware; tank guard MCU tetap wajib.
      </p>
    </article>
  );
}
