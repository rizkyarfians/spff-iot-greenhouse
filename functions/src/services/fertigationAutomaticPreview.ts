import type { FertigationAutomaticPreview, FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';
import { evaluateSiteFertigation } from './fertigationLiveEvaluation.js';

/** Preview of a potential program-driven strategy. Existing ESP32 legacy sensor control stays authoritative. */
export function previewAutomaticProgram(
  recipe: FertigationRecipe,
  deviceId: string,
  snapshot: SiteEvaluationSnapshot,
  now = new Date(),
): FertigationAutomaticPreview {
  const evaluation = evaluateSiteFertigation(recipe, deviceId, snapshot, now, recipe);
  const reasons = evaluation.decision.status === 'hold' ? [...evaluation.decision.reasons] : [];
  if (recipe.moistureLowPercent === null || recipe.moistureTargetPercent === null)
    reasons.push('Batas kelembapan Program Fertigasi belum ditetapkan tim agronomi.');
  if (recipe.targetStockL > 0 && (
    recipe.ecLowUsCm === null || recipe.ecTargetUsCm === null || recipe.ecHighUsCm === null
  )) reasons.push('Batas EC Program Fertigasi belum lengkap.');
  if (recipe.targetStockL > 0 && (
    snapshot.liquidEcUsCm === null || !snapshot.liquidEcValid
  )) reasons.push('Pembacaan EC larutan belum valid.');
  if (recipe.targetStockL > 0 && recipe.ecHighUsCm !== null &&
    snapshot.liquidEcUsCm !== null && snapshot.liquidEcUsCm >= recipe.ecHighUsCm)
    reasons.push('EC aktual melewati batas tertinggi Program Fertigasi.');

  // Demand thresholds belong to the program. No device config is overwritten here.
  if (recipe.moistureLowPercent !== null &&
      recipe.moistureTargetPercent !== null &&
      recipe.moistureLowPercent >= recipe.moistureTargetPercent)
    reasons.push('Urutan batas moisture tidak valid.');
  if (recipe.targetStockL > 0 && recipe.ecLowUsCm !== null &&
      recipe.ecTargetUsCm !== null && recipe.ecHighUsCm !== null &&
      !(recipe.ecLowUsCm < recipe.ecTargetUsCm && recipe.ecTargetUsCm < recipe.ecHighUsCm))
    reasons.push('Urutan batas EC tidak valid.');

  return {
    recipeId: recipe.recipeId,
    deviceId,
    status: reasons.length === 0 ? 'ready_for_review' : 'hold',
    activeStrategy: 'legacy_sensor',
    proposedStrategy: 'program_volume',
    canActivate: false,
    reasons: reasons.length ? reasons : ['Parameter tersedia, tetapi firmware kontrol volume dan otoritas strategi belum divalidasi.'],
    programParameters: {
      moistureLowPercent: recipe.moistureLowPercent,
      moistureTargetPercent: recipe.moistureTargetPercent,
      ecLowUsCm: recipe.ecLowUsCm,
      ecTargetUsCm: recipe.ecTargetUsCm,
      ecHighUsCm: recipe.ecHighUsCm,
      minWaterTankPercent: recipe.minWaterTankPercent,
      minStockTankPercent: recipe.minStockTankPercent,
      targetWaterL: recipe.targetWaterL,
      targetStockL: recipe.targetStockL,
    },
  };
}
