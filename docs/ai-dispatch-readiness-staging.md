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

## Stage 2: AI Fuzzy volume -> water-trial protocol MOCK loopback

- `GET /api/unified-ai/pump-simulation` (authenticated operator) fetches Python SHADOW summary from fixed loopback and returns a versioned, **NON-ACTUATING** mock candidate.
- Only a CURRENT live planning source and sensor-verified Fuzzy preview with matching timestamp can produce a mock candidate. The historic AI decision can still be STALE or HOLD: that is explicitly reported as a real-world dispatch blocker, never bypassed.
- Example for a Fuzzy preview of 372.68 L: the first **mock** segment is capped at 100 L by the existing water-trial contract; deferred 272.68 L is information only, never queued or split into automatic follow-ups. The 60s mock timebox is an arbitrary protocol test constant and **not** computed from unverified 194 L/min.
- `node scripts/ai-pump-loopback-simulation.mjs` reads the actual local Python summary, uses the real `CommandDispatchService` to build `PumpCommandMessage` over an isolated fake repository and fake publisher, then validates a synthetic accepted/completed OFF ACK using the real `IngestionService`. Identifiers are intentionally `simulated-site` / `simulated-esp32`. **No real Mosquitto, PostgreSQL, Edge, ESP32 or physical ACK is touched.**
- The synthetic ACK contains **no actualWaterL**; it is not a device completion, delivered volume, irrigation event or fertilizer obligation credit. The CLI output says `MOCK_COMPLETED_NOT_DEVICE_PROOF`, `physicalAckReceived=false`.
- The server's API only returns the conversion preview, never a valid `PumpCommandMessage` or a fake ACK. There is no POST endpoint, no DB migration, no command insertion and no new dispatch feature flag.

### Orange Pi verification in detached worktree

```bash
npm run build
npm run lint
node --test functions/test/aiPumpSimulation.test.mjs
node scripts/ai-pump-loopback-simulation.mjs
```

This is a **software-loopback test**, not proof that the water pump can be operated by current firmware. A supervised, separately approved hardware test with volume-session-capable ESP32, independent water interlock, calibrated flow and final OFF evidence remains required.
