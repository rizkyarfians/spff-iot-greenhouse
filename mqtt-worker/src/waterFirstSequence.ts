export type WaterFirstPhase = 'starting_water' | 'starting_fertilizer' | 'running' |
  'stopping_fertilizer' | 'stopping_water';

type CommandState = 'waiting' | 'confirmed' | 'failed';

export interface WaterFirstFeedback {
  phase: WaterFirstPhase;
  stopRequested: boolean;
  protectionHealthy: boolean;
  waterOn: boolean | null;
  fertilizerOn: boolean | null;
  waterOnCommand: CommandState;
  fertilizerOnCommand: CommandState;
  fertilizerOffCommand: CommandState;
  waterOffCommand: CommandState;
  waterOnConfirmedAtMs: number | null;
  flowRecordedAtMs: number | null;
  flowWaterLpm: number | null;
  nowMs: number;
  deadlineMs: number;
}

export type WaterFirstAction = 'wait' | 'start_fertilizer' | 'stop_fertilizer' |
  'stop_water' | 'stop_both' | 'running' | 'complete';

export function decideWaterFirstAction(feedback: WaterFirstFeedback): WaterFirstAction {
  if (!feedback.protectionHealthy) return 'stop_both';
  if (feedback.phase === 'stopping_water') {
    if (feedback.fertilizerOn !== false || feedback.waterOffCommand === 'failed') return 'stop_both';
    return feedback.waterOffCommand === 'confirmed' && feedback.waterOn === false ? 'complete' : 'wait';
  }
  if (feedback.phase === 'stopping_fertilizer') {
    if (feedback.fertilizerOffCommand === 'failed') return 'stop_both';
    return feedback.fertilizerOffCommand === 'confirmed' && feedback.fertilizerOn === false
      ? 'stop_water' : 'wait';
  }
  if (feedback.stopRequested) return 'stop_fertilizer';
  if (feedback.nowMs >= feedback.deadlineMs || feedback.waterOnCommand === 'failed' ||
      feedback.fertilizerOnCommand === 'failed') return 'stop_both';

  const flowAt = feedback.flowRecordedAtMs;
  const waterConfirmedAt = feedback.waterOnConfirmedAtMs;
  const flowConfirmed = flowAt !== null && waterConfirmedAt !== null &&
    flowAt >= waterConfirmedAt && flowAt <= feedback.nowMs &&
    feedback.nowMs - flowAt <= 60_000 && feedback.flowWaterLpm !== null &&
    Number.isFinite(feedback.flowWaterLpm) && feedback.flowWaterLpm > 0;
  const waterReady = feedback.waterOnCommand === 'confirmed' && feedback.waterOn === true && flowConfirmed;
  if (feedback.phase === 'starting_water') {
    if (feedback.fertilizerOn !== false) return 'stop_both';
    return waterReady ? 'start_fertilizer' : 'wait';
  }
  if (!waterReady) return 'stop_both';
  if (feedback.phase === 'running') return feedback.fertilizerOn === true ? 'wait' : 'stop_both';
  return feedback.fertilizerOnCommand === 'confirmed' && feedback.fertilizerOn === true ? 'running' : 'wait';
}
