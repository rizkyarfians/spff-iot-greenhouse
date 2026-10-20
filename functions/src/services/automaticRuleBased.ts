import type { FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';
import { evaluateSiteFertigation } from './fertigationLiveEvaluation.js';

import { applicationDue, jakartaDay } from './fertigationSchedule.js';
import { ruleBasedRepeatHoldReasons, type FertigationRepeatEvidence } from './fertigationRepeatGuard.js';

export interface RuleBasedAutomaticResult {
  method: 'rule_based';
  status: 'hold' | 'suggested';
  action: 'DELAY' | 'IRRIGATE' | 'FERTIGATE';
  selectedProgramId: string | null;
  eligibleCount: number;
  reasons: string[];
  canDispatch: false;
  deviceAuthority: 'esp32';
  activeDeviceStrategy: 'legacy_sensor';
}

/** Automatically resolve one approved agronomic profile; do not ask the operator for a recipe ID. */
export function evaluateAutomaticRuleBased(
  programs: readonly FertigationRecipe[],
  deviceId: string,
  snapshot: SiteEvaluationSnapshot,
  now = new Date(),
  repeatEvidence?: FertigationRepeatEvidence,
): RuleBasedAutomaticResult {
  const today = jakartaDay(now);
  const eligible = programs.filter(program => {
    if (program.approvalStatus !== 'approved' || !program.approvalReference ||
        program.cropId === null || program.cropId !== snapshot.activeCropId ||
        program.zoneId !== 'soil-1' || !program.plantingDate) return false;
    return applicationDue(program, today);
  });
  const base = {
    method: 'rule_based' as const, eligibleCount: eligible.length,
    canDispatch: false as const, deviceAuthority: 'esp32' as const,
    activeDeviceStrategy: 'legacy_sensor' as const,
  };
  if (eligible.length !== 1) return {
    ...base, selectedProgramId: null, status: 'hold', action: 'DELAY',
    reasons: [eligible.length === 0
      ? 'Tidak ada aturan yang digunakan dan sesuai dengan tanaman serta umur tanaman saat ini.'
      : 'Ada lebih dari satu aturan aktif. Admin perlu mengatasi konflik aturan.'],
  };
  const program = eligible[0]!;
  // Keep device/sensor safety checks, but use only this approved rule's demand thresholds.
  const decision = evaluateSiteFertigation(program, deviceId, snapshot, now, program);
  const reasons = decision.decision.status === 'hold' ? [...decision.decision.reasons] : [];
  if (program.moistureLowPercent === null || program.moistureTargetPercent === null)
    reasons.push('Ambang moisture pada aturan budidaya belum lengkap.');
  if (program.targetStockL > 0 &&
      (program.ecLowUsCm === null || program.ecTargetUsCm === null || program.ecHighUsCm === null))
    reasons.push('Ambang EC pada aturan budidaya belum lengkap.');
  if (program.moistureLowPercent !== null && snapshot.moisture !== null &&
      snapshot.moisture > program.moistureLowPercent)
    reasons.push('Moisture belum berada di bawah ambang Rule-Based.');
  if (program.targetStockL > 0 && program.ecLowUsCm !== null &&
      snapshot.liquidEcUsCm !== null && snapshot.liquidEcUsCm > program.ecLowUsCm)
    reasons.push('EC belum berada di bawah ambang Rule-Based.');
  if (repeatEvidence === undefined) {
    reasons.push('Riwayat sesi perangkat belum diperiksa; evaluasi Rule-Based ditahan.');
  } else {
    reasons.push(...ruleBasedRepeatHoldReasons(program, snapshot, repeatEvidence, now));
  }
  const ready = reasons.length === 0;
  return {
    ...base, selectedProgramId: program.recipeId,
    status: ready ? 'suggested' : 'hold',
    action: ready ? (program.targetStockL > 0 ? 'FERTIGATE' : 'IRRIGATE') : 'DELAY',
    reasons: ready
      ? ['Evaluasi Model 1 memenuhi syarat. Kontrol relay tetap berada pada ESP32; tidak ada command yang dikirim.']
      : reasons,
  };
}
