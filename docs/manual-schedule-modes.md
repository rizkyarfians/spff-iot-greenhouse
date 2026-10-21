# Manual and automatic: schedules plus sensors

Manual uses dashboard ON/OFF. Automatic runs each pump only inside its enabled
schedule window AND when its sensor controller calls for it. Water retains
moisture hysteresis, runtime limits and cooldown. Fertilizer retains EC dosing,
mixing and flow/volume/daily limits. Smart Soil is unchanged.

No schedule, invalid RTC, or closed window means no automatic start. Window end
stops the corresponding pump even during dosing. ON is inclusive, OFF exclusive.
Firmware supports same-day windows in Asia/Jakarta and Asia/Bangkok; overnight
windows are rejected. Overlapping windows form a union.

The worker publishes device-authority snapshots, ignoring the old
SCHEDULE_EXECUTION_MODE setting, and no longer starts the direct server
scheduler. Firmware uses schedules only as permission windows, never as a
second relay writer. Legacy scheduled ON commands are rejected.

Dashboard OFF in Automatic stops both pumps and pauses automatic control until
the configuration is explicitly saved again (new revision) or mode is changed.
This pause is in RAM: reboot clears it. Isolate physical power for maintenance.
Mode changes stop both pumps. Notifications distinguish server save from ESP ACK.

## Coordinated deployment

Back up DB and firmware. Stop the MQTT worker and isolate pump power before
upgrading. Flash firmware/SPFF_MASTER_1.4.10_SCHEDULE_SENSOR/ using board and
library settings from the supplied MASTER.ino (1.4.8). The abandoned 1.4.9
schedule-only firmware was removed; it remains recoverable in Git. Do not use it.

Corrected migration 019 restores the sensor-profile check without modifying
profiles, thresholds, enabled flags, selected modes or revisions. NOT VALID
permits existing rows from the abandoned migration to remain until corrected;
new writes must have at least one enabled profile in Automatic. If old 019 was
already applied, enabled flags it cleared must be reviewed/restored from backup.
Run corrected SQL explicitly if a migration tracker already recorded 019.

Build contracts, API, frontend, edge and worker together. Restart after firmware
is compatible. Save settings; confirm mode and schedule ACKs before pump tests.
With pump power isolated, verify Manual ON/OFF, no auto output outside windows,
dry soil inside window, target moisture stop, fertilizer dosing/mixing limits,
window closure during dosing, stale sensor stop, and dashboard OFF pause.

No real database migration, firmware compilation or board flash has been done
locally. Source regression checks are not a substitute for Arduino build and
hardware validation before reconnecting pump power.

## P1 control guards

Firmware 1.4.10 source now latches automatic water faults for stale/invalid
moisture while watering, low flow after the 5-second grace period (when enabled),
and maximum runtime. Even one such fault blocks further automatic watering;
normal target and schedule stops only enter cooldown. Fault events distinguish
water_sensor_fault, water_flow_fault, and water_runtime_limit.

The water latch is stored in NVS and loaded at boot. Repair the cause, then
explicitly save parameters with a NEW configuration revision to reset it. A
replayed revision cannot reset the latch. Outputs must be verified OFF and the
NVS reset must succeed. The independent relay shutdown latch is never reset by
this operation. Manual mode still permits deliberate manual operation subject to
its existing guards. If NVS writes fail when a fault occurs, RAM still blocks
watering but persistence across power loss cannot be guaranteed.

Fertilizer continuation after mixing requires a fresh EC sample strictly AFTER
mixingStart + mixingDelay. An EC sample captured during mixing is insufficient.
Timing comparisons handle millis() wrap.

Tank-level interlock is NOT implemented on this firmware. Both profiles reject
non-null minTankLevelPercent with tank_level_interlock_unsupported, instead of
acknowledging an ignored safety setting. The current dashboard sends null and
explains that tank protection is unavailable. minFlowLpm=0 disables low-flow
protection; a calibrated positive value enables it. Existing installations with a
stored non-null tank threshold must clear it before a new configuration can apply.

Verification: npm run test:firmware requires g++ and executes the actual extracted
water-controller function against mocked I/O, plus production timing helpers.
This is a host regression test, not an Arduino board build or hardware test.
Before energizing pumps, verify fault stop and no restart after cooldown/reboot,
new-revision reset and duplicate-revision non-reset, NVS/reset failure, stale EC
after mixing, disabled/enabled flow protection, and unsupported tank rejection.
No migration, board flashing, or deployment is performed by this change.
