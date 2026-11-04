# SPFF AI V2 — HST-triggered proposals, operator ACC per session

## Intended behavior

The Python engine no longer evaluates and persists a new source-shadow decision
for each telemetry sample. `SPFFSource.record_shadow` now reads only saved Guide
programs through `inspect_guides`; a scan interval of at least 300 seconds is
used when background scanning is enabled. The Guide determines HST in
Asia/Jakarta. Scans are idempotent: **no due HST + no tracked pending V2 duty
means no AI-state mutation or new audit checkpoint**. The operational MQTT
worker and PostgreSQL telemetry pipeline continue independently.

For a due fertilizer product, the AI persists one obligation and one compact
proposal. Its identity includes program, planting date, activity and source
product row. Different products remain separate; no EC-derived fertilizer mass.
A target is taken from the already-scaled Guide amount. Changed guide
revision, invalid dose, or manual completion must be reviewed; an old Guide
checkbox does **not** prove measured fertilizer delivery. Past due obligations
already tracked by this V2 ledger remain pending, but an old missed activity
first encountered after HST is not assumed physically unpaid.

**Important migration boundary:** V2 stores its own
`engine_state.payload.hst_workflow.{obligations,proposals,approvals}`. It does
not import old `live.obligations` or the 4,459 legacy development decisions.
Legacy data remains readable under `/decisions` but is not an active AI
recommendation, and legacy input snapshots are not copied into new proposals.

## ACC lifecycle

1. Due HST creates a proposal with target, delivered and remaining mass.
2. Authenticated operator views `GET /api/unified-ai/hst/proposals`.
3. Operator confirms one proposed session, supplies a fresh UUID and the exact
   remaining mass seen on screen.
4. Local Node API enforces login, operator role and CSRF. Its internal relay
   adds the authenticated username and the server-only
   `AI_HST_BRIDGE_KEY` secret; browsers never receive the secret.
5. Python `POST /hst/approvals` accepts the relay only if its matching
   secret (min. 32 chars) is configured. This request **first reads actual
   source telemetry**, then validates time, device mode, tank water, fertilizer
   tank, Soil 2 evidence, planning profile and stock binding.
6. The result is a **SHADOW_REVIEW_BLOCKED** event with a bounded plan
   preview when possible. It creates no MQTT command, pump session or
   delivered fertilizer credit; `can_dispatch` is always false.
7. A separate operator ACC with a fresh UUID is required for another
   session/day. A reused UUID returns the same event only if actor, obligation
   and expected remaining mass match; otherwise it is rejected.
8. Future partial completion may be credited ONLY from an explicitly bound,
   verified hardware session result with actual delivered mass, not from
   clicking ACC. Pending remainder is preserved across dates/restarts.

No realtime safety loop is transferred to the AI. ESP32 remains authoritative
for interlocks, selector Manual/Automatic, actual state and failsafe behavior.

## Currently not implemented / do not enable physically

- Fertilizer volume-session executor, MQTT command lifecycle and matching
  hardware ACK to a V2 HST obligation.
- Crediting the new V2 duty from verified physical flow and stock concentration.
- Reconciliation UI for an invalid dose, manual Guide completion or conflicting
  program revisions.
- Hardware commissioning of end-to-end ESP32 + broker + Node + PostgreSQL.
- Automatic missed-HST catch-up for old first-import programs; requires
  reconciliation instead of a blind replay.

The existing supervised *water-only trial* is a different subsystem; HST ACC
must never invoke it or assert that fertigation was delivered.

## Configuration (staging only; no deployment performed)

- `AI_POLL_ENABLED` remains opt-in; enabled scheduling scans at most once
  per five minutes even if a legacy `AI_POLL_SECONDS=10` is present.
- `AI_HST_BRIDGE_KEY` is empty by default. Set the same strong independent
  random secret in the Python AI service and the local Node API environment.
  Do **not** commit this secret or expose it in frontend variables.
- Python service is expected on Node-accessible localhost
  `127.0.0.1:5011` as per the existing unified AI API proxy.
- New routes:
  - Python `GET /hst/proposals`, `POST /hst/approvals` (secret required).
  - Node `GET /api/unified-ai/hst/proposals` (operator auth).
  - Node `POST /api/unified-ai/hst/approvals` (operator auth + CSRF).
- The new HST panel in the Unified AI page is non-actuating. Existing
  dashboard legacy control previews are not HST approvals.

## Verification plan

In a development checkout, run:

```sh
cd standalone-ai
python -m unittest discover -s tests -p 'test_hst_workflow.py'
python -m unittest discover -s tests -p 'test_live_source.py'
python -m unittest discover -s tests -p 'test_api.py'
cd ..
npm run build
npm run lint
```

Perform additional integration checks using a disposable PostgreSQL database
before running any migration on Orange Pi. Do not start the production AI
service until secret configuration, schema, HST dates and safety gates are
reviewed. Existing 121 GB audit cleanup was a separate operation; this
branch does not truncate, delete, backfill or deploy anything.
