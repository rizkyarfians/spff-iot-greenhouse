/** Read-only, fail-closed observations from the local PostgreSQL source of truth.
 * PASS on one observation is not actuation authorization.
 */
import { z } from 'zod';

const gate = z.enum(['PASS', 'BLOCKED', 'UNKNOWN']);

export const aiSafetyEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('READ_ONLY_SAFETY_EVIDENCE'),
  source: z.enum(['POSTGRES_READ_ONLY', 'NOT_CONFIGURED', 'UNAVAILABLE']),
  status: z.literal('BLOCKED'),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  collectedAt: z.string().datetime({ offset: true }),
  siteId: z.string().max(120).nullable(),
  deviceId: z.string().max(120).nullable(),
  deviceLastSeenAt: z.string().datetime({ offset: true }).nullable(),
  telemetryRecordedAt: z.string().datetime({ offset: true }).nullable(),
  reportedMode: z.enum(['manual', 'automatic']).nullable(),
  firmwareVersion: z.string().max(120).nullable(),
  checks: z.object({
    deviceEnabled: gate,
    deviceOnlineFresh: gate,
    telemetryFresh: gate,
    automaticModeAcknowledged: gate,
    bothPumpsReportedOff: gate,
    waterInterlockConfirmed: gate,
    noUnfinishedCommands: gate,
    noEnabledPumpSchedules: gate,
    noRelayOwningSessions: gate,
    bootIdentityVerified: z.literal('UNKNOWN'),
    hydraulicCalibrationVerified: z.literal('UNKNOWN'),
  }).strict(),
  /** Why the *individual* gate is not observed as PASS. */
  blockers: z.array(z.string().max(160)).max(30),
  note: z.literal('Observasi saja; status PASS tidak mengizinkan command.'),
}).strict();

export type AiSafetyEvidence = z.infer<typeof aiSafetyEvidenceSchema>;
