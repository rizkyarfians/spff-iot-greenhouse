# Automatic water diagnostics — candidate, not deployed

Source provenance: supplied `SPFF_MASTER_1_4_34_OPI_CHRONY_SOIL_SINGLE_ONLY.rar`.
Despite its name, this archive contains the **1.4.33** sketch and compiled artifacts.
Its README refers to a 1.4.34 sketch that is absent. The included patch describes
only a version/title change and `SOIL_DIAG_SINGLE_REGISTER_ONLY=true`.
This candidate is a direct upgrade from the archived **1.4.33** source, adding
observational diagnostics only. It retains `SOIL_DIAG_SINGLE_REGISTER_ONLY=false`
and does NOT apply the 1.4.34 single-only trial. Reported version:
`1.4.35-AUTO-DIAG-FROM-1433`.
It is **not verified byte-for-byte against the firmware
currently running on the ESP32**. Do not flash the archive's old binaries as 1.4.35.

The existing periodic `device_status` includes `automaticWaterDiagnostics`.
No additional periodic timer, relay write, clock write, interlock evaluation,
NVS write or command is introduced. The reason is a snapshot of the first
observed gate, not an exhaustive fault list or proof of physical relay state.
`relayReady` reports the existing firmware flag, not fresh hardware readback.
An interlock latch can remain true while the interlock is disabled; inspect the
existing `waterInterlockEnabled` field alongside it. OFF verification can still
block startup independently of that enable flag.

Important reasons: `paused_by_operator_off`, `relay_not_ready`,
`water_off_verification_pending`, `water_interlock_latched`,
`schedule_window_closed_or_clock_invalid`, `moisture_missing_or_stale`,
`waiting_new_low_samples`, `cooldown`, `automatic_water_active`.
`start_conditions_met_check_output` means the observed start gates are satisfied;
it is NOT confirmation that a relay write succeeded. Sample age is the firmware's
per-register last-good age. Repeated telemetry is not a new sensor acquisition.

## Validation and deployment boundary

Run `node --test firmware/test/automatic-water-diagnostics.test.mjs`.
For full-source provenance comparison, set `SPFF_FW_BASELINE_RAR` to the supplied
archive path before running it. These are source tests, **not an ESP32 compile or
hardware test**. Arduino board/toolchain compilation is required before flashing;
retain the known-good binary and use the established board/partition/OTA process.
The new status frame must be checked end-to-end against `SPFF_SERIAL_FRAME_MAX`
and gateway ingestion on a safe bench. Do not erase NVS/partitions to install it.
Keep pumps physically safe during any reboot; no automatic production flashing
is part of this change. No DB migration is needed: existing raw status payload
storage retains the diagnostic object.

After an explicitly approved flash and confirming the reported candidate version:

```sql
SELECT recorded_at AT TIME ZONE 'Asia/Jakarta' AS waktu_wib,
       raw_payload->>'firmwareVersion' AS firmware,
       raw_payload->'automaticWaterDiagnostics' AS diagnosis
FROM spff.device_status_events
WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'
ORDER BY received_at DESC, device_status_id DESC
LIMIT 5;
```
