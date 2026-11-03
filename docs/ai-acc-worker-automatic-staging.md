# Stage 8 — AI ACC Automatic Worker gating (staging only)

This changes **source code in an isolated GitHub branch**. It does not deploy to
`/opt/spff`, enable any environment flag, switch the selector, flash firmware,
publish real MQTT, or switch a pump on.

## What changes

- Ordinary manual ON dispatch explicitly excludes `trial:water:ai:*` and the
  `ai-operator-acc-water-only-trial` source marker. This closes a possible
  accidental/manual-route bypass for AI-identified queue rows.
- A separate Automatic-only query path exists for strictly identified AI ACC
  water-only requests. It is **OFF by default** through
  `SPFF_AI_ACC_WORKER_DISPATCH_ENABLED=false`. Do not enable for commissioning
  until live firmware, volume calibration, independent STOP, and end-to-end ACK
  evidence are verified.
- SQL requires the device enabled, Automatic desired/applied ACK, latest fresh
  device status, declared AI + timed session capabilities, boot ID equality,
  enabled and acknowledged water interlock, two recent actual OFF states,
  recent valid tank/flow telemetry, no competing commands/schedules/sessions.
- Worker-side guard independently checks origin, requested action, command ID,
  explicit operator confirmation, target volume 1–5 L, duration 5–30 s,
  boot ID, issued/expiry and AI evaluation timestamps.
- The existing `@spff/contracts` pump message already supports
  `params.waterTrial.bootId`. The Worker now preserves that boot ID when
  serializing to MQTT, instead of dropping it.
- The Worker still marks a command **published** only after MQTT publish; this
  is not physical ACK. Final pump state must come from device ACK/readback.

## Critical live blockers, not overridden

- Current reported ESP32 firmware:
  `1.5.06-TIMED-WATER-AI-GUARD`. This stage intentionally accepts only the
  previously defined `1.5.04-WATER-TRIAL-AI-ACC-` advertised capability
  contract **until actual 1.5.06 source/protocol is inspected**.
- Last observed mode was Manual. Water interlock was reported false and
  capability keys absent. Device actuator OFF feedback was hours old.
- Raw `flow_water_total_l` health is *not* proof of independent calibration.
  Nor does software-only MQTT simulation prove MCU STOP/timeout/dedup.
- Existing ACK semantics and command timeout discrepancies still require
  hardware-isolated regression testing. No real AI trial is authorized by
  this stage alone.
- The API command enqueue feature flag
  `SPFF_AI_ACC_WATER_TRIAL_ENABLED` is separately OFF by default.

## Review only

In a separate review worktree (do not overwrite /opt/spff or the running checkout):

```bash
git fetch origin feature/ai-acc-worker-automatic-gates-20261103
git worktree add --detach ~/spff-ai-acc-worker-review origin/feature/ai-acc-worker-automatic-gates-20261103
cd ~/spff-ai-acc-worker-review
npm ci
npm run build
npm run lint
# Synthetic URL only for mocked repository tests; no database is contacted.
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused \
  ./node_modules/.bin/tsx --test \
  mqtt-worker/test/aiAccDispatchGuard.test.ts \
  mqtt-worker/test/aiAccRepositoryGate.test.ts \
  mqtt-worker/test/commandDispatchService.test.ts
```

Do not enable either AI dispatch flag. Next phase: obtain exact deployed
firmware 1.5.06 source, verify byte-level contract and safe MCU runtime,
calibrate volume, test hardware with motor power disconnected, fix
ACK/timeout ordering, then separately approve physical water-only commissioning.
