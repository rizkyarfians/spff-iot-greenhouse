# HST through the existing automatic schedule path

HST uses the firmware's existing server-authority `schedule_sync` plus
`set_pump` contract. No firmware prefix or new firmware build is required for
the supplied `1.5.12-TIMED-FERT-EC` receiver.

For a due unfulfilled HST phase, the worker registers two enabled one-day HST
schedule entries, one for each pump. The existing user schedules stay in the
same snapshot. These HST entries are only published under `server` authority:
they register the HST application's authorization for that day, rather than
enabling independent device timers. The existing firmware remains responsible
for ending the fertilizer run and its protections stay in force.

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

Install with `sudo bash scripts/repair-orange-worker.sh`. It rebuilds the worker
only, preserves flags and restarts it. With HST dispatch already enabled, a due
phase or eligible retry can start after the native schedule ACK. No migration,
API or frontend build is needed. `SCHEDULE_EXECUTION_MODE` must be `server` (the
existing default); device-authority deployments are not changed implicitly.
