# SPFF HST → Physical Adaptive Fertigation (1.5.07)

## What this feature branch actually implements

Unlike the first SHADOW-preview branch, this branch **does contain an end-to-end
real-session code path** behind two disabled-by-default runtime safety gates.
The user's desired path is:

```
Panduan HST proposal (Python AI, local)
 -> Operator selects TEST REAL + checks stock/hydraulic profile
 -> Operator confirms ACC REAL (auth + CSRF + immutable approval UUID)
 -> Node API requests AI HST review (bounded sensors + calculated mass/stock/water)
 -> Node API validates one guide requirement, one fertilizer product,
    program/EC revisions, physical stock concentration, AI plan mass and water
 -> One PostgreSQL transaction: spff.adaptive_fert_sessions +
    spff.adaptive_fert_commands + spff.hst_real_sessions
 -> existing MQTT Worker -> Mosquitto QoS1 -> Edge serial guard -> ESP32-S3
 -> ESP32 owns pump control, interlocks, STOP, timeout, actual state
 -> adaptive ACK + measured telemetry -> MQTT Worker -> PostgreSQL
 -> Panduan HST polls real session state and exposes STOP
```

An HTTP `202 Accepted` means **durable command creation**, NOT pump switched ON.

## Database changes

Migration `037_hst_real_adaptive_binding.sql` creates:
- `spff.hst_real_profiles` for a **verified** site/device/program/activity/source
  row, a *single* fertilizer product and its actual stock concentration,
  water-meter placement, calibration reference, flush/timeout/EC limits, and
  exact guide/EC profile revisions.
- `spff.hst_real_sessions` binds one immutable operator approval UUID and
  AI plan snapshot to the adaptive session. Strong FK to the durable command
  ledger; repeated approval IDs cannot create a second session.

Migration 037 must be applied through the normal migration process before
enabling the HST physical flag. Never alter old production rows by hand.

## Authenticated endpoints

```text
GET  /api/unified-ai/hst/real-preview/:obligationId         operator
GET  /api/unified-ai/hst/real-profile?programId=&activityId=&sourceRow= operator
PUT  /api/unified-ai/hst/real-profile                 admin + CSRF
POST /api/unified-ai/hst/real-sessions                 operator + CSRF
GET  /api/unified-ai/hst/real-sessions/:sessionId      operator
GET  /api/unified-ai/hst/real-sessions/latest/:obligationId  operator
POST /api/unified-ai/hst/real-sessions/:sessionId/stop operator + CSRF
```

`POST /real-sessions` body (browser never sends water, pump ON/OFF, EC, or
manual hardware commands):

```json
{
  "obligationId": "64 lowercase hex characters",
  "approvalId": "fresh UUID v4, reused on uncertain retry",
  "expectedRemainingG": 123.45,
  "confirmation": "EXECUTE_HST_REAL_ADAPTIVE_SESSION"
}
```

The API reads configuration from PostgreSQL and the calculation from a
verified Python AI HST **SHADOW review**. That review is NOT actuator
authorization; the separate, explicit REAL ACC and local hardware checks are.
All unexpected AI hold reasons block physical execution. The device must be
online, mode MANUAL, fresh and acknowledged, with both relays OFF and no
competing schedule/control/session. The stock concentration implied by AI
`mass_g/stock_l` must exactly agree with the admin-verified physical stock
profile. If the water meter is after the Venturi injector, command water
meter target includes stock volume; if before, it uses pure water volume.
Never guess the meter position.

## Runtime feature gates (disabled by default)

Both must be deliberately enabled **only after** testing and operational
approval, and the MQTT Worker must receive the adaptive flag too:

```text
SPFF_HST_REAL_DISPATCH_ENABLED=true       (Node API)
SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=true  (Node API and MQTT Worker)
```

Do **not** enable these by merely deploying the current branch. The standalone
Python AI service remains SHADOW for its proposal/plan calculation. The water-only
AI trial capability reported `false` in the ESP32 heartbeat is separate and
not used by this physical fertigation code path.

## Progress / idempotency / ACK rules

- The HTTP API does not publish MQTT; PostgreSQL is source of truth.
- The dispatcher never retries an uncertain physical START automatically.
- Two concurrent ACCs for a duty serialize under the HST advisory lock and
  cannot create overlapping active sessions.
- User can reload the page: latest real session is recovered from DB.
- STOP is idempotent and does not claim to have physically stopped the relay
  until the MCU confirms it.
- A session can become `completed` only after device terminal ACK correlates
  with the matching boot/session AND measured terminal telemetry verifies
  both pumps OFF. Uncertain flow, wrong boot, relay unknown and estimated
  volume require reconciliation and **never increase credited dose**.

## Not yet proven / commissioning required

This is new production-capable source code, **not a certified physical run**.
Before enabling dispatch on Orange Pi:

1. Install migration 037 on a test PostgreSQL instance and run build, lint,
   contract tests, and PGlite integration tests. There is no live production
   database available to this development session.
2. Audit the currently installed `1.5.07-AI-ACC-SESSION` boot identity,
   serial START parser, MOSQUITTO/edge topic ACLs, relay interlock, and
   independent physical pump cutoffs.
3. Configure Python HST runtime planning profile and verified stock binding:
   AI shadow review must return a complete `water_l/stock_l/mass_g` plan.
   Node's admin profile alone does **not** configure Python AI.
4. Configure a *single* verified fertilizer stock for an eligible HST activity.
   Activity `row-16` has multiple products in the observed schedule and
   is **intentionally blocked** until the operator validates a distinct
   product/session plan. Never merge fertilizer products silently.
5. Run isolated water-first commissioning, validate flow-meter calibration,
   ACK correlation, relay actual OFF, timeout/reboot/serial failure/expired
   command behavior, and local manual emergency stop before using fertilizer.
6. Confirm rollback/backups for runtime build artifacts and database migration.
   Existing `/opt/spff` has local source changes; no `git reset --hard`,
   blind checkout or blind copy onto it.

**Important functional limit:** Python's persisted HST obligation ledger has
NOT yet been transactionally synchronized from `spff.hst_real_sessions`.
The Node adaptive session's measured progress is displayed separately.
If a physical session was partial, the next HST ACC is deliberately blocked
when the Python expected remaining mass disagrees with PostgreSQL's measured
adaptive progress. That is safer than silently repeating a dose; completion
and future multi-session HST allocation need a verified feedback bridge.

## Local staging preflight (does not drive the pumps)

```bash
cd ~/spff-hst-mode-preview
git fetch origin
git merge --ff-only origin/feature/hst-shadow-real-test-switch-20261104
npm ci --no-audit --no-fund
npm run build
npm run lint
npm run test --workspace @spff/contracts
npm run test --workspace frontend
npm run test --workspace @spff/edge-gateway
npm run test --workspace @spff/mqtt-worker
```

The PGlite integration tests are optional when
`SPFF_TEST_PGLITE_MODULE` is not configured. A skipped integration test
must never be reported as a pass. All production services remain untouched
by the above staging commands.

## Orange Pi backend rollout and SHADOW authority (November 2026)

SHADOW MODE is now a **single shared PostgreSQL setting** in additive
migration `038_hst_shadow_mode.sql`, default **ON** for every site. The
dashboard obtains it from authenticated `GET /api/unified-ai/hst/mode` and
admin updates it with CSRF-protected `PUT /api/unified-ai/hst/mode`.
The API checks SHADOW OFF again inside the same PostgreSQL transaction
that reserves the HST session + START command. A concurrent switch to
SHADOW ON is rejected while a physical HST session is unfinished; operators
must STOP/reconcile first. Neither toggling nor deploying drives a pump.

Run on the actual Orange Pi via PuTTY (checkout already cloned):

```bash
cd ~/spff-hst-mode-preview
git fetch origin
git merge --ff-only origin/feature/hst-shadow-real-test-switch-20261104
bash -n scripts/hst-orange-backend.sh
sudo bash scripts/hst-orange-backend.sh deploy "$PWD"
```

The deploy command checks production health and 034-036, executes build/lint/
tests from staging, preserves local frontend TS/CSS by compiling a disposable
merged copy, patches HST API routes into a copy of the live router, backs up
the database, applies additive 037+038, and swaps ONLY compiled runtime
directories with rollback. It deliberately leaves physical START gates OFF,
does not flash firmware, and does not overwrite `/opt/spff` source.

To commission, while physically supervising isolated pumps:
- Switch SHADOW OFF and use the admin panel to bind one fertilizer product,
  actual stock concentration, and validated EC and hydraulic profiles.
- Check the MCU hardware selector MANUAL, validated sensors, emergency STOP,
  actual relay readback and no competing schedules or sessions.
- Arm only after the independent commissioning checks:

```bash
sudo bash scripts/hst-orange-backend.sh enable "$PWD"
sudo bash scripts/hst-orange-backend.sh status "$PWD"
```

Operator must type an explicit physical arming confirmation. This permits
**future** authenticated ACC actions; it does not start a pump on its own.
For emergency physical STOP, use the ESP32-local selector/kill mechanism;
turning SHADOW ON or running `disable` cannot guarantee a running pump
has already stopped. To disable new dispatches from the API/worker:

```bash
sudo bash scripts/hst-orange-backend.sh disable "$PWD"
```

Current verification boundaries: GitHub code has been written, but this
development environment has no SSH connection to the Orange Pi or a full
npm checkout to run builds/lint. Earlier ARM64 contract tests passed, while
the HST PostgreSQL integration test was skipped without PGlite. Running the
rollout is *not* evidence of physical pump functionality. Never bypass
preflight or claim successful pump state without MCU ACK and actual telemetry.
