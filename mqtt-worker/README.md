# SPFF MQTT Worker

Local MQTT worker for SPFF Smart Fertigasi.

## Responsibilities

- Subscribe to SPFF telemetry, acknowledgement, actuator-state, and device-status topics with MQTT QoS 1.
- Validate uplink payloads with `@spff/contracts`.
- Persist telemetry, ACKs, device status, and actuator state to local PostgreSQL.
- Evaluate enabled `spff.actuator_schedules` using each site's IANA timezone (normally `Asia/Jakarta`).
- Generate idempotent ON/OFF rows in `spff.control_commands` when a schedule occurrence is due.
- Keep schedule occurrence history in `spff.actuator_schedule_runs` so polling, restart, or multiple workers do not create the same occurrence twice.
- Poll `spff.control_commands` for unexpired `pending` commands.
- Publish pump commands to `spff/v1/{siteId}/{deviceId}/commands` with QoS 1.
- Mark a command `published` only after the MQTT publish callback completes.
- Keep a command `pending` on transient MQTT publish failure so the next poll retries it.
- Mark expired `pending/published/accepted` commands as `timed_out`.
- On ACK with `actualState`, append the reported pump state to `spff.actuator_state_events`.

The ESP32/edge side must treat `commandId` idempotently because QoS 1 and retry after uncertain connection failures can deliver a command more than once.

## Scheduler compatibility

The worker reads `spff.actuator_schedules` through `to_jsonb(...)` and accepts the current SPFF naming plus common snake/camel aliases. It requires a schedule id, actuator key, repeat rule, and ON time. OFF can be represented by an OFF/end time or a positive duration. `once` schedules also require a date.

The evaluator supports `daily`, `weekdays`, `weekends`, and `once`. A lookback window catches short worker/server interruptions. If both a missed ON and its later OFF are inside the same catch-up window, only the newest desired state is generated so a pump is not briefly turned on just to be immediately turned off.

## Migration

Before starting this scheduler-enabled worker, apply:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_actuator_schedule_runs.sql
```

The migration only adds schedule-run/idempotency history. It does not modify existing schedule rows or actuator state.

## Environment

See `.env.example`. `DATABASE_URL` and the MQTT connection settings are required for the real runtime.

- `COMMAND_POLL_INTERVAL_MS` defaults to `1000` ms.
- `COMMAND_BATCH_SIZE` defaults to `20`.
- `SCHEDULE_POLL_INTERVAL_MS` defaults to `1000` ms.
- `SCHEDULE_LOOKBACK_SECONDS` defaults to `120` seconds.
- `COMMAND_EXPIRY_SECONDS` defaults to `30` seconds for newly generated schedule commands.

## Commands

```bash
npm run build
npm run lint
npm run test
npm run dev
```
