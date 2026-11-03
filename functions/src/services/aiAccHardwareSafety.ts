import { AiAccWaterTrialBlocked } from './aiAccWaterTrialPolicy.js';

const FIRMWARE_VERSION = '1.5.07-AI-ACC-SESSION';
function block(reason: string): never { throw new AiAccWaterTrialBlocked(reason); }

function fresh(value: Date | string | null, now: Date): boolean {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  const skewMs = time - now.getTime();
  return Number.isFinite(time) && skewMs <= 2000 && skewMs >= -45000;
}

export interface AiAccDeviceEvidence {
  online: boolean;
  mode: string | null;
  recorded_at: Date | string | null;
  received_at: Date | string | null;
  firmware_version: string | null;
  raw_payload: Record<string, unknown> | null;
}

export interface AiAccInterlockEvidence {
  enabled: boolean;
  applied_enabled: boolean | null;
  acknowledgement_status: string | null;
  revision: number | string;
  acknowledged_revision: number | string | null;
}

/** Firmware 1.5.07 heartbeat is an expiring register-level output readback.
 * It is NOT physical relay contact feedback and is NOT an execution ACK.
 */
export function requireAiAccHardwareEvidence(
  device: AiAccDeviceEvidence | undefined,
  now: Date = new Date(),
): { bootId: string; interlockEnabled: boolean } {
  if (!device || device.online !== true || device.mode !== 'automatic' ||
      !fresh(device.recorded_at, now) || !fresh(device.received_at, now)) {
    block('Status ESP32 tidak fresh, online, atau Automatic.');
  }
  if (device.firmware_version !== FIRMWARE_VERSION) {
    block('Kontrak firmware bukan AI ACC Session 1.5.07 yang diverifikasi.');
  }
  const raw = device.raw_payload;
  if (!raw || raw.aiAccWaterTrialCapable !== true ||
      raw.timedWaterTrialCapable !== true ||
      raw.aiAccTankGuardCapable !== true ||
      raw.aiAccTankGuardHealthy !== true) {
    block('Firmware belum mengiklankan executor dan tank guard independen yang sehat.');
  }
  if (raw.pumpReadbackValid !== true ||
      raw.pumpWaterActualActive !== false ||
      raw.pumpFertActualActive !== false ||
      raw.aiAccSessionActive !== false) {
    block('Heartbeat readback ESP32 belum membuktikan kedua output OFF dan sesi idle.');
  }
  if (typeof raw.pulseBootId !== 'string' ||
      !/^[0-9a-f]{16}$/i.test(raw.pulseBootId)) {
    block('Boot ID MCU tidak valid.');
  }
  if (typeof raw.waterInterlockEnabled !== 'boolean') {
    block('Firmware tidak melaporkan status konfigurasi water interlock.');
  }
  return { bootId: raw.pulseBootId, interlockEnabled: raw.waterInterlockEnabled };
}

/** Interlock UI may intentionally be OFF. This is only valid when BOTH DB
 * revisions and MCU applied state agree. Tank guard above is never optional.
 */
export function requireAiAccInterlockAgreement(
  interlock: AiAccInterlockEvidence | undefined,
  firmwareEnabled: boolean,
): void {
  if (!interlock ||
      typeof interlock.enabled !== 'boolean' ||
      typeof interlock.applied_enabled !== 'boolean' ||
      interlock.acknowledgement_status !== 'applied' ||
      String(interlock.revision) !== String(interlock.acknowledged_revision) ||
      interlock.enabled !== interlock.applied_enabled ||
      firmwareEnabled !== interlock.applied_enabled) {
    block('Konfigurasi interlock belum ACK applied atau tidak cocok dengan MCU.');
  }
}
