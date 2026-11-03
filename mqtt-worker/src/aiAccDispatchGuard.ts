import type { PendingControlCommand } from './repository.js';

/**
 * Worker-side defence in depth. PostgreSQL applies its own live Automatic
 * safety gates before selecting a command; MCU must independently revalidate.
 * Only AI ACC commands are evaluated here, never change Manual/scheduled flow.
 */
export function aiAccDispatchBlocker(
  command: PendingControlCommand,
  enabled: boolean,
  now: Date = new Date(),
): string | null {
  const aiSource = command.source === 'ai-operator-acc-water-only-trial';
  const aiActor = command.requestedBy.startsWith('trial:water:ai:');
  if (!aiSource && !aiActor) return null;

  if (!enabled) return 'ai_worker_dispatch_disabled';
  if (!aiSource || !aiActor || command.requestedBy.length <= 'trial:water:ai:'.length) {
    return 'invalid_ai_command_origin';
  }
  if (command.actuatorKey !== 'pump_water' || command.requestedIsActive !== true) {
    return 'not_water_only_start';
  }
  if (command.aiAccConfirmation !== 'APPROVE_AI_WATER_ONLY_TRIAL') {
    return 'operator_confirmation_missing';
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.commandId)) {
    return 'invalid_ai_command_id';
  }
  const trial = command.waterTrial;
  if (!trial || !/^[0-9a-f]{16}$/i.test(trial.bootId ?? '') ||
      !Number.isFinite(trial.targetWaterL) || trial.targetWaterL < 1 || trial.targetWaterL > 5 ||
      !Number.isInteger(trial.durationSec) || trial.durationSec < 5 || trial.durationSec > 30) {
    return 'invalid_boot_bound_water_trial';
  }

  const issued = Date.parse(command.issuedAt);
  const expires = Date.parse(command.expiresAt);
  const evaluated = Date.parse(command.aiAccExpectedEvaluatedAt ?? '');
  const time = now.getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(evaluated) ||
      issued > time + 2_000 || issued < time - 20_000 ||
      expires <= time || expires > issued + 20_000 ||
      evaluated > time + 2_000 || evaluated < time - 60_000) {
    return 'stale_or_invalid_ai_command';
  }
  return null;
}
