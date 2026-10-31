# Fase 4A — Read-only ESP32 adaptive feedback

## Verified field evidence (2026-11-01, Asia/Jakarta)

The operator's production PostgreSQL reports `spff.adaptive_fert_events` receiving
`adaptive_fert_telemetry` for `greenhouse-01/esp32-s3-01`. The sampled frames were
`IDLE`, `waterPump=false`, `fertPump=false`, both `PumpKnown=true`,
`firmwareVersion=1.5.03-SHT20-TELEMETRY-SYNC`, matching current status
`pulseBootId=ecc559ca86d29e48`. In the read-only SQL comparison the adaptive
frame age was ~5.94 seconds and device status age ~0.70 seconds. Device mode
was `manual`. These are observations at query time, not continuous guarantees.

The supplied firmware source explicitly documents `actuator_state` as an
on-boot/changed-output/fault event. It is not periodically emitted. The
adaptive telemetry samples I2C output-expander output registers through
`relayOutputReadback`, not independent relay contacts or flow delivery.

Four occasional non-JSON `E (...` serial diagnostics occurred in two hours.
They remain a separate firmware serial-log investigation, not proven loss
of pump state. Hotspot service was also reported failed, separately.

## Implementation

- `source.py` selects a current adaptive frame from local PostgreSQL in a
  read-only transaction. It only copies the whitelisted status `pulseBootId`
  out of raw JSON; no arbitrary raw status payload is promoted to authority.
- `adaptive_feedback.py` rejects missing/bad kind, stale/future/naive times,
  implausible firmware, missing/mismatched boot tokens, stale/offline status,
  any controller state other than `IDLE`, unknown outputs, and any pump ON.
- `live_engine.py` exposes `pump_feedback` and corresponding explicit HOLD
  reasons in SHADOW decisions. `REPORTED_OFF_FRESH` is a *reported* output
  status, not a physical verification.
- Nothing writes to ESP32, Mosquitto, actuator or production PostgreSQL.
  `can_dispatch=false` and `firmware_external_volume_only_authority_not_implemented`
  are preserved regardless of the result. Legacy manual mode remains HOLD.
  No IDLE zero volumes may credit mass or train EMA.

## Verification and next gates

Focused 13-case `adaptive_feedback` unit tests passed in a standalone Python
harness. Full repository Python suite, PostgreSQL integration, `npm run build`
and `npm run lint` must be repeated in an isolated checkout of this branch
on Orange Pi; never alter `/opt/spff`. Do not deploy or change firmware
without explicit approval. Physical ON/OFF, command ACK, per-pump durations,
cumulative counter session binding and safe shutdown remain unverified. No
ACTIVE pump control is approved.
