# Stage 9 — SPFF AI execution mode switch (staging only)

This branch extends the validated Stage 7/8 operator-approved water-only trial
and ACK lifecycle patch. **No production deployment, migration, MQTT publish,
service restart, flag enablement or ESP32 flashing was performed.**

## Modes (device-scoped; separate from MCU selector)

| AI mode | Meaning | Physical water-only trial |
| --- | --- | --- |
| OFF | No new AI actuation; AI insights may still be computed by Python | Blocked |
| SHADOW (default) | Recommendations/simulation without AI actuator dispatch | Blocked |
| LIVE | Supervised operator ACC water-only pathway; **not autonomous** | Conditional |

**Manual/Automatic is an independent ESP32-controlled selector.** Only an
MCU-confirmed Automatic selector is eligible for the water-only AI ACC trial.
Changing the AI mode never changes the physical selector.

LIVE is not a pump-on command, never bypasses tank guard or relay interlocks,
and does not authorize fertilizer injection or unattended autonomous control.

## Storage and API

Migration `038_ai_execution_modes.sql` stores one row per
`site_id + device_id`. Missing rows default to SHADOW in the API and fail
closed for Worker AI selection.

- `GET /api/unified-ai/execution-mode?deviceId=esp32-s3-01` — login + operator.
- `PUT /api/unified-ai/execution-mode` — admin + CSRF, strict shared Zod
  payload `{deviceId,mode,expectedRevision,confirmation}`.
- `expectedRevision` prevents silent concurrent updates.
- Audit middleware logs mutation metadata using the normal SPFF audit path.
- LIVE selection requires `SPFF_AI_ACC_LIVE_SWITCH_ENABLED=true` AND
  `SPFF_AI_ACC_WATER_TRIAL_ENABLED=true`, explicit supervised confirmation,
  fresh firmware **1.5.07-AI-ACC-SESSION** status, healthy independent MCU tank
  guard, fresh OFF readbacks, matching applied interlock configuration
  (including intentionally disabled dashboard interlock), and ACK-applied
  Automatic configuration. The command creation API and MQTT Worker independently
  recheck the full command safety gates.
- Worker additionally requires
  `SPFF_AI_ACC_WORKER_DISPATCH_ENABLED=true` and persisted LIVE mode before
  considering AI command. It rechecks the mode immediately before MQTT publish.

The unauthenticated port-5002 AI preview stays GET-only/read-only. The new
mode selector is displayed as SHADOW-only in preview, with writes disabled.

## Switching down is NOT a physical STOP

If a command was already published, changing LIVE to OFF/SHADOW does **not**
reverse it or prove the relay is OFF. Commands already selected for dispatch
can still race with downshifts between the last database recheck and MQTT
publish. Use the dedicated STOP control and verify ESP32 ACK + physical state.
The hardware STOP and MCU fail-safe always remain authoritative.

## Pre-deployment requirements

1. Apply migration 038 **only after approval/backup**; deploying Worker before
   the migration would break its pending-command SQL even for regular commands.
2. Validate in a separate Orange Pi Git worktree:
   `npm run build && npm run lint`;
   `node --test functions/test/aiExecutionMode.test.mjs`;
   `DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused ./node_modules/.bin/tsx --test mqtt-worker/test/aiAccRepositoryGate.test.ts mqtt-worker/test/commandAckLifecycle.test.ts mqtt-worker/test/aiAccDispatchGuard.test.ts mqtt-worker/test/commandDispatchService.test.ts`;
   `pg_virtualenv bash functions/test/runAiModePgIntegration.sh`;
   `pg_virtualenv bash mqtt-worker/test/runAckPostgresIntegration.sh`.
3. Test backend API permissions: unauthenticated/reader/operator/admin,
   CSRF invalid, stale revision, live disabled, firmware 1.5.06, telemetry stale,
   interlock configuration mismatch, duplicate ACC, and concurrent dispatch.
4. Firmware 1.5.07 compile, bench test, physical STOP, pump readback and
   real hardware ACK are pending. Do not enable LIVE until commissioned.
5. Maintain `SPFF_AI_ACC_LIVE_SWITCH_ENABLED=false`,
   `SPFF_AI_ACC_WATER_TRIAL_ENABLED=false` and
   `SPFF_AI_ACC_WORKER_DISPATCH_ENABLED=false` until explicit authorization.

## UI

`AI & Kebutuhan Tanaman → Mode AI & ACC Operator` has a responsive selector,
device-scoped mode, revision, refresh and admin save action, optional LIVE
confirmation, loading/error indications and an independent water-only
commissioning panel. The API does not equate an ACK `accepted` with completed.

The mode switch is **backend authority**, not localStorage or frontend-only.
