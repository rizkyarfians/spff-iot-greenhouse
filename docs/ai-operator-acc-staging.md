# SPFF AI operator ACC — safe staging (2026-11-03)

## Goal
Prepare the operator-facing **AI recommendation → operator ACC → ESP32** commissioning flow without starting pumps during development. The water tank sensor is intentionally disconnected for now; do not diagnose it further or bypass its interlock.

## Implemented
- Shared strict Zod request/response contract in `@spff/contracts`.
- Authenticated operator/admin + CSRF POST `/api/unified-ai/operator-acc/dry-run` on **operational** SPFF API only. It re-fetches the trusted Python `127.0.0.1:5011/dashboard/summary`, validates the report, verifies the reviewed action and evaluation timestamp, and assesses freshness/hold blockers.
- The response is **always** `BLOCKED`, `canDispatch:false`, `commandCreated:false`, `mqttPublished:false`, `operatorApprovalRecorded:false`, and `actualPumpState:null`. No PostgreSQL AI reader setup, MQTT publish, command queue insert, or pump route call.
- Dashboard panel shows the reviewed AI action, operator confirmation checkbox, and a **check ACC (dry-run)** action. In unauthenticated preview mode it calls only read-only GET `command-preparation`, never POST.
- No changes to device mode, schedules, firmware, relay mapping, interlock, or running systemd services.

## Important limitations
- Firmware physically reported `1.5.03-SHT20-TELEMETRY-SYNC`; firmware-bound volume/time session with positive flow feedback, actuator ownership, local STOP and authoritative final OFF ACK is **not validated**.
- Device reported `degraded`; its water-tank ultrasonic input is disconnected. No safety bypass is permitted.
- AI recommendation and Fuzzy illustrative liters cannot be promoted to a physical setpoint.
- This branch does **not** provide physical trial readiness merely by reconnecting the tank sensor. A separate firmware protocol and controlled commissioning phase remain required.
- DEV preview on `127.0.0.1:5002` remains GET-only, unauthenticated and loopback-only; do not expose it over LAN.
- Approval is not stored and must not be presented as a real operator authorization for a later run.

## Validation
On a review checkout with dependencies installed, run:
```sh
npm run build
npm run lint
node --test functions/test/aiOperatorAccDryRun.test.mjs functions/test/aiPreviewDispatchReadiness.test.mjs
```
Before physical trial: verify correct firmware by device-reported capability and bench validation, fresh calibrated AI plan, water interlock, authoritative OFF of both pumps, no schedule/queue conflict, independent STOP/timeout, and ACK from the device. No dispatch flag should be enabled as part of this stage.
