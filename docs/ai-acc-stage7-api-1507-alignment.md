# Stage 7/8 contract alignment: firmware 1.5.07 (staging, not commissioned)

Branch: `feature/ai-acc-stage7-api-1507-alignment-20261103`.
Built on Stage 8 (`4f141cb`). No flash, physical trial, broker publish,
service restart, deployment, env flag enablement, DB mutation or cloud use.

## Validated source contract to implement

Firmware staging ZIP `SPFF_MASTER_1_5_07_AI_ACC_SESSION_STAGING.zip`:
- Exact `firmwareVersion=1.5.07-AI-ACC-SESSION`.
- Fresh `device_status` with `pulseBootId`, `aiAccWaterTrialCapable`,
  `timedWaterTrialCapable`, `aiAccTankGuardCapable`,
  `aiAccTankGuardHealthy`, `aiAccSessionActive`,
  `pumpReadbackValid`, `pumpWaterActualActive`,
  `pumpFertActualActive`, `waterInterlockEnabled`.
- Payload remains `params.waterTrial.{targetWaterL,durationSec,bootId}`
  with `requestedBy=trial:water:ai:<operator>`. No duplicate contracts.
- Firmware capabilities default false with compile-time max runtimes at 0.
  Never interpret version string alone as permission to dispatch.
- `pumpReadbackValid` reflects TCA9554 register output only, **not**
  auxiliary relay/contact feedback. No guaranteed physical motor state.

## API Stage 7

- Existing authenticated operator + CSRF route remains unchanged,
  `POST /api/unified-ai/operator-acc/water-trial` (OFF by default with
  `SPFF_AI_ACC_WATER_TRIAL_ENABLED`).
- Existing AI decision policy still requires real current operational plan,
  operator-reviewed evaluation ID, non-HOLD source and fresh data.
- Hardware gate now accepts *only* exact 1.5.07 heartbeat (45s max age for a 30s MCU heartbeat), both capabilities,
  independent healthy MCU tank guard, fresh register-level OFF readback for
  both outputs, no active AI session, valid boot ID, and Automatic.
- Configuration `device_water_interlock_configs.enabled=false` is treated
  as an intentional choice ONLY if `enabled=applied_enabled`, ACK revision is
  applied, and the MCU agrees. Independent MCU tank guard remains mandatory.
  No SQL toggles interlock settings.
- API still checks latest known actuator events as corroboration, sensor
  health, no outstanding commands/schedules, and actuator max runtime.
  Created command only enters the durable pending queue. Published/accepted
  are not proof of physical actuation.
- Repo commandStatus/idempotent/ACK semantics remain a later safety-review
  area; this patch does not authorize an actual trial.

## MQTT Worker Stage 8

- Worker query applies matching exact 1.5.07 capability, MCU tank guard,
  fresh readback and configured interlock agreement. Historical actuator
  event must say OFF but is not falsely required to refresh every 30s.
- Existing worker flag `SPFF_AI_ACC_WORKER_DISPATCH_ENABLED` defaults OFF.
  Both API and Worker must be separately authorized and commissioned.
- Worker-side guard retains expiry, boot ID, volume <= 5 L, duration <= 30s,
  origin and operator confirmation checks.
- Firmware still owns actual pump state, real-time stop conditions, ACK,
  watchdog and independent fail-safe. Dashboard, MQTT and Python are advisory.

## Staging verification (NO hardware / no real DB / no port 1883)

```bash
cd ~/spff-ai-dashboard-test
git fetch origin feature/ai-acc-stage7-api-1507-alignment-20261103
git worktree add --detach ~/spff-ai-stage7-review FETCH_HEAD
cd ~/spff-ai-stage7-review
npm ci
npm run build
npm run lint
node --test functions/test/aiAccHardwareSafety.test.mjs functions/test/aiAccWaterTrialPolicy.test.mjs
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused ./node_modules/.bin/tsx --test mqtt-worker/test/aiAccRepositoryGate.test.ts mqtt-worker/test/aiAccDispatchGuard.test.ts mqtt-worker/test/commandDispatchService.test.ts
```

Do not enable the flags. Next verify SQL against a disposable PostgreSQL
with the actual schema, firmware compilation with ESP32-S3 toolchain, readback
on hardware with motor power isolated, STOP under broker/Edge loss, measured
flow calibration and ACK timing reconciliation. Only after these proofs could
a separately supervised water-only trial be considered.
