# HST SHADOW / TEST POMPA REAL — staged rollout

## Operator intent

On the Panduan HST proposal panel, the operator chooses either:

- **SHADOW**: HST proposal and authenticated ACC review. NO hardware command, as in deployed v6.
- **TEST POMPA REAL**: the intended future behavior is **AI dose/volume calculation -> authenticated operator ACC -> validated local command -> ESP32 physical pump session -> actual ACK and telemetry -> PostgreSQL**.

The operator expressly requested real automatic execution after ACC, **not** a redirect to manual pump toggles.

## Implemented on this feature branch

- New mode selector on existing HST panel, mobile friendly.
- Default SHADOW; switching modes clears the checkbox/review confirmation.
- Backend `GET /api/unified-ai/hst/execution-readiness` requires operator auth and returns an authoritative **blocked** state.
- No POST real-test endpoint, MQTT publish, ESP32 mode change, or relay command was added.
- TEST REAL displays a clear reason and keeps ACC inactive. This is **not** yet a working real pump test.
- The shared contract validates readiness as `realTest.ready === false` and `canDispatch === false` until the physical path is implemented and verified.
- Existing HST SHADOW ACC remains unchanged.

## Required next work before any real dispatch

1. **Actual hardware audit**. Verify the installed ESP32-S3 firmware version, exact adaptive volume-session command/ACK format, pump control selector, interlock/failsafe behavior, watchdog and max runtime, and pump/flow calibration. Source repository firmware examples are not proof of installed firmware.
2. **HST to session contract**. Bind the one HST proposal (program, activity, source product) to one selected fertilizer stock and its verified concentration, water volume and sensor/EC recipe. Never mix multiple product rows implicitly. Refuse mismatched revisions or stale approvals.
3. **Atomic reservation + idempotency**. Validate one operator ACC UUID, current HST obligation and remaining mass, verified source telemetry, fresh device status, control-mode ACK, no competing session/schedule, and hardware readiness. Store durable requested session once, with command expiry and audit trail, before MQTT publish.
4. **Device-owned execution**. Use **existing** volume-session dispatcher only if it is confirmed compatible with ESP32's deployed firmware. ESP32 owns relay interlocks, max duration, local STOP/failsafe, and actual state. API/MQTT publish is not execution success.
5. **Control and feedback**. Show queued/accepted/running/complete/fault, actual pump states, measured volume and timestamps from device ACK/telemetry. Include manual STOP and timeout/reconciliation handling. Do not mark fertilizer delivered from AI ACC or MQTT publish alone.
6. **Physical acceptance test**. Test with water/isolated lines before fertilizer, including expired commands, MQTT restart, serial disconnect, device reboot, stale sensors, pump stuck-on, network outage and request replay. Verify local-first operation and safe STOP.
7. **Production rollout** only after approval, backup, `npm run build`, `npm run lint`, tests, and preservation of modified production files. Keep SHADOW fallback.

## Important separation

Changing the browser selection is **not** changing the ESP32 manual/automatic selector.
The production Python HST service remains `SHADOW_MODE`, and `/hst/approvals` returns `SHADOW_REVIEW_BLOCKED` by design.

This branch must not be deployed as if TEST REAL can already run the pump.
