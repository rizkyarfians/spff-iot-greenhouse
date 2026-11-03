import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, ShieldAlert } from 'lucide-react';
import type { AiOperatorAccResult, UnifiedAiDashboard } from '@spff/contracts';
import { checkAiOperatorAccDryRun, fetchAiAccPreparation } from './api';
import './AiOperatorAccPanel.css';

const previewOnly = import.meta.env.DEV && import.meta.env.VITE_SPFF_AI_PREVIEW === 'true';

export function AiOperatorAccPanel({ report }: { report: UnifiedAiDashboard | null }) {
  const action = report?.decision.proposed_action;
  const canReview = action === 'IRRIGATE' || action === 'FERTIGATE';
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AiOperatorAccResult | null>(null);
  const [previewReasons, setPreviewReasons] = useState<string[] | null>(null);

  useEffect(() => {
    setConfirmed(false);
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

  const reasons = result?.blockers ?? previewReasons ?? [];
  return (
    <article className="ain-panel ain-operator-acc" aria-label="Trial ACC operator">
      <div className="ain-panel-heading">
        <h3><ClipboardCheck size={18} /> Trial AI · ACC Operator</h3>
        <span>STAGING · DRY-RUN</span>
      </div>
      <p>Operator meninjau usulan AI sebelum perangkat dapat menerima perintah.
        Tahap ini hanya menguji pemeriksaan ACC, <strong>tidak menjalankan pompa</strong>.</p>
      <div className="ain-acc-summary">
        <div><small>Aksi AI</small><strong>{canReview ? action : 'Tidak ada rekomendasi yang dapat direview'}</strong></div>
        <div><small>Keputusan</small><strong>{report?.status ?? 'Tidak tersedia'}</strong></div>
        <div><small>Eksekusi</small><strong>BLOCKED</strong></div>
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
      <p className="ain-footnote">
        {previewOnly
          ? 'Preview port 5002 hanya menerima GET. Tidak ada login, approval tersimpan, MQTT publish, atau command.'
          : 'Hanya operator/admin terautentikasi dengan CSRF valid yang bisa menjalankan preflight ini. Tidak ada approval tersimpan atau command.'}
        {' '}Firmware 1.5.03 belum tervalidasi untuk sesi volume AI; interlock tandon tidak boleh dibypass.
      </p>
    </article>
  );
}
