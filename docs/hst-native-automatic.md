# HST through the existing automatic schedule path

## Runtime limit

HST snapshots the water pump's `maxRuntimeSeconds` setting per new cycle, capped
at 900 seconds (15 minutes). Missing/invalid settings fall back to 900 seconds;
shorter valid settings are honored. Existing running HST cycles adopt their
stored setting once. The clock uses the earliest persisted ON publication,
falling back to the confirmed start time, so a worker restart does not restart
the clock.

At the deadline the worker queues ordinary OFF for BOTH water and fertilizer,
even if new HST dispatch is disabled. OFF retries continue until both OFF ACKs
or device readback confirm the stop. Already-ended cycles and subsequent ONs
from another owner are not stopped again by the old deadline. The estimator's
recorded delivery is preserved; reaching a runtime limit does not mean the
fertilizer target was fulfilled and does not automatically restart HST.

This is a server timeout, evaluated in the existing five-second worker loop.
Polling, transport and acknowledgement add delay; it is not a hard independent
15-minute cutoff inside ESP32 when the server/link is unavailable. Firmware
protections remain in force. Install by rebuilding/deploying the worker only;
no firmware, API, frontend or database migration is required.

HST uses the firmware's existing server-authority `schedule_sync` plus
`set_pump` contract. No firmware prefix or new firmware build is required for
the supplied `1.5.12-TIMED-FERT-EC` receiver.

For a due unfulfilled HST phase, the worker registers two enabled one-day HST
schedule entries, one for each pump. The existing user schedules stay in the
same snapshot. These HST entries are only published under `server` authority:
they register the HST application's authorization for that day, rather than
enabling independent device timers. The existing firmware remains responsible
for ending the fertilizer run and its protections stay in force.

The worker normally synchronizes device-authority schedules. For a device with
an HST start awaiting confirmation, its snapshot uses server authority; other
devices retain their normal authority. Once both ONs are acknowledged (or the
attempt fails), ordinary device authority is restored with a new revision.
This avoids holding normal timers for the remainder of an unfulfilled phase.
No global schedule setting or
firmware source is changed.

The worker bumps the schedule revision and waits until the ESP acknowledges the
current server snapshot as applied before publishing either ON. The ON wire
sources are `schedule:hst-<start UUID>-water:on` and
`schedule:hst-<start UUID>-fert:on`, matching the actual registered IDs and
targets. The database retains `hst-fertilization` and phase identity for its
existing mode, ownership and fulfilled-dose checks. ON expires after 90 seconds,
allowing the snapshot round trip; without its ACK there is no ON dispatch.

Only an existing failed attempt where BOTH ON commands were explicitly rejected
with `automatic_mode` may be retried once. The latest fresh automatic heartbeat
must confirm both pumps OFF after the old ON expiry; there must be no ON ACK,
credited delivery, conflicting schedule, command or relay owner. New command IDs
are used, with the old IDs preserved in their metadata. Timeout, partial start
and uncertain outcomes are not retried by this path.

The first rollout incorrectly left HST registrations under the worker's
hardcoded device authority, so both ONs expired without ever being published.
That exact regression can also retry once, only when both commands have NULL
published timestamps, native HST metadata, explicit command-expired status and
device-authority synchronization. OFF evidence, expiry and no-delivery checks
still apply. A published or ambiguous timeout is not retried.

Install with `sudo bash scripts/repair-orange-worker.sh`. It rebuilds the worker
only, preserves flags and restarts it. With HST dispatch already enabled, a due
phase or eligible retry can start after the native schedule ACK. No migration,
API or frontend build is needed. The worker's existing device-authority default
is supported; no environment override is needed.
