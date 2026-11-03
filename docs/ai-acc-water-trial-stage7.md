# SPFF AI ACC water-only trial - staging

## Status
Stage 7 source integration exists on this branch. It is not live on Orange Pi or physically verified.
The Arduino candidate archive is provided separately, based on deployed 1.5.03 source.
No Arduino Verify, flashing, worker dispatch activation, or pump activation has occurred.

## Implemented
- Shared strict operator ACC request contract (1-5 L, 5-30 s) and policy checks.
- Operational API operator + CSRF POST /api/unified-ai/operator-acc/water-trial.
- Live source Python AI freshness, observed mode, tank and flow validation, pump OFF and boot ID checks.
- Existing SPFF PostgreSQL command queue integration, no extra AI reader account.
- Operational authenticated dashboard trial panel with status polling and STOP request.
- DEV preview port 5002 remains without any mutation routes.

## Known blockers
- The existing MQTT Worker still restricts ordinary ON commands to Manual mode; its automatic AI path is not integrated.
- Sensor tandon JSN is currently disconnected; firmware and backend must block START.
- Last source decision STALE, Manual mode; real operational liters not verified.
- Arduino candidate v1.5.04 has not been compiled with ESP32-S3 Arduino core or tested on hardware.
- Fuzzy illustrative liters cannot be used as a physical water setpoint.
- Do not enable SPFF_AI_ACC_WATER_TRIAL_ENABLED or flash/dispatch from this source alone.

## Review checkout only
cd ~/spff-ai-dashboard-test
git status --short
git fetch origin feature/ai-acc-live-water-trial-20261103
git merge --ff-only FETCH_HEAD
npm run build && npm run lint
node --test functions/test/aiAccWaterTrialPolicy.test.mjs functions/test/aiPreviewDispatchReadiness.test.mjs

## Before physical bench
1. Arduino Verify with original dependencies/core and inspect warnings.
2. Motor power isolated, first boot verify device status and OFF.
3. Restore tank sensor and confirm water interlock and flow calibration.
4. Implement worker Automatic-only AI ACK/boot verified route and regression tests.
5. Require CURRENT calibrated AI plan, no schedules/owners, operator ACC and independent STOP.
6. Only then start supervised water-only pump bench trial. No fertilizer injection.
