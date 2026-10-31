# Phase 3 — Unified counter-backed EMA and measured-mass ledger

## Base and scope

This builds on Fase 2's tested `integration/unified-adaptive-ai` branch.
The existing `standalone-ai/` live shadow engine remains the **only** AI ledger.
No `python-ai/` service, second ledger, Foundation migration, active pump command,
or cloud dependency is created. `can_dispatch` remains `false`.

Implementation is source-only; rerun tests on a disposable checkout before treating
this change as validated. Existing PostgreSQL and Orange Pi services were not touched.

## Changes made

- `app/live_feedback.py`: only credit incremental measured fertilizer mass
  `delta_stock_l * bound_stock_concentration_g_l` **after** an authoritative
  session-bound terminal report confirms safe shutdown, both pumps OFF, correct
  boot identity, valid flow and non-estimated volumes. FAULT, unsafe shutdown,
  inconsistent/replayed/invalid evidence => `REQUIRES_REVIEW`, dose unchanged.
- `app/mass_evidence.py`: per-obligation reconciliation of persistent
  `delivered_g` against uniquely identified, accepted terminal session evidence.
  Rejects duplicate session delivery, missing ledger baseline, inconsistent
  stored totals, non-finite numbers, negative values and excessive dosing.
  Existing historical delivered mass forms a baseline, *not an inferred new
  delivery*. This requires operator review if provenance is unknown.
- `app/flow_evidence.py`: a conservative selective port from
  `feature/python-adaptive-ai-engine`'s counter-backed EMA:
  explicitly bound per-session water/fertilizer cumulative meter baseline,
  matching terminal deltas, boot identity, reset/high-water latch,
  independent pump-active durations, rate outlier check, separate water
  and fertilizer EMA, and stored acceptance/rejection trace.
- Without a bound counter baseline, measured terminal mass may still be
  credited when the existing authoritative volume feedback passes all
  session/flow/safe-stop gates, but **EMA is never learned**. Missing partial
  or contradictory counter evidence => manual review (no dose credit).
- No invented sensor readings and no estimation from clock duration, EC value,
  unbound legacy session or shadow proposal.

## Interface that is not yet validated on MCU

The hypothetical *future* authoritative executor must bind at session creation:

```json
{"flow_counter_baseline":{"water":100.0,"fertilizer":40.0},
 "boot_id":"actual device boot ID",
 "configuration_version":"calibrated-version",
 "ema_used":{"water":220.0,"fertilizer":7.0}}
```

The terminal event then needs `bootId`, `waterFlowTotalL`, `fertFlowTotalL`,
`waterVolumeL`, `fertVolumeL`, `waterOnSeconds`,
`fertilizerOnSeconds`, true `flowValid`, `volumeEstimated=false`,
`safeShutdownComplete=true` and pump actual-state OFF. The field names
for cumulative counters are **proposed adapter semantics, not a claim that
firmware 1.5.03 emits these exact JSON keys**.

Do not activate execution based on these tests. The original firmware protocol
still does not establish volume-only authority, per-pump active time, or
finality/abort guarantees.

## Why not cherry-pick python-ai migrations 034/035?

Foundation already owns those migration numbers, and the other branch has
different storage, obligations and application semantics. Port only
reviewed algorithms to `spff_ai.engine_state`, which already persists
JSONB state atomically with a PostgreSQL advisory transaction lock.
No operational DB schema changed.

## Run verification on detached development worktree

```bash
cd /tmp/spff-ai-phase2-test
git status --short
git fetch origin integration/unified-adaptive-ai
git checkout --detach FETCH_HEAD
cd standalone-ai
python -m unittest discover -s tests -v
```

For all PostgreSQL integration tests, use a **disposable temporary cluster**.
Avoid pointing `AI_TEST_DATABASE_DSN` at production `spff`.

```bash
cd /tmp/spff-ai-phase2-test/standalone-ai
pg_virtualenv -v 14 bash -c '
  set -e
  test "$(psql -XAtqc "SELECT to_regnamespace('\''spff'\'') IS NULL")" = "t"
  export AI_TEST_DATABASE_DSN="service=$PGVERSION"
  python -m unittest discover -s tests -v
'
```

At repo root also run `npm run build` and `npm run lint`.
Previous Fase 2 had 106/106 software tests passing; **these Fase 3 changes
must be tested again**. Existing Node audit findings should be triaged
separately before any production deployment.
