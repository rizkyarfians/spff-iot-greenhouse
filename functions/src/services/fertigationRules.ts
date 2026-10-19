import type { FertigationDecision, FertigationRecipe, FertigationSimulationInput } from '@spff/contracts';

/** Deterministic, advisory-only decision. No hardware command is created. */
export function simulateFertigation(recipe: FertigationRecipe, input: FertigationSimulationInput): FertigationDecision {
  const reasons: string[] = [];
  if (recipe.approvalStatus !== 'approved' || !recipe.approvalReference) reasons.push('Program Fertigasi belum disetujui tim agronomi.');
  if (input.hst < recipe.hstFrom || input.hst > recipe.hstTo) reasons.push('Umur tanaman (HST) di luar rentang Program Fertigasi.');
  if (!input.scheduleDue) reasons.push('Belum masuk jadwal aplikasi.');
  if (input.selectorMode !== 'automatic') reasons.push('Selector perangkat bukan mode otomatis.');
  if (!input.slaveFresh || !input.waterFlowHealthy || (recipe.targetStockL > 0 && !input.stockFlowHealthy)) {
    reasons.push('Feedback flow meter belum tervalidasi atau tidak segar.');
  }
  if (input.waterTankPercent === null || input.waterTankPercent < recipe.minWaterTankPercent) {
    reasons.push('Level tangki air tidak tersedia atau di bawah batas.');
  }
  if (recipe.targetStockL > 0 && (input.stockTankPercent === null || input.stockTankPercent < recipe.minStockTankPercent)) {
    reasons.push('Level tangki pupuk tidak tersedia atau di bawah batas.');
  }
  const allowed = reasons.length === 0;
  return {
    modelId: 'rule-based-v1',
    simulationOnly: true,
    status: allowed ? 'suggested' : 'hold',
    action: allowed ? (recipe.targetStockL > 0 ? 'FERTIGATE' : 'IRRIGATE') : 'DELAY',
    targetWaterL: allowed ? recipe.targetWaterL : null,
    targetStockL: allowed ? recipe.targetStockL : null,
    reasons: allowed ? ['Memenuhi syarat simulasi. Tetap wajib validasi aktuator dan persetujuan operator sebelum eksekusi.'] : reasons,
    requiresApproval: true,
    publishable: false,
  };
}
