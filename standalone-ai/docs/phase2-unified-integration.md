# Phase 2 — Unified Adaptive AI (source-only, SHADOW)

## Baseline and status

- Foundation base: `219e444a09c92b7400a765e579f72780e71f1899`.
- Standalone AI imported as an isolated `standalone-ai/` subtree from `codex/standalone-ai-engine`.
- No production systemd service was restarted, no firmware was flashed, no schema was migrated.
- Mode continues to prohibit actuator dispatch: `can_dispatch=false`.

## Confirmed production observations

- A historical telemetry row (`telemetry_id=88368`) had `recorded_at` in 2085; this formerly won the source adapter's `ORDER BY recorded_at DESC`. A later manual source audit returned live 2026 telemetry.
- The latest shadow decisions in PostgreSQL were current, but `GET /decisions?limit=1` returned an old 2085 snapshot because JSONB object key order was mistaken for chronological insertion order.
- Soil 1 fluctuated approximately 59% -> 0% -> 59%, and a zero register was observed in a CRC-valid Modbus frame. Firmware ownership and hardware diagnosis belong to the firmware team.

## Changes

1. `/decisions` sorts explicitly by timezone-aware event timestamp, then decision ID. Old audit entries are preserved.
2. Source SQL rejects `recorded_at > received_at + 5s`, future receipt times and future measurement times. Source time-to-live is still enforced by the live engine using `sensor_data_max_age`; the query never fabricates readings.
3. `app/quality.py` adds a conservative SHADOW Fuzzy quality gate: rejects invalid/failed/explicitly non-control-valid health; detects abrupt moisture jumps; requires three distinct chronological and consistent *sensor acquisition timestamps* before adopting a suspect new baseline; never counts cached repeated Modbus readings as new evidence or substitutes last-good values. Missing per-register diagnostic proof fails closed.
4. Add regression tests for chronological ordering, poisoned source clock SQL contract, contradictory message IDs, stale/failed poll, valid-zero spikes and stable recovery.

Provisional constants (`15` percentage-point abrupt change, `3` point confirmation spread, `3` distinct samples, maximum `120` seconds between confirmations) **are NOT field-calibrated** and must be validated before any ACTIVE use. The quality gate is deliberately fail-closed; raw zero may be real, so a sustained consistent zero may be accepted for later analysis. Dashboard telemetry remains unmodified.

### Known integration caveat

`spff.telemetry_samples.sensor_health` may expose only normalized `valid`, while diagnostic fields like `lastPollOk` live in `raw_payload.sensorHealth`. The source adapter now explicitly whitelists diagnostic metadata from `raw_payload.sensorHealth` into the AI-only observation, but never exposes the arbitrary raw payload. Absence of `lastPollOk`, `rawFresh`, `rawAgeMs`, `raw` or `pollBootId` means `HOLD`, not a substitute or an inferred successful poll. This does not change the operational telemetry contract; the diagnostic schema still requires firmware-team validation.

## Branch comparison: `feature/python-adaptive-ai-engine`

Useful approaches for selective port **after review**, not blind cherry-pick:
- Counter-backed water/fertilizer flow EMA with persisted high-water mark, reset latch, and exactly-once feedback identity.
- Explicit delivery-evidence validation and mass balance, rejecting ambiguous or conflicting delivery records.
- Transactional state changes, advisory locks and idempotent ledger updates.

Do **not** import the `python-ai` operational migrations `034_python_adaptive_ai_shadow.sql` or `035_adaptive_ai_validation.sql`: migration numbers collide with existing Foundation migrations. A unified migration plan must use a new number and evidence of applied schema before any change. No schema changes have been made here.

## Verification and acceptance

Tests to run from the new branch on a safe development checkout:

```bash
cd standalone-ai
python3 -m pip install -e '.[test]'
python3 -m unittest discover -s tests -v
```

From the repository root, run the existing Node workspace gates too:

```bash
npm run build
npm run lint
```

These commands are **not claimed as executed in this remote-only edit session**. A separately reconstructed quality gate was exercised locally with 7 isolated behavioral checks; this is not equivalent to running repository tests. Full checkout was not accessible in the isolated terminal because DNS access to GitHub was unavailable; psycopg is also absent from that terminal environment. PostgreSQL integration test with a genuine future-dated row and hardware/RS485 validation remain pending. Production service and `/opt/spff-ai` are unchanged. Review and explicit approval are required before deployment.
