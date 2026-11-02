# SPFF — AI only applies to Automatic mode (2026-11-02)

## Confirmed from uploaded firmware 1.5.03

The current firmware already handles `kind=command,type=set_pump,params.isActive`, but its `processSpffCommandLine` authority policy explicitly rejects a *non-schedule ON* in Automatic mode with `sourceDenial="automatic_mode"`. An unrelated non-schedule OFF in Automatic mode pauses the on-device automatic controller. Only the currently synced server schedule with a matching `requestedBy=schedule:<scheduleId>:on` can perform Automatic ON, or the device's local automatic control owns ON.

**Do not counterfeit `requestedBy=schedule:...` to disguise AI commands.** This would violate the firmware's authority separation. No firmware file is changed in this branch.

## Updated scope

- AI is **not applicable in Manual**. The existing Manual dashboard and device control keep their own authority.
- Preserve local sensor logic and pump cutoff. Do not rewrite them.
- AI stays `SHADOW_MODE`, `can_dispatch=false`. Fuzzy liters are illustrative, *not* a standard `set_pump` volume command; the standard command has `params.isActive` only.
- Legacy Stage-4 AI Water Trial `/queue` is permanently disabled; its old Manual-only executor must not be activated by setting two env flags. Generic operator Water Trial routes are unchanged.
- New operator-only **GET** `/api/unified-ai/automatic-pump-readiness?deviceId=esp32-s3-01` checks the fixed local Python SHADOW source plus live PostgreSQL actual mode, confirmed automatic config, status freshness, and in-flight commands. Returns explicit blockers; no DB writes or MQTT publish. Always `canDispatch=false`.
- The firmware does not provide a verified AI direct-ON authority protocol. Future execution requires a reviewed owner-arbitration contract and hardware acceptance. Simply enabling flags will not make it work.

## Checks

```bash
npm run build
npm run lint
node --test functions/test/aiAutomaticPumpReadiness.test.mjs functions/test/aiVolumeApproval.test.mjs
env -u SPFF_AI_FUZZY_TRIAL_DISPATCH_ENABLED -u SPFF_WATER_TRIAL_DISPATCH_ENABLED bash scripts/test-ai-volume-isolated-transport.sh
```

All changes are source-only on a separate branch; do not deploy to production or flip dispatch flags. A successful isolated simulator test is not a real automatic pump command.
