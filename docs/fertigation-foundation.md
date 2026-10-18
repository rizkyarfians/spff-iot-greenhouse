# Fertigation foundation (simulation only)

Migration `020_fertigation_foundation.sql` introduces agronomic recipe metadata and session/event tables. No recipes are inserted by default; every recipe requires an agronomic source and explicit approval before a decision can be suggested.

## API
- `POST /api/fertigation/simulate` — authenticated operator/admin with CSRF; checks an existing recipe plus explicitly supplied observations; **advisory only**.
- `GET /api/fertigation/sessions?deviceId=...` — authenticated read-only session list, initially empty until device-origin session ingestion is implemented.

This release **does not ingest live session events**, create pump commands, publish MQTT, flash ESP32, or mark a device session as completed.

**Important**: simulated observations are supplied by the client and cannot be used to actuate hardware. The eventual production rule engine must load authenticated fresh sensor snapshots from PostgreSQL and fail closed on stale/invalid sensors, independent actuator safety, and unapproved dosing recipes. Device feedback must be authoritative for actual pump state. Record final counters before device reset.

Apply the migration *only after* review of database owner/permissions and backup on the Orange Pi. Do not automatically deploy or enable pump controls.

## Adjustable recipes (API only, no new UI)
Run migration `021_editable_recipes_live_evaluation.sql` after migration 020 in a reviewed maintenance window. The service now supports:
- `GET /api/fertigation/recipes` — logged-in user, all recipes in active site.
- `POST /api/fertigation/recipes` — admin + CSRF, create draft. Body: `FertigationRecipeMutation` in `@spff/contracts`.
- `PUT /api/fertigation/recipes/:id` — admin + CSRF, requires `expectedRevision`. Any edit **resets approval**.
- `POST /api/fertigation/recipes/:id/approve` — admin + CSRF, `{expectedRevision,approvalReference}`, for agronomy-approved dosing only.
- `POST /api/fertigation/evaluate-site` — operator/admin + CSRF, body **only** `{recipeId,deviceId}`. No client-supplied sensor readings. Evaluates latest *single* telemetry sample, sensor health, device status and desired automatic mode from local PostgreSQL. Persists decision in `fertigation_evaluations`.

Always report `simulationOnly=true` and `publishable=false`. There is **no controller activation**. HST is calculated from `plantingDate` in Asia/Jakarta. `applicationDate` is a specific date, not a recurring schedule. No dosing is recommended when dates are missing. Device selector position is **not independently proven** by current status; approval from the UI cannot override hardware safety.

### Protokol demplot
The supplied workbook includes 6 crops: Ubi Jalar, Kacang Tanah, Jagung Manis, Terong, Buncis, Butternut Pumpkin. Units and methods vary (tabur, tugal, kocor, semprot). Do not automatically turn product gram/kg dose, solvent litres, or field total into Venturi stock targets. Keep agronomy protocol as reference until each recipe is converted and approved. No made-up values or auto-approval.

### Production prerequisites
- `npm run build`, `npm run lint`, `npm test`; migration review, permissions, and backup.
- Device-recorded volume feedback, session ingester, idempotent ACK/actual state, physical selector and measured flow calibration before enabling hardware control.
- Dynamic sensor freshness checks: currently 120s telemetry, 90s device status. Zero L/min is a legitimate idle reading; a stopped pump is not evidence of broken flow meter.
- The latest telemetry sample is used as a whole, not a cached last-known per-field value. Missing sample values cause DELAY.
