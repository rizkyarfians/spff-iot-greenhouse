# Editable Panduan

Admin users can edit existing table cells, save changes to PostgreSQL, cancel a
local draft, inspect the original Excel snapshot, reload the current version, and
read the last 20 revisions with actor, time, notes and before/after values. Other
signed-in users can read the saved version and history. Metadata, table headers,
row structure and merged-cell layout retain the original source structure.

The source JSON remains immutable. Edits are stored separately per configured
site and crop, tied to the source workbook fingerprint. Every save validates
addresses, column types and merged-cell ownership on the server. Negative HST is
allowed for pre-planting activities. A revision mismatch returns 409 and retains
the browser draft. Database transactions atomically save both overrides and
append-only revision history. Identical values do not create a new revision;
restoring a source value removes that override while preserving history.

GET `/api/guide/:cropId` and `/api/guide/:cropId/history` require the normal signed-in
session. PUT `/api/guide/:cropId` additionally requires Admin and CSRF protection.
The server reads its validation source from the frontend JSON in the same checkout;
keep `frontend/src/data/protocolGuide.json` with the API deployment. Changed source
fingerprints require deliberate review before old overrides can be applied.

Changes do not automatically recalculate totals or convert concentrations to EC,
and do not affect fertigation programs or pump commands. The table shows this
limitation while editing. This update supports editing existing cells, not adding
rows, changing crop definitions or modifying merged layout.

## Orange Pi deployment

From `/opt/spff`, pull `feature/fertigation-foundation-20261018`, run migration 033
once against the API's database, build all workspaces and restart `spff-api`:

```bash
sudo -u postgres psql -X -d spff -v ON_ERROR_STOP=1 \
  -f infrastructure/postgres/migrations/033_editable_protocol_guide.sql
umask 022
npm run build
sudo systemctl restart spff-api
```

No firmware or worker changes are needed. Without migration 033 the original
reference remains visible, with an explicit error and editing unavailable.

Validation uses the real migration and SQL operations, including the API database
role, durable reload, revision conflicts, source/type/merge guards, site isolation,
restoring source values, and non-mutable audit history.
