# SPFF Stage 4 — SHADOW AI operator draft approval and gated Water Trial writer

> **SUPERSEDED (Automatic-only decision, 2026-11-02):** The legacy AI
> `/volume-trial-approvals/:approvalId/queue` endpoint has been RETIRED and
> always returns HTTP 409. Enabling old dispatch flags does NOT re-enable it.
> See `docs/ai-automatic-only-pump-command.md`.
> The existing operator-only `/water-trials` calibration endpoint is separate
> from AI. AI is restricted to Automatic; firmware 1.5.03 rejects direct
> AI ON in that mode.

This is **source-only staging**, not deployment. PostgreSQL 038 is **not** applied to the running Orange Pi database.

## Routes

All routes remain behind `requireAuth` and existing audit middleware.

- `POST /api/unified-ai/volume-trial-preview`: existing operator+CSRF read-only Fuzzy conversion preview. Get the `source.recordedAt`, `source.illustrativeWaterL`, `source.configVersion`, `conversion.targetWaterL` fields.
- `POST /api/unified-ai/volume-trial-approvals`: admin+CSRF creates an immutable, expiring **approval draft**, not a command. Requires a client-generated UUID, exact preview identity/values, and literal confirmation.
- `GET /api/unified-ai/volume-trial-approvals/:approvalId`: authenticated operator reads the draft/status.
- `POST /api/unified-ai/volume-trial-approvals/:approvalId/queue`: admin+CSRF, **disabled by default**. It requires both `SPFF_AI_FUZZY_TRIAL_DISPATCH_ENABLED=true` **AND** existing `SPFF_WATER_TRIAL_DISPATCH_ENABLED=true`. DO NOT enable either before signed-off firmware/hardware acceptance. Even with flags, the backend rechecks AI source and calls the existing `createWaterTrial` authority with all its manual mode, firmware 1.5.04, flow, interlock, pump OFF and conflict gates.

Example draft JSON (replace with values from a fresh preview; illustration only):

```json
{
  "approvalId": "90b7cb0a-f2dc-43e8-b469-7146ca087acf",
  "deviceId": "esp32-s3-01",
  "trialCapL": 5,
  "durationSec": 30,
  "expected": {
    "sourceRecordedAt": "2026-11-02T05:36:35.000Z",
    "sourceVolumeL": 381.63727278975847,
    "targetWaterL": 5,
    "configVersion": "simulation-1"
  },
  "confirmation": "APPROVE_SHADOW_TRIAL_DRAFT"
}
```

Values are verified against a new fetch of `http://127.0.0.1:5011/dashboard/summary`, with strict freshness checks. A draft stores actor, SHA-256 request fingerprint, snapshot with Fuzzy provenance, stable internal command ID, and expiry (maximum 120 seconds, also bound to source freshness). It is **not** approval for full 381.64 liters or for fertigation injection; the candidate is a water-only calibration trial bounded by the operator.

On future approved queue, the server refuses changed/expired AI snapshots and uses `waterTrialRequestSchema` plus an immutable `aiApproval` identifier in `spff.control_commands.request_payload`. The existing worker and ACK flow remain unchanged. A queued database command is NOT pump success; only a valid terminal device ACK can mark `completed`.

## Safe tests

```bash
npm run build
npm run lint
node --test functions/test/aiVolumeApproval.test.mjs
```

For PostgreSQL-backed approval test on the isolated DB, the existing script is extended to run approval tests within `pg_virtualenv` against a private loopback MQTT broker. Do not apply migration 038 against production and do not set either dispatch flag.

## Remaining blockers

The installed v1.5.03 firmware does not report the required `timedWaterTrialCapable` on v1.5.04; tank water `jsn_no_echo`, missing stock level, historical flow uncalibrated, physical hardware STOP fail-safe untested. Approval draft does not satisfy these hardware requirements and is not an actuation grant.

No frontend approval button, authenticated HTTP end-to-end test, firmware flash, production migration, deployment, or pump activation is included in this stage.
