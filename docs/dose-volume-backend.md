# Guide dose / measured-volume backend

This is a separate execution protocol (`spff-dose-volume-v1`), not a relaxation
of the EC adaptive controller. The backend supports planning, durable approvals,
outbox dispatch, STOP, evidence-based kilogram credit and explicit reconciliation.
Firmware 1.5.07 does not implement this protocol and is refused. Deployment
leaves `SPFF_DOSE_VOLUME_DISPATCH_ENABLED=false` in API and MQTT Worker.
The existing dashboard ACC button still uses the older EC endpoint; firmware
and UI integration with the new endpoints are subsequent work.

## Operator flow

1. Request a plan using only the selected HST obligation ID, or select a Guide
   program/activity for water-only. Product, remaining grams, device and Guide
   revisions are read on the server. No browser-selected mass, EC or pump volume.
2. The existing approved AVAILABLE_TANK Fuzzy result must be fresh and request
   irrigation. Soil/tank readings must match the program's device in PostgreSQL.
3. Recipe shows the total single-product fertilizer mass and final batch liters
   to prepare. It is a preparation instruction, not proof that an arbitrary
   existing tank already contains that mass. The operator confirms the prepared
   final batch (including accounted-for residue), without retyping Guide doses.
4. Commissioned device capabilities supply meter placement, low-level cutoffs,
   priming/flushing, flow, duration and meter tolerance. These are never inferred
   from simulation defaults. Missing capabilities leave calculated session
   targets null and explain that firmware commissioning is required.
5. ACC pins the reviewed recipe and revisions, rechecks fresh Fuzzy/sensors,
   mode, boot, actual outputs OFF, SHADOW OFF and relay ownership. In one
   transaction it stores a session, immutable approval binding and START outbox.
6. One START per plan/approval; uncertain publishing is never replayed. STOP
   remains eligible even while START dispatch is disabled. Existing manual-STOP
   and uncertainty DB triggers are retained; their emergency STOP is normalized
   to the session's protocol before serial dispatch.
7. A terminal ACK and measured terminal telemetry must agree on boot, session
   and terminal state and confirm both pumps OFF. Only then is mass credited
   from measured stock liters × operator-confirmed nominal recipe concentration.
   Duplicate packets cannot credit twice. Partial verified delivery leaves the
   rest visible in HST kilograms. No credit from estimated meters, wrong boot,
   counter rollback, unresolved uncertainty or a bare operator ACC.

The tank display remains a linear inventory estimate. Recipe confirmation is
an explicit confirmation of the batch actually prepared, including its final
volume; it does not magically calibrate the inventory sensor. Meter-based mass
is nominal recipe accounting, not a chemical measurement of delivered mass.
The worker records whether evidence is DEVICE_TERMINAL_MEASURED or an explicit
OPERATOR_RECONCILED observation. Uncertain delivery requires a measured/admin
reconciliation with pumps OFF and all commands expired.

## Budgets and Guide methods

For 400 g remaining, a final prepared batch of 100 L has nominal concentration
4 g/L. With 10 L stock held below the commissioned cutoff, the session can
deliver 90 L / 360 g, leaving 40 g. Water targets use actual available inventory
above the commissioned cutoff, not nominal 5,000 L capacity or fuzzy score times
inventory. Priming/flushing must fit that water budget. After-injector water
meters count the stock contribution in their commanded meter target.

Plans reference one product at a time, including a selected row in a multi-product
Guide activity. They do not silently combine products or certify solubility or
compatibility. Semprot/Tabur retain their source method; an explicit route approval
is required before using a prepared product via the pump. Future HST activities
are blocked; overdue ones require explicit review/confirmation. Existing manual
completion and legacy EC delivery history are not silently re-applied or migrated.

## Authenticated API (existing login/site scope)

- `GET /api/unified-ai/hst/dose-volume/readiness?deviceId=...` operator
- `POST /api/unified-ai/hst/dose-volume/plans` operator + CSRF
- `POST /api/unified-ai/hst/dose-volume/approvals` operator + CSRF
- `GET /api/unified-ai/hst/dose-volume/sessions/:id` operator
- `POST /api/unified-ai/hst/dose-volume/sessions/:id/stop` operator + CSRF
- `POST /api/unified-ai/hst/dose-volume/sessions/:id/reconcile` admin + CSRF

Plan requests:

```json
{"mode":"fertigation","requestId":"UUID","obligationId":"64-lowercase-hex"}
```

```json
{"mode":"water_only","requestId":"UUID","programId":"UUID","activityId":"row-19"}
```

ACC, after the returned recipe is prepared/reviewed:

```json
{"planId":"UUID","approvalId":"UUID","preparedBatchConfirmed":true,"confirmApplicationRoute":true,"confirmPastDue":true}
```

Route/overdue flags only apply when the source plan requires them; they do not
override device or sensor faults. Reuse an approval UUID only for an exact retry.
The response to ACC is durable command creation, not proof the pumps switched ON.

STOP body: `{"requestId":"UUID"}`. Reconciliation body additionally requires
`pumpsOffVerified:true`, `waterVolumeL`, `stockVolumeL` and a measurement `reference`.

## Firmware contract

Contracts are exported from `packages/contracts/src/doseVolume.ts`. Heartbeat must
declare a fresh `doseVolumeV1` object matching `doseVolumeCapabilitySchema`, a
non-legacy firmware version, current boot ID, actual idle relay readback and
MANUAL applied mode with competing automatic rules disabled.

New serial command kind: `dose_volume_command`, algorithm `guide_dose_volume_v1`.
START binds current boot and expires within 20 s. It carries water/stock meter
targets, nominal batch concentration, planned mass and commissioned limits.
Firmware must enforce flow/level/timeout/STOP locally, own relay arbitration,
refuse replay, stop after reboot, and report real totalizer deltas (never guesses).
New reports are `dose_volume_ack` and `dose_volume_telemetry`. Terminal telemetry
uses the START command ID; a STOP ACK uses that STOP's command ID. Both carry the
same session/boot identity. Supported states and strict fields are in the schemas.
EC values are not part of this command or completion proof.

Existing typed MQTT envelopes and durable Edge outbox are reused; no new broker
topic/ACL or second serial writer. Edge loads the updated contracts on restart.
Legacy EC frames keep their original strict contract and gates.

## Install on Orange Pi

Turn SHADOW ON and finish/stop all active sessions before deploying:

```bash
cd /home/orangepi/spff-hst-mode-preview &&
git fetch origin &&
git merge --ff-only origin/feature/hst-shadow-real-test-switch-20261104 &&
sudo bash scripts/hst-orange-backend.sh deploy "$PWD" &&
sudo bash scripts/hst-orange-backend.sh dose-volume-status "$PWD"
```

Deployment backs up PostgreSQL, applies migration 039, preserves local routes
and frontend source through the existing surgical merge, swaps compiled modules
with rollback, reloads Edge's shared contracts and verifies all dispatch gates
OFF. No firmware is flashed; no existing stock profile is fabricated or required
for this new recipe-preparation protocol. Do not use the old `enable` command
to arm the volume path; that command belongs to the EC/HST path.

## Validation

Pure contract tests and isolated PostgreSQL/PGlite integration tests cover
recipe/reserve math, unsupported firmware, changed Guide data, explicit route
approval, concurrent idempotent ACC, session ownership, ACK/telemetry order,
duplicate events, wrong boot, estimated counters, counter rollback, STOP,
water-only, expired plans and audited partial reconciliation. PGlite tests run
only with `SPFF_TEST_PGLITE_MODULE` set to an isolated PGlite module.
These tests do not constitute a physical pump or firmware commissioning test.
