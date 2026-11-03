# SPFF Stage 5: operator ACC isolated MQTT QoS1 test

This stage tests MQTT transport with a MOCK ESP32 only. It is not a hardware trial.

## Existing hardware blockers
- Running firmware reports 1.5.03-SHT20-TELEMETRY-SYNC, mode manual and system degraded.
- The water tank sensor is intentionally disconnected. Keep the water interlock active.
- Existing 1.5.03 rejects unscheduled pump ON when in automatic mode. Never fake a schedule identity as an AI command.
- Dashboard operator ACC is still dry-run and SHADOW_MODE AI data can be STALE.

## Implementation
- Explicit opt-in CLI: node scripts/ai-acc-isolated-mqtt.mjs --isolated-test-only
- Uses disposable Mosquitto listener on 127.0.0.1:18884, not production 1883.
- Fictional site ai-acc-isolated-test and ESP32 device esp32-simulator-no-hardware.
- Validates existing shared set_pump/waterTrial contract.
- Publishes a SYNTHETIC 1 L / 5 second test payload, not a derived AI or physical pump target.
- Emulator responds with synthetic accepted and completed with reported OFF.
- Resends same commandId and confirms no second simulated START.
- No DB, credentials, live MQTT topics, serial port, firmware change, or actuator involved.
- All synthetic completion states are explicitly labeled NOT_PHYSICAL_PROOF.

## Run on Orange Pi staging checkout
npm run build
npm run lint
node --test functions/test/aiOperatorAccDryRun.test.mjs functions/test/aiOperatorAccMqttTransport.test.mjs
node scripts/ai-acc-isolated-mqtt.mjs --isolated-test-only

Do not use sudo. Test refuses to start if TCP 18884 is occupied and removes its own temporary config. No service restart or configuration changes needed.

## Before real approved AI command
1. Implement and bench-verify firmware automatic-mode AI session authority without bypassing existing schedule/Manual mode interlocks.
2. Require fresh calibrated plan, measured flow, tank interlock, max runtime, boot/session dedup, and final ESP32 OFF state ACK.
3. Implement authenticated CSRF protected and audited operator approval -> durable command queue, pending to actual ACK lifecycle, independent STOP.
4. Reconnect tank sensor and supervise a small water-only bench test after all safety gates pass.
5. Do not enable real AI dispatch or fertilizer injection from this staging branch.
