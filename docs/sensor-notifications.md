# Sensor notification timing

Sensor faults enter the bell only when the latest API status is explicitly
invalid and at least five minutes have elapsed since the last persisted valid
report for that parameter. A sensor with no valid report starts its countdown at
the first invalid packet received after migration 028. `not_reported` optional
channels remain excluded. Valid zero readings reset the failure state normally.

This is the time of a valid **report**, not a guaranteed physical acquisition
timestamp: firmware may cache sensor values. The API does not expose per-field
hardware acquisition times. This feature does not alter firmware cache expiry,
actuator control, AI eligibility, or safety interlocks.

Migration 028 stores a bounded JSON timing map per device, maintained in the same
transaction as incoming telemetry. It does not scan/backfill historical samples.
Duplicates do not fire the insert trigger, out-of-order recorded timestamps do
not regress state, and clocks over two minutes ahead of receipt are ignored.
State survives worker/API restart and browser refresh. Unknown timing suppresses
sensor notifications rather than guessing their duration. The migration is
required BEFORE deploying/restarting the new backend.

Several affected sensors appear in one expandable summary. Tank distance and
derived level share one detail. Valid recovery removes the relevant detail.
Read markers remain session-local; changing the summary's sensor membership
creates a new unread identity, while identical repeated packets do not.

Each notification/detail displays weekday, date, hour and minute in
`Asia/Jakarta` (WIB). Sensor timestamps explicitly label last valid report or
first observed failure; they are not invented detection times. Existing alarms
use their persisted `triggeredAt` timestamp. No historical fault notification
store or background/browser push is added.

Validation: frontend timing/format/grouping tests; backend/contracts builds;
trigger integration test against disposable PostgreSQL WASM (PGlite), including
real SQL role permissions, replay, duplicates and recovery. Physical Orange Pi,
PostgreSQL 14 deployment, and browser visual pass still require verification.

Deploy only on a stable mounted data disk after a verified database backup.
Apply `028_sensor_notification_timing.sql` once with ON_ERROR_STOP, then restart
the API after building contracts/backend/frontend. No MQTT worker restart,
ESP32 flash or AI/pulse configuration change is needed. Allow new telemetry to
populate the timing map, and at least five minutes for never-valid failures to
become eligible. Do not re-run this non-idempotent migration after success.
