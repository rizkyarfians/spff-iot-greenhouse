# Firmware 1.5.03: command and telemetry compatibility

This patch matches the source archive `SPFF_MASTER_1_5_03_SHT20_TELEMETRY_SYNC.rar`
provided by the operator. Archive SHA256:
`bbb5f371712c05000e98aa43c1a01258c476eaa9913aefb8eda37e0368d7dec7`.
All nine source hashes in its manifest matched. No firmware source or binaries are
published by this patch, no firmware was flashed, and no actuator was exercised.

## Resulting behavior

- Preview produces an unbound plan; it cannot pass the dispatch schema.
- A START can be allocated only for fresh online 1.5.03 status, synchronized
  legacy Manual mode with sensor controllers disabled, existing equipment/sensor
  checks, and a fresh IDLE adaptive frame proving both outputs known/OFF.
- Adaptive-frame bootId must match the pulseBootId reported in device status.
  The API binds START to that boot, sets a 15-second issuedAt/expiresAt window,
  and persists the same expiry in the command row and dispatch envelope.
- Schema rejects missing/empty boot tokens, invalid/reversed TTL, TTL over
  300 seconds, and envelope expiry extending the device command lifetime.
- Gateway preserves those exact fields and rejects future-issued commands.
  Existing durable command deduplication and no-replay-on-uncertainty remain.
- All safety fields emitted by 1.5.03 pass the strict telemetry validator.
  Empty session IDs are accepted only for IDLE diagnostic frames.
- IDLE frames are persisted as readiness/boot evidence, including the firmware's
  retained old session UUID, without reopening sessions or advancing doses.
- Only matching-boot, fresh valid flow, non-estimated counters with known pump
  states may advance session volume. Bad/legacy/incomplete measurement evidence
  is preserved but requires reconciliation and cannot add dose.

The API and worker dispatch switches remain opt-in. This patch does not enable
them. Legacy Manual is an ownership prerequisite of this firmware, not blanket
permission to ignore a manual operator stop. Existing OFF/reconciliation guards
remain in force.

## Deployment scope

Apply to an SPFF checkout based on production commit
`219e444a09c92b7400a765e579f72780e71f1899`, after inspecting local modifications.
No database migration is needed; existing migration 036 stores command payloads
and raw adaptive events. No UI rebuild is required for this backend patch.

Keep `SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=false` in both API and MQTT Worker while
validating ingestion. Build contracts first, then backend, edge and worker:

```bash
npm run build:contracts
npm run build:backend
npm run build:edge
npm run build:mqtt-worker
```

Restart only the corresponding API/edge/worker services after all builds pass.
The edge remains the sole serial owner. Existing gateway outbox and command ledger
must be retained. A fresh 1.5.03 IDLE adaptive event should now reach PostgreSQL
with its boot/freshness/measurement fields intact, even before a session exists.

## Verification and limits

Contracts/backend/edge/worker builds and their static checks passed on Windows
with Node 24.18.1 (repository API engine declares Node 22). Contracts + edge +
worker mjs tests passed (80 tests), 17 additional worker TypeScript tests passed
with a dummy DATABASE_URL and mock database, and the adaptive SQL integration
test passed using temporary PGlite and the real migration chain (98 distinct
tests total). The integration test exercises boot
mismatch, unbound preview rejection, allocation/dedup, exact wire expiry, invalid
measurement evidence, IDLE isolation, ownership and reconciliation.

The existing frontend build fails on Windows because GuideSchedule.tsx and
guideSchedule.ts imports collide under case-insensitive resolution. No frontend
file is changed by this patch. This is not a successful full-repository build.

Windows directory fsync is unsupported: the gateway now keeps mandatory file
fsync there, while Linux/Orange Pi still requires both file and directory fsync.
Local tests do not prove Linux power-loss durability or physical relay behavior.

This compatibility patch does not implement WAITING_FOR_WATER, automatic refill
resume, firmware water-only volume sessions, or Python-controlled injection.
The supplied firmware still uses EC hysteresis, faults on low water, and accepts
resume only from PAUSED. Backend resume remains disabled pending recovery work.
Source methods / EC-conversion requirements of the existing API remain intact;
the standalone AI's fertilizer route request does not silently bypass these.
Stock batch data, hydraulic calibration and physical commissioning remain needed
before any ACTIVE control can be claimed.
