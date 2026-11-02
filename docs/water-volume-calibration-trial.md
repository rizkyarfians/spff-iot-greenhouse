# SPFF Water-Volume Calibration Trial (staging only)

This change is source code only. No Orange Pi production deployment, firmware flash, MQTT publish, or pump ON occurred.

## What changed

- Firmware candidate is a standalone ZIP based on operator-supplied full v1.5.03 Arduino sketch and headers. Reports version 1.5.04-WATER-TRIAL-STAGING; default SPFF_ENABLE_TIMED_WATER_TRIAL=0 (OFF).
- Contract retains legacy set_pump and introduces optional params.waterTrial with durationSec in 5..60 and targetWaterL in 1..100. Target must be pump_water; source must start trial:water:.
- Admin+CSRF POST /api/water-trials accepts deviceId, commandId, durationSec, targetWaterL, confirmation RUN_CALIBRATION_TRIAL. Feature flag SPFF_WATER_TRIAL_DISPATCH_ENABLED=false by default. Requires current firmware capability, Manual ACK, fresh flow data, both pumps OFF, no schedules/conflicting commands, and bounded runtime.
- MQTT Worker reuses existing control command queue and MQTT QoS1; delivery TTL is 15 seconds and is distinct from MCU timer. Final ACK from MCU must include actual OFF. Commands are idempotent.
- Operator+CSRF POST /api/water-trials/:commandId/stop creates an independent OFF command even when start still in-flight. GET /api/water-trials/:commandId reads ACK evidence.
- Migration 037_water_trial_calibrations.sql creates a local PostgreSQL evidence table. Admin+CSRF POST /api/water-trials/:commandId/calibration accepts physicalMeasuredL and note after a valid final OFF ACK with device meter delta. The correction factor is provisional and NOT automatically applied to firmware or AI control.

## Safety / acceptance

ESP32 is authoritative. Trial target liters are based on an uncalibrated Slave ID5 flow counter that may update every approximately ten seconds, so target overshoot is possible. The physical collection vessel must safely accommodate worst-case flow through the entire 60-second maximum. This is for supervised calibration, not irrigation plants.

Firmware candidate has been generated from the complete 1.5.03 source, but has NOT been compiled using Arduino IDE ESP32 toolchain nor tested on the actual board. Only a pure C++ timer guard passed host tests. Do not enable dispatch, flash firmware, apply migration to production, or energize the physical motor until separate reviewed bench/field acceptance.

## Verification on staging checkout

1. Pull the latest branch; run npm run build and npm run lint.
2. Run node --test packages/contracts/test/waterTrial.test.mjs and MQTT Worker dispatcher tests using the repository test runner.
3. Run the C++ host test in the firmware ZIP: c++ -std=c++17 -Wall -Wextra -Werror WaterTrialGuard_test.cpp -o /tmp/water-trial-test && /tmp/water-trial-test.
4. Compile full Arduino sketch with the known-good ESP32-S3 core 2.0.17 and original partition layout, with motor power physically isolated.
5. Bench-test Manual/Auto arbitration, NVS command replay protection, interlock, stale/no-flow, output OFF, fault, RTC/expiry, timer rollover, reboot, lost serial/MQTT, STOP and physical E-stop.

Unified AI remains SHADOW with can_dispatch false. The current 1.74-minute historical-flow estimate is NOT an approved automatic runtime. Physical calibration evidence must be reviewed before AI-derived duration can become a command.
