# SPFF Stage 3 — PostgreSQL safety evidence (read-only)

Adds `GET /api/unified-ai/safety-evidence` to:
- operational API after `requireAuth` + `requireOperator`
- DEV localhost-only preview API (port 5002, no login; MUST NOT be exposed publicly)

This is a **read-only safety evidence report**, not a control authorization. Output
always has `status=BLOCKED`, `canDispatch=false`, `commandCreated=false`.
One observation being PASS is not an approval. Staging intentionally does not
write, queue, publish, evaluate AI, or actuate.

## Data sources

The PostgreSQL adapter reads a consistent, explicit READ ONLY transaction:

- `spff.devices`
- `spff.device_status_events` (recorded/received timestamps + mode)
- `spff.telemetry_samples`
- `spff.latest_actuator_states` (both pumps must report OFF and fresh)
- `spff.device_automatic_control_configs` (desired/applied mode + ACK revision)
- `spff.device_water_interlock_configs` (ACK and reported firmware revision)
- `spff.control_commands` (pending/published/accepted)
- `spff.actuator_schedules` (any enabled pump schedule blocks)
- `spff.soil_ec_pulse_sessions`
- `spff.adaptive_fert_sessions`

No raw `SELECT *` telemetry payloads are returned. Queries use parameters and
recorded/received freshness limits (90s device, 120s telemetry, 90s pump state).
A missing migration/table/permission, invalid configuration, old timestamps,
ambiguous state, missing ACK, or an unreachable PostgreSQL returns blocked or
unknown, never an executable command.

**Critical gaps remain UNKNOWN by design**: boot/session identity verification
and calibrated hydraulic volume. Existing PostgreSQL rows are not sufficient
to prove firmware execution safety.

## Dedicated database permissions

DB safety reading is **OFF by default**. Do not silently reuse writable API
database credentials; request a dedicated PostgreSQL SELECT-only role with access
to the above tables/views from the local database administrator.

Only after provisioning least-privilege credentials, provide the following via a
secure, root-restricted systemd EnvironmentFile in a later, explicitly approved
staging rollout (never paste secrets into chat or commit them):

```text
SPFF_AI_SAFETY_DB_ENABLED=true
SPFF_AI_SAFETY_SITE_ID=greenhouse-01
SPFF_AI_SAFETY_DEVICE_ID=<actual verified ESP32 deviceId>
SPFF_AI_SAFETY_PGHOST=127.0.0.1
SPFF_AI_SAFETY_PGPORT=5432
SPFF_AI_SAFETY_PGDATABASE=spff
SPFF_AI_SAFETY_PGUSER=<dedicated SELECT-only role>
SPFF_AI_SAFETY_PGPASSWORD=<secret>
```

These are examples, not confirmed site/device configuration. The adapter also
uses `default_transaction_read_only=on` and an explicit
`BEGIN ... READ ONLY` transaction. In the absence of credentials, report
`source=NOT_CONFIGURED` and UNKNOWN gates, not fabricated healthy data.

## Test before rollout

```bash
npm run build
npm run lint
node --test functions/test/aiSafetyGates.test.mjs \
  functions/test/aiPreviewDispatchReadiness.test.mjs
```

The preview process continues to listen only on `127.0.0.1`. No MQTT,
pump commands, DB migrations, or deployment changes in this stage.
