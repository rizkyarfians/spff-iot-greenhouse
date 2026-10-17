# Manual and scheduled operation

Manual allows dashboard pump commands. Automatic runs enabled schedules, not
moisture/EC control. Sensor-driven dosing and AI are disabled. OFF is always
permitted as a safety action. Mode changes stop both pumps in firmware.

The server scheduler requires the current mode revision to be acknowledged as
applied/automatic. Pending ON commands are checked against the current mode
before publication; firmware checks command source again at execution.
`requestedBy` beginning `schedule:` identifies a server schedule command. This
is internal source metadata, not an authentication boundary; MQTT ACLs remain
necessary. The frontend switches its selection only after the save succeeds.

Schedule editing remains available under Automatic. Manual pauses execution
without deleting schedules. A mode selected without any enabled schedules does
not start any pumps. Existing scheduler lookback behavior remains: switching
back to Automatic may catch up an occurrence within the configured lookback
window, but does not reconcile all earlier occurrences.

## Coordinated deployment required

Do not deploy only the UI or only the worker. Back up the database and existing
firmware first. Stop the MQTT worker during upgrade. Use migration
`019_schedule_operating_modes.sql`, build contracts/API/frontend/worker/edge,
and flash `firmware/SPFF_MASTER_1.4.9_SCHEDULE_MODES/` with the same board and
library settings used for the supplied MASTER.ino (1.4.8).
The original Downloads/MASTER.ino is unchanged.

Migration disables existing sensor profiles and bumps their configuration
revision without activating schedules or changing the chosen mode. Old
firmware rejects Automatic with both profiles disabled; firmware update is
required. Historical rows remain unchanged. Restart services after the matching
firmware is installed. Select Manual and verify the current revision ACK before
testing ON/OFF. Then create a safe short future schedule, select Automatic,
verify its ACK and test ON/OFF plus return to Manual. Keep the physical pump
power isolated for initial checks. No hardware flash or server deployment was
performed by the local implementation.

Default deployment uses `SCHEDULE_EXECUTION_MODE=server`. Firmware also gates
device-authority schedules on Automatic, but continuous device scheduling can
reassert an active schedule after a dashboard OFF; use Manual to stop scheduling.
