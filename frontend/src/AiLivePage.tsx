import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import type { UnifiedAiDashboard } from '@spff/contracts';
import { fetchUnifiedAiDashboard } from './api';
import { AiOperatorAccPanel } from './AiOperatorAccPanel';
import './UnifiedAiNeedsPage.css';

/**
 * AI execution permission is separate from the read-only AI & Kebutuhan Tanaman
 * page AND separate from the MCU's physical Manual/Automatic selector.
 * This page never issues a pump command merely by opening it.
 */
export function AiLivePage() {
  const [report, setReport] = useState<UnifiedAiDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const latest = await fetchUnifiedAiDashboard(abort.signal);
        if (abort.signal.aborted) return;
        setReport(latest);
        setError('');
      } catch (cause) {
        if (abort.signal.aborted) return;
        setReport(null); // Never present stale AI data as ready for a new trial.
        setError(cause instanceof Error ? cause.message : 'Sumber AI belum tersedia.');
      } finally {
        pending = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [revision]);

  return (
    <section className="secondary-page ai-needs-page" aria-label="AI LIVE">
      <div className="ain-hero">
        <div>
          <span className="ain-eyebrow"><ShieldAlert size={14}/> AI ACC · KONTROL TERAWASI</span>
          <h2>AI LIVE</h2>
          <p>Atur OFF / SHADOW / LIVE dan ACC operator di satu halaman. Mode AI tidak
            mengubah selector Manual / Automatic ESP32.</p>
        </div>
        <div className="ain-hero-side">
          <span className="ain-mode"><Activity size={14}/> EKSEKUSI TERKUNCI SAMPAI SAFETY LULUS</span>
          <button type="button" className="ain-refresh"
            onClick={() => { setLoading(true); setRevision(value => value + 1); }}>
            <RefreshCw size={16}/> Muat ulang AI
          </button>
        </div>
      </div>
      {loading && !report && !error && (
        <div className="ain-notice" role="status">Membaca keputusan AI lokal…</div>
      )}
      {error && (
        <div className="ain-notice ain-warning" role="alert">
          <AlertTriangle size={16}/> Data rekomendasi AI belum tersedia: {error}.
          Pengaturan mode tetap terpisah, tetapi trial fisik tidak dapat dimulai.
        </div>
      )}
      <AiOperatorAccPanel report={report} />
      <div className="ain-notice" role="note">
        <ShieldAlert size={16}/> LIVE di sini hanya jalur uji pompa air terawasi dengan
        ACC operator, bukan otomatis penuh. Publish MQTT bukan bukti pompa ON.
        Gunakan STOP fisik ketika diperlukan dan tunggu ACK aktual ESP32.
      </div>
    </section>
  );
}
