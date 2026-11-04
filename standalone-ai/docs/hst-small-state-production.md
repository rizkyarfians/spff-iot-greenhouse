# HST SHADOW compact PostgreSQL state (production rollout)

## Problem verified on 2026-11-04

The production `spff_ai.engine_state` legacy scope contains a JSONB payload of
56,549,132 bytes (roughly 56 MB) and total table storage of 113 MB.
Read-only `SELECT payload` measured about 9.7 seconds, exceeding the existing
5-second AI endpoint timeout; `SELECT payload->'hst_workflow'` took about
0.55 seconds. The operational SPFF API, MQTT Worker and Edge Gateway remained healthy.

## Isolation without deleting historical state

- Legacy scope: `{site}/{device}/{zone}/source-shadow`, unchanged.
- HST-only scope: `{site}/{device}/{zone}/source-shadow/hst-v1`.
- Both use the **same** local `spff_ai.engine_state` PostgreSQL table, not a new
  database, microSD or Firebase.
- A one-time `app.migrate_hst_scope.migrate()` copies **only**
  `payload->'hst_workflow'` from legacy scope into the new scope, using
  `INSERT ... ON CONFLICT DO NOTHING`. It never overwrites a newer HST
  obligation, approval, progress, or UUID.
- Legacy decisions, feedback, water plans and old state remain on the existing
  row. A previous production `engine_state` backup must be verified before
  running this migration.
- The HST scheduled poll, proposal GET, and authenticated ACC review use the
  new small scope. `/ready` and `/status` do too. The dashboard summary
  only extracts its existing required legacy planning/carry-over keys.
- `/decisions` still reads the legacy history and may remain slow; it is not
  used for HST proposal/ACC. The status API reports the legacy count as null
  rather than pretending the archived count is zero.

## Safety/rollback

AI runs `SHADOW_MODE`, binds only `127.0.0.1:5010` and never dispatches an
MQTT pump command. Node API operator identity, role and CSRF are mandatory for
HST approval. An ACC is a recorded sensor review, not physical fertilizer
delivery. No firmware or worker has been modified.

Code/service rollback leaves the newly added HST scope row untouched; it is
non-destructive and safe to reuse on a later deployment. Do **not** delete the
legacy state or the new HST row during rollback. Older code uses only its
legacy scope, and therefore ignores the new HST scope.

Production verification must include Python unit tests, local Node build/lint,
state migration result counts, HTTP `/health`, `/status`, `/ready`,
`/hst/proposals`, unauthenticated `POST /hst/approvals` rejection, and an
authenticated operator review only from the actual dashboard.
