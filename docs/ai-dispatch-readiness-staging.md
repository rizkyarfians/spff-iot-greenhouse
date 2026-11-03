# SPFF Standalone AI → Backend preparation (source-only staging)

Status: **read-only preflight**. This change prepares a typed HTTP boundary; it does not authorize AI control.

Existing chain:

- Python Standalone AI reads real SPFF PostgreSQL via a read-only adapter and serves its SHADOW dashboard on `127.0.0.1:5011`.
- Node.js serves authenticated `GET /api/unified-ai/dashboard`.
- Existing operator/manual command queue: Node API → PostgreSQL `spff.control_commands` → MQTT Worker QoS 1 → Edge → ESP32 → ACK → PostgreSQL.

This stage adds only **authenticated operator-read** `GET /api/unified-ai/dispatch-readiness`, which:
1. Fetches the fixed local Python summary; clients cannot supply the URL.
2. Validates the response with `@spff/contracts`.
3. Evaluates conservative advisory blockers and returns a versioned `AiDispatchReadiness` shape.
4. Always returns `canDispatch=false`, `commandCreated=false`; any Fuzzy volume is explicitly `FUZZY_SIMULATION`.
5. Does **not** execute `/source/evaluate`, mutate AI state, insert `control_commands`, publish MQTT, or alter Manual/Automatic settings.

A 200 response means preflight was read successfully; it does **not** mean pump control is ready. A 503 means Python is unavailable or its summary fails validation. Existing dashboard and water-trial routes are unchanged.

## Remaining gates BEFORE any future operator-approved command path

- Calibrated, versioned AI planning profile and bounded valid volume; never use the simulation-1 liters or historical LPM as a pump target.
- Valid/fresh tank levels, interlock, hardware capability, device identity, pump states, boot identity, and operator mode policy.
- Audited per-session relay ownership and conflict handling for Manual/Automatic/schedules and all other command sources.
- Authenticated operator approval + CSRF + idempotent commandId, expiry, DB transaction, independently available STOP.
- Explicit firmware/Edge protocol with local volume counting, max-duration cut-off, final OFF ACK, measured-session identity, and ambiguous-outcome reconciliation.
- End-to-end testing with real Mosquitto, PostgreSQL, Edge, ESP32 and supervised physical calibration before any dispatch flag can be enabled.

Do not rename `can_dispatch` from the Python output, enable `ACTIVE`, use `SPFF_WATER_TRIAL_DISPATCH_ENABLED` as an AI enable flag, or insert an AI-origin command into the existing queue until the above gates are complete.

## Development verification (safe source only)

```bash
npm run build
npm run lint
node --test functions/test/aiDispatchReadiness.test.mjs
```

The Node endpoint is only available after intentionally building/running this branch's **staging** API. No production deployment, database migration or ESP32 firmware modification belongs to this stage.

## Isolated localhost preview (port 5002)

The standalone `functions/src/aiPreviewLocal.ts` process is NOT the operational Express API
and deliberately does not mount `apiRouter`. It exposes only the read-only health,
AI dashboard, and dispatch-readiness GET endpoints. The readiness route reuses the
same shared-contract validator and fail-closed controller, reading Python at the
configured localhost `AI_PREVIEW_PYTHON_PORT` (normally `5011`).

Unlike the operational API's readiness route, **the preview has no operator login**.
It MUST remain bound to `127.0.0.1` and be accessed only on the host or through
an SSH tunnel. Do not reverse-proxy it to a public network without appropriate
access control. Preview responses never create commands, and no actuator/POST
routes are mounted. HTTP 200 means preflight data was read, NOT dispatch permission.

Verify after building and intentionally restarting only `spff-ai-dev-api`:

```bash
curl -sS -i http://127.0.0.1:5002/api/unified-ai/dispatch-readiness
node --test functions/test/aiPreviewDispatchReadiness.test.mjs
```
