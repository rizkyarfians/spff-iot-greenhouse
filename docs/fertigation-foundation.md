# Fertigation foundation (simulation only)

Migration `020_fertigation_foundation.sql` introduces agronomic recipe metadata and session/event tables. No recipes are inserted by default; every recipe requires an agronomic source and explicit approval before a decision can be suggested.

## API
- `POST /api/fertigation/simulate` — authenticated operator/admin with CSRF; checks an existing recipe plus explicitly supplied observations; **advisory only**.
- `GET /api/fertigation/sessions?deviceId=...` — authenticated read-only session list, initially empty until device-origin session ingestion is implemented.

This release **does not ingest live session events**, create pump commands, publish MQTT, flash ESP32, or mark a device session as completed.

**Important**: simulated observations are supplied by the client and cannot be used to actuate hardware. The eventual production rule engine must load authenticated fresh sensor snapshots from PostgreSQL and fail closed on stale/invalid sensors, independent actuator safety, and unapproved dosing recipes. Device feedback must be authoritative for actual pump state. Record final counters before device reset.

Apply the migration *only after* review of database owner/permissions and backup on the Orange Pi. Do not automatically deploy or enable pump controls.
