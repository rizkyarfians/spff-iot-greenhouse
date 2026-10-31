# Python live-source shadow decisions

This update reconnects the implementation to the requested architecture: Python
reads saved Panduan/HST schedules and telemetry, persists per-product obligations,
and proposes fertilization before considering ordinary Mamdani irrigation.
An EC target, EC conversion curve and manually entered source-water EC are **not
required for scheduling**. No sensor EC is converted directly into fertilizer grams.

## Implemented and wired

`POST /source/evaluate` and optional background polling now run LiveEngine instead
of returning a constant compatibility HOLD. They use the read-only PostgreSQL
snapshot already fetched by SPFFSource. Real obligations, decisions, remaining
mass, states and evidence are stored atomically under the live ledger in the
AI-owned store. `GET /obligations`, `/live/state` and `/decisions` expose that work.
Database scope is stable across model changes; changing a program revision does
not create a second obligation for the same product/application.

Quantities come from the web's already-scaled saved program. Products stay
separate. Non-fertilizer categories are not relabeled as fertilizer. Source
warnings, invalid units, conflicting program revisions and changed bindings are
review states. Past applications imported for the first time are reviewed rather
than presumed unpaid. Manual completion is not measured pump delivery and also
requires dose reconciliation before any repeat. On the operator's current program,
HST 10 is past and manually completed; the engine will NOT fertilize it again.

A validated profile allows session estimates from actual tank level, configured
curve/reserve, and pump flows, or Mamdani ordinary irrigation if no duty remains.
Ordinary irrigation has zero stock volume. Low water and stable refill affect the
obligation state; Manual revokes unattended resumption. Repeated identical input
does not create duplicate obligations or decisions. New samples may create new
decisions, which is distinct from issuing actuator commands.

Profiles are read from `spff_ai.runtime_profiles`; the versioned admin CLI
`python -m app.configure_live /path/to/calibrated-profile.json --actor <name>`
validates/stores them with history. A profile contains `version`, `planning`
(the existing Config fields, with matching version and simulation_only=false),
optional per-product `stocks` (program_id,activity_id,source_row,batch_id,
concentration_g_l,verified), and missed_schedule_policy=review. There is no
default operational profile; examples/nominal values are never silently promoted.

Mass balance is per session volume × bound stock concentration. `live_feedback`
processes database-origin events only for sessions explicitly bound by a future
dispatcher. It never assigns old sessions to duties by date or product name.
Replay does not double dose/EMA. Counter regressions, wrong boot, invalid meters,
estimated volumes and uncertain shutdown require reconciliation. EMA flow updates
require valid per-pump ON durations; wall-clock session time is not substituted.
The reader is wired to process explicitly bound sessions when they exist; this
release deliberately creates none because no validated volume-only dispatcher
exists yet. There is no public feedback/session-binding mutation endpoint.

## What remains incomplete

**This is still SHADOW_MODE; no physical full-loop automation is claimed.** The
current firmware uses its own EC hysteresis and requires legacy Manual for an
external session, while the requested automatic engine must respect Manual as an
operator lockout. The current MCU reports low water as FAULT, not a safely
stopped WAITING_FOR_WATER state; no generic automatic reset is added. It also
lacks a pure water-only volume session, pump-active-time feedback, and a durable
safe-shutdown-complete final result. Hence the engine reports the real scheduling
proposal and explicit execution/configuration holds. `can_dispatch` is always false.

Auto-resume and EMA mechanics are tested on authoritative synthetic bound-session
feedback. They are NOT tested or enabled for physical firmware 1.5.03 execution.
Finishing ACTIVE requires the audited executor protocol/authority changes plus
end-to-end gateway commissioning. Stock concentration remains part of mass
balance; this is not the target-EC conversion requirement that was removed.

## Orange deployment

Update only standalone source from `codex/standalone-ai-engine` and copy app,
migrations and scripts into `/opt/spff-ai`; preserve `/etc/spff-ai/engine.env`,
data and the Linux venv. Do not apply the web-conversion installer for this update.

`sudo bash /opt/spff-ai/scripts/setup-shadow-postgres.sh` explains the changes.
With `--apply` it creates only AI-owned schema/tables and a separate writer role,
adds SELECT on existing adaptive events to the reader, backs up/updates the AI
environment, enables shadow polling and restarts **only** spff-ai-engine.
It never mutates SPFF operational tables, commands, firmware or relay settings.
Existing local SQLite history remains unchanged; new live decisions use PostgreSQL.
Already configured state credentials are preserved; migrations then require a
deliberate migrator run rather than an automatic overwrite.

After update:

```bash
curl -fsS http://127.0.0.1:5010/status
curl -fsS http://127.0.0.1:5010/obligations
curl -fsS http://127.0.0.1:5010/decisions
```

## Verification

93 tests passed on CPython 3.10.11 with a fresh disposable PostgreSQL 18 cluster.
New coverage includes real 20,000-plant saved quantities, no EC scheduling gate,
calendar carry-forward versus first-import history, separate product duties,
revision/manual safeguards, fuzzy selection, tank/refill stability, Manual lockout,
PostgreSQL restart/idempotence and profile loading, feedback dedup, boot/meter
validation and distinct flow EMA. No Orange hardware tests or pump commands ran.
