import type { FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';
import { jakartaDay } from './fertigationSchedule.js';

/**
 * Read-only gate for device-reported application history.
 * An advisory evaluation never creates a session or claims completion.
 */
export interface FertigationSessionEvidence {
  recipeId: string | null;
  status: 'started' | 'running' | 'completed' | 'aborted' | 'fault';
  startedAt: Date | null;
  finishedAt: Date | null;
  lastRecordedAt: Date;
  targetStockL: number;
  completionProven: boolean;
}

export interface FertigationRepeatEvidence {
  sessions: readonly FertigationSessionEvidence[];
  /** Latest *healthy, device-recorded* moisture reading >= target after the last completed session. */
  recoveredAt: Date | null;
}

const dateOf = (date: Date | null): string | null =>
  date instanceof Date && Number.isFinite(date.getTime()) ? jakartaDay(date) : null;

export function ruleBasedRepeatHoldReasons(
  recipe: FertigationRecipe,
  snapshot: SiteEvaluationSnapshot,
  evidence: FertigationRepeatEvidence,
  now: Date,
): string[] {
  const reasons: string[] = [];
  const today = jakartaDay(now);
  const sessions = evidence.sessions;
  if (sessions.some(session => session.status === 'started' || session.status === 'running')) {
    reasons.push('Masih ada sesi aplikasi pada perangkat yang belum selesai; tunggu status akhir dari ESP32.');
  }
  const own = sessions.filter(session => session.recipeId === recipe.recipeId);
  // A fault must never be interpreted as permission to retry the pump automatically.
  if (own.some(session => session.status === 'fault' || session.status === 'aborted')) {
    reasons.push('Sesi sebelumnya gagal atau dibatalkan; perlu pemeriksaan operator sebelum aplikasi ulang.');
  }
  const completed = own.filter(session => session.status === 'completed')
    .sort((a, b) => (b.finishedAt?.getTime() ?? b.lastRecordedAt.getTime()) -
      (a.finishedAt?.getTime() ?? a.lastRecordedAt.getTime()));
  if (completed.some(session => !session.completionProven || !session.finishedAt)) {
    reasons.push('Ada sesi selesai tanpa bukti ACK akhir dan volume aktual dari ESP32.');
  }
  // Calendar rules must never run twice in the same Asia/Jakarta due date.
  if (recipe.applicationMode !== 'sensor') {
    if (own.some(session => {
      const times = [session.startedAt, session.finishedAt, session.lastRecordedAt];
      return times.some(time => dateOf(time) === today);
    })) reasons.push('Aplikasi pada tanggal jadwal ini sudah tercatat; tidak boleh dijalankan ulang.');
  } else if (completed.length > 0) {
    const latest = completed[0]!;
    const endedAt = latest.finishedAt;
    const recovery = evidence.recoveredAt;
    // Recovery must be *after* completion and before fresh, dry trigger samples.
    if (!endedAt || !latest.completionProven || !recovery ||
        recovery.getTime() <= endedAt.getTime() || recovery.getTime() > now.getTime() ||
        recipe.moistureTargetPercent === null) {
      reasons.push('Tanah belum terbukti pulih setelah sesi terakhir; pemicu sensor belum boleh aktif ulang.');
    } else {
      const confirmedCount = recipe.triggerSampleCount;
      const confirmed = (snapshot.recentSamples ?? []).slice(0, confirmedCount);
      if (confirmed.length !== confirmedCount ||
          confirmed.some(sample => sample.recordedAt.getTime() <= recovery.getTime())) {
        reasons.push('Perlu pembacaan kering baru sesudah tanah sempat mencapai target kelembapan.');
      }
    }
  }
  // Conservative dosing rule: any device-confirmed fertilizer application today blocks another.
  if (recipe.targetStockL > 0 && sessions.some(session =>
      session.targetStockL > 0 &&
      session.status === 'completed' &&
      (dateOf(session.finishedAt) === today || dateOf(session.lastRecordedAt) === today))) {
    reasons.push('Pupuk sudah diaplikasikan melalui perangkat hari ini; jangan melakukan dosis ulang otomatis.');
  }
  return reasons;
}
