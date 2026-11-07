import type { GuideProgramPlan } from './guidePrograms.js';

export type FertilizationPhase = {
  activityId: string; phaseNumber: number; title: string; hst: number;
  product: string; method: string; targetG: number | null;
};

export function fertilizationPhases(plan: GuideProgramPlan): FertilizationPhase[] {
  return [...plan.activities].filter(a => a.hst !== null).sort((a,b) => a.hst! - b.hst!)
    .flatMap((activity, index) => {
      if (activity.method.trim().toLowerCase() !== 'tabur') return [];
      const requirements = activity.requirements.filter(r => /^phonska(?:\s+plus)?$/i.test(r.product.trim()));
      if (!requirements.length) return [];
      const grams = requirements.map(r => r.amount !== null && Number.isFinite(r.amount) && r.amount >= 0
        ? ['kg','kilogram'].includes(r.unit.trim().toLowerCase()) ? r.amount * 1000
        : ['g','gram'].includes(r.unit.trim().toLowerCase()) ? r.amount : null : null);
      return [{activityId:activity.id,phaseNumber:Number(/pemupukan\s*(?:ke[\s-]*)?(\d+)/i.exec(activity.title)?.[1] ?? index + 1),title:activity.title,hst:activity.hst!,
        product:requirements.map(r => r.product).join(' + '),method:activity.method,
        targetG:grams.every(g => g !== null) ? grams.reduce<number>((sum,g) => sum + g!,0) : null}];
    });
}

export type AutomaticCycleStatus = {
  deviceId: string;
  mode: 'fertilization' | 'waiting_off' | 'watering' | 'unavailable';
  reason: string;
  dispatchEnabled: boolean;
  updatedAt: string | null;
  phase: (FertilizationPhase & { deliveredG: number | null; remainingG: number | null;
    formulaStatus: 'pending' | 'ready'; fulfilled: boolean;
    estimated?: boolean; estimationReason?: string; unmeasuredIntervals?: number;
    targetGPerPlant?: number|null; gPerPlant?: number|null; coefficient?: number|null; baselineEcUs?: number|null; completionEligible?: boolean;
    baselineBasis?: string|null; baselineAt?: string|null; intervalReason?: string|null;
    lastCalculation?: {at:string;ecUsCm:number;volumeL:number;massG:number}|null;
    history?: {recordedG:number;remainingG:number|null;lastRecordedAt:string|null;status:'empty'|'unmeasured'|'recorded'} }) | null;
  nextHst: number | null;
  waterStatus: string | null;
};
