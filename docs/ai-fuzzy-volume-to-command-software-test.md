# SPFF SHADOW Fuzzy → bounded volume command software test

## Purpose

Verify a Fuzzy volume from the real standalone Python AI can become the **waterTrial volume/duration contract**, traverse the existing MQTT Worker command dispatcher, and receive synthetic ACK via the actual ingestion parser. **No physical pumps are started.**

The source `fuzzy_preview.illustrative_water_l` uses `SIMULATION_PROFILE`. This is NOT agronomically calibrated, and an older `decision.proposed_action=FERTIGATE` is not an authorization to start irrigation or inject fertilizer. Conversion is only eligible if planning data is CURRENT, PostgreSQL read-only, within 120 seconds, and consistent with raw sensor origin, with no Fuzzy preview blockers. Decision may remain STALE because Fuzzy preview is independent.

Conversion:

```text
source SHADOW Fuzzy liters → min(source liters, operator trialCapL)
                         → floor to 0.001 L
                         → waterTrial {targetWaterL, durationSec}
```

The operator chooses `trialCapL` from 1 to 100 liters and `durationSec` from 5 to 60 seconds; it is a **safety timeout**, never calculated using `UNVERIFIED_HISTORICAL_COUNTER_DELTAS`. For example 372.6807 L and trialCapL=5 yield a 5 L candidate and a chosen 30-second timeout, **not a 372.68 L actuation request**.

A new authenticated, CSRF-protected route `POST /api/unified-ai/volume-trial-preview` reads the fixed loopback staging Python source, validates `@spff/contracts`, and returns a **non-publishable candidate** with `canDispatch=false`, `commandCreated=false`, `mqttPublished=false`. It accepts JSON such as `{"deviceId":"esp32-s3-01","trialCapL":5,"durationSec":30}`. It does not write `spff.control_commands` and is NOT `POST /api/water-trials`.

## Test strategy

Default unit/integration tests are isolated in-memory and do NOT connect to PostgreSQL or a real broker:

```bash
npm run build
npm run lint
node --test functions/test/aiVolumeTrialConversion.test.mjs functions/test/aiVolumeTrialPipeline.test.mjs
```

Optional live-source test (on the Orange Pi review worktree; Python on localhost 5011):

```bash
SPFF_TEST_LIVE_AI_SHADOW=true node --test functions/test/aiVolumeTrialPipeline.test.mjs
```

The test uses the **actual** `CommandDispatchService` serializer and `IngestionService` ACK decoder, with a synthetic pending queue, a mock QoS1 MQTT publisher, and synthetic ESP32 ACK. No command is written to the real DB, no Mosquitto packet is sent, and no physical hardware is touched. A simulated `completed` means **test simulator completion only**, NOT a device ACK.

## Remaining before any real ESP32 pump test

- Firmly establish firmware volume-session command/ACK contract, capability advertisement, boot/session association, stop-on-volume or timeout, and selector/relay arbitration.
- Fully field-calibrate the water flowmeter and tank level/interlock; verify safe shutdown after power loss and after missing ACK.
- Add an operator-approved, authenticated, idempotent DB command/session writer with safe expiry, durable audit, conflict handling, and independent STOP.
- Run tests on disposable PostgreSQL and a dedicated test Mosquitto broker, then supervised hardware bench tests. Use physically safe minimal quantities; do not bypass missing tank evidence or set AI ACTIVE merely to test.

The staging output is never executable by itself. The current Water Trial server blocks real start until a firmware 1.5.04-WATER-TRIAL capability and other safety gates are met.
