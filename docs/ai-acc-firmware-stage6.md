# Stage 6: AI ACC firmware safety policy (staging only)

Firmware reported on Orange Pi: 1.5.03-SHT20-TELEMETRY-SYNC; Manual mode, degraded. Water-tank ultrasonic sensor is intentionally disconnected; keep its interlock active. No sensor diagnostics are required for this staging change.

The exact installed 1.5.03 Arduino sketch is not present in this repository. Older firmwares are not a safe replacement for it. This stage does not patch/flash the installed ESP32.

## Implementation

The portable C++11 header firmware/ai-session-staging/AiSessionSafetyPolicy.h provides **pure preflight**, not a physical command handler. It does no relay writes, NVS writes, serial reads, MQTT or API calls.

evaluateStart() denies on missing IDs, boot mismatch, invalid or expired command timestamps, uncalibrated volume/runtime limits, Manual selector, missing water interlock/tank reading, unverified flow, pump state/readback unknown, schedule or ownership conflict, missing durable dedup storage, duplicate command, unverified operator approval, stale device status or unverified independent STOP.

evaluateRuntime() requires STOP on volume target, timeout, water/flow failure, selector change, ownership loss, unknown actual relay readback, gateway heartbeat loss, watchdog failure, explicit operator STOP or uninitialized session.

**All clear preflight bits are not authorization to turn on any relay.** A real integration must atomically reserve IDs in durable storage first, arbitrate relay ownership and revalidate at the actual relay boundary.

## Verify in Orange Pi staging checkout

```bash
npm run build
npm run lint
node --test firmware/test/ai-session-safety-policy.test.mjs
```

The C++ tests compile with g++ -std=c++11 -Wall -Wextra -Werror. No service restart, migration, serial port or firmware flash required.

## Remaining before real pump trial

1. Obtain the exact deployed 1.5.03 .ino source and headers; integrate guard into actual command/relay/ESP32 NVS paths only after reviewing existing control ownership. Existing firmware 1.5.03 refuses unscheduled direct ON in Automatic, so never pretend an AI command is a schedule.
2. Design and implement a shared-contract AI session START/STOP and final ACK (real flow measurements, boot binding, idempotent command ID, final OFF readback), with Edge/MQTT Worker and API changes together.
3. Enforce operator-authenticated CSRF approval, durable command queue, expiry and audit. Dashboard must show pending until authoritative ESP32 ACK.
4. Test the actual firmware with pump power isolated; then supervised water-only low-volume bench commissioning after the level sensor is restored and flow calibrated.
5. Do not enable any AI dispatch flag or use the current Stage 4 dry-run button for pump activation.

No Arduino build, flashing, deployed firmware update or physical pump test was done.
