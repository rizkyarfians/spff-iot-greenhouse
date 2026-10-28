# Adaptive fertigation backend for firmware 1.5.00

This change targets feature/fertigation-foundation-20261018. It includes no firmware
or frontend changes. Firmware owns local EC hysteresis and relay switching. Orange
Pi owns guide activities, immutable program/conversion snapshots, per-session dose
allocation, command transport, receipt history and estimated multi-day mass progress.

## Contract and accounting

The serial command is exactly adaptive_fert_command schemaVersion 1, with flattened
fields read by v1.5.00. Every START includes all eight supported configuration
values; there are no backend defaults for crop EC or target dose. Firmware's allowed
ranges are enforced, including its 1 L minimum fertilizer target. Smaller remaining
batches are rejected, never rounded up to overdose or silently given a firmware default.

The mandatory EC conversion backend from migration 035 is included. A technician
creates the exact product/ratio profile with the existing guide-program EC profile
API. The program needs a measured raw-water EC. Its recipe and final-solution
volume produce concentration and an interpolated liquid EC target; the start command
uses this target * 1000 in microSiemens/cm. The profile revision and result are pinned
in the session. Manual EC targets are rejected by strict session input validation.
Profiles with unsupported quantities, inconsistent units, out-of-range concentration
or missing evidence do not permit session creation. No calibration values are seeded.

nominalConcentrationGPerL means STOCK concentration, unlike the final mixture's
concentration used in EC conversion. Meter placement is explicit. With Cmix and
Cstock (g/L), before-injector water measurement requires:

    stock L = Cmix * water L / (Cstock - Cmix)

For an after-injector mixed-water meter:

    stock L = Cmix * mixed L / Cstock

Stock concentration must exceed mixture concentration. Stock volume is capped by
remaining mass / stock concentration; the water target is reduced proportionally
to preserve the recipe. The session water target excludes the additional firmware
flush; firmware finishes flushing by time. Meter placement and injector hydraulics
must match the measured commissioning reference supplied with each request.

A session entering reconciliation cancels an unsent START and queues one STOP attempt, then opens one durable warning in the existing alarm/bell system; repeated telemetry does not recreate a dismissed incident. Operator reconciliation supplies recovery. Alarm failures do not roll back a safety stop or telemetry persistence.

Progress uses MAX cumulative fertilizer volume per tracked session, multiplied by
its pinned nominal stock concentration, summed across sessions of the same activity
fingerprint. This is estimated injected mass, not an independent measurement of
individual nutrient uptake. Identical packets never add another dose. Out-of-order
packets remain in history; volume decreases, inconsistent reported mass, large
overshoot, firmware faults or missing telemetry require reconciliation. Recipe
changes after delivery block further allocation against that activity until the
cross-revision dose is resolved. They never reset spent mass silently.

## Endpoints (all under /api)

- POST /adaptive-fertigation/preview (Operator/Admin + CSRF)
- POST /adaptive-fertigation/sessions (Operator/Admin + CSRF)
- GET /adaptive-fertigation/sessions/:id (authenticated, includes command/ACK/event history)
- GET /adaptive-fertigation/programs/:id/progress (authenticated)
- POST /adaptive-fertigation/sessions/:id/control (Operator/Admin + CSRF)
- POST /adaptive-fertigation/sessions/:id/reconcile (Admin + CSRF)

Session input example shape (replace every value with actual validated site data):

```json
{
  "programId": "<saved guide program UUID>",
  "expectedProgramRevision": 1,
  "expectedProfileRevision": 1,
  "activityId": "row-10",
  "requestId": "<new UUID>",
  "waterMeterPosition": "before_injector",
  "waterVolumeL": 100,
  "stockConcentrationGPerL": 100,
  "ecToleranceUs": 100,
  "maxDurationSec": 600,
  "flushDurationSec": 30,
  "hydraulicsReference": "<commissioning measurement reference>"
}
```

START requires expectedProfileRevision from the reviewed conversion preview; profile edits invalidate it. Preview may omit this field. These are schema examples, not live commissioning values. Controls take requestId
and operation pause/stop/resume. Reconciliation takes pumpsOffVerified: true,
waterVolumeL, fertVolumeL and a note of at least 10 characters. It requires all
commands to have expired and cannot reduce previously observed totals. It appends
an operator audit entry and closes backend ownership; it does not reset firmware.
The operator must verify physical OFF and local controller recovery independently.

## Firmware 1.5.00 compatibility boundaries

Resume is explicitly rejected because the supplied firmware skips priming and loses
its prior state. A pause/stop ACK may reuse the start command ID: the raw ACK is
stored, but no command identity is invented. Only telemetry changes reported session
state; sending a command does not prove pumps are ON/OFF. Faults hold ownership for
operator reconciliation. Normal final telemetry must report both pumps OFF.

Dispatch is opt-in via SPFF_ADAPTIVE_FERT_DISPATCH_ENABLED=true in BOTH API and worker.
It defaults off; event reception, profiles and previews remain usable. Activation
also requires fresh online status with firmware 1.5.00-ADAPTIVE-FERTIGATION, an applied
Manual configuration, both legacy sensor rules disabled, all pump schedules disabled,
soil-EC execution disabled and no competing command/session. Fresh valid EC, tank and flow telemetry is required; both tank levels must exceed the configured equipment minimums (no minimum defaults are invented). This restricted handoff
avoids known v1.5.00 writer conflicts; it is not a claim to fix the firmware's safety
issues or a recommendation to activate before hardware validation. Database triggers
reject competing API ON, scheduler enable, mode/sensor activation and soil-EC starts.
An external dashboard OFF also queues an adaptive STOP and holds reconciliation.
Physical buttons and firmware-local failure behavior cannot be changed by this backend.

## Transport and durability

API writes immutable commands with UUID identities and a 15-second gateway expiry.
Worker claims each command durably before publishing once using MQTT QoS 0/non-retained.
A crash, publish uncertainty or missing telemetry is not retried as a new START.
Gateway unwraps the dispatch envelope, checks expiry and keeps an fsynced per-command
ledger before serial forwarding. Duplicate commands do not reach serial twice.
This favors an unresolved/lost request over repeating an action on firmware without
idempotency. The command ledger must be preserved across gateway restarts.

Firmware ACK/telemetry are wrapped as adaptive_fert_event with a deterministic SHA256
ID and sent on the existing /sessions topic. The edge outbox retains them until the
worker commits PostgreSQL and returns adaptive_fert_persisted_ack on /ack. Neither
this wrapper nor the persistence ACK requires a firmware change. Raw uncorrelated
firmware responses are retained diagnostically, not credited to another program.
The firmware can still lose its final message before the gateway sees it; telemetry
silence remains uncertain and must not be called successful completion.

## Deployment on Orange Pi

Keep the dispatch flag unset for receiving/preview mode. Existing migrations 033/034
must be installed. Apply 035 then 036 once, build all workspaces and restart all three
services (gateway is required for the new serial message kinds):

```bash
cd /opt/spff
git pull --ff-only origin feature/fertigation-foundation-20261018
sudo -u postgres psql -X -d spff -v ON_ERROR_STOP=1 \
  -f infrastructure/postgres/migrations/035_guide_ec_conversion.sql
sudo -u postgres psql -X -d spff -v ON_ERROR_STOP=1 \
  -f infrastructure/postgres/migrations/036_adaptive_fertigation_backend.sql
umask 022
npm run build
sudo systemctl restart spff-api spff-mqtt-worker spff-edge-gateway
```

No live command is generated by deployment. No adaptive UI or autonomous daily
scheduler is included in this backend change. The API is ready for Control-page
integration after site-specific profiles/hydraulics and hardware validation.

## Orange Pi clock synchronization

The gateway also preserves the site's host-to-controller time sync. It uses the
existing serial writer, never a separate process opening the ESP USB port. A valid
Chrony tracking result is required (normal leap state, stratum 1–15, offset below
5 seconds, recent reference time). The host sends UTC epoch; firmware applies its
local timezone. A matching applied time_sync_ack confirms success, with an hourly
refresh and a fresh attempt after serial reconnect. Unsuccessful checks/attempts
are rate-limited to one per minute. chronyc must be accessible to the service user.
No firmware, database migration or serial ownership change is introduced by this
clock-sync integration. Do not reapply an older local index.ts time-sync patch on
top of it; keep that patch only as backup.
