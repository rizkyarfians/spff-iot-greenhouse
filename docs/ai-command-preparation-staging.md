# SPFF Stage 2: AI command preparation (non-executable)

This staging feature prepares a **display-only intent preview**, not a queued or
dispatchable command. The authoritative source remains Python Standalone AI
`SHADOW_MODE`, reading real PostgreSQL via the existing read-only adapter.

## Endpoints

- Operational API: authenticated `GET /api/unified-ai/command-preparation`
  with `requireOperator`.
- Isolated DEV preview: `GET /api/unified-ai/command-preparation` on
  `127.0.0.1:5002`, with **no login**; do not expose this port to a public
  network. Preview mounts no operational router or actuator routes.

Both fetch the fixed, loopback-only Python `/dashboard/summary`, validate the
response with `@spff/contracts`, return HTTP 503 on missing/invalid source,
and set `Cache-Control: no-store`. They do NOT evaluate/write the Python AI,
query command queues, modify PostgreSQL, or publish MQTT.

## Important separation

The response provides:

- `previewId`, `preparedAt`, `previewExpiresAt` (2-minute display TTL).
  This ID is **not** a device command ID and is not accepted for execution.
- `intent` (IRRIGATE/FERTIGATE/OFF/UNMAPPED/NO_DECISION), only a source label;
  no device IDs, relay mappings, or actuation targets are inferred.
- Embedded `readiness` with current advisory blockers and optional
  `FUZZY_SIMULATION` display volume.
- Explicit preparation gates that remain unverified.
- `command` object with all fields **null**, and `executablePayload: null`.
  Shared Zod validation has literal null/false values; they cannot be turned
  into actual PumpCommandMessage fields within this schema.

Any future **real** commandId, issuedAt/expiresAt, requestedBy, siteId,
deviceId, targetId, parameters, and approval must be generated separately,
after live DB/device conflict and interlock checks, calibration, verified
firmware volume-session/STOP, role/CSRF auth, explicit human approval, and
controlled hardware testing. A GET is never an approval.

No changes to `spff.control_commands`, MQTT, Edge, ESP32, systemd,
or dispatch flags are part of this stage. Never use Fuzzy illustrative L
or historical LPM as pump settings.

## Validation

```bash
npm run build
npm run lint
node --test functions/test/aiDispatchReadiness.test.mjs \
  functions/test/aiCommandPreparation.test.mjs \
  functions/test/aiPreviewDispatchReadiness.test.mjs
```

No deployment or service restart should be performed without explicit approval.
