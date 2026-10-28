# Programs sourced from Panduan

Stage 1 adds a planning and manual activity log alongside the existing sensor/pump
programs. It does not replace an approved sensor rule or change an execution flag.
No path in the new service publishes MQTT or dispatches pump commands.

An Admin opens Panduan → Gunakan untuk program, or Program Fertigasi → Program dari
Panduan. They select a planting date and either population or area, optionally
associate an enabled site device, preview the server-calculated needs, then save.
The preview includes all source activities, source totals, calculated quantities,
units and review warnings. Daily activities use HST 0 on the planting date and the
Asia/Jakarta calendar, including negative HST before planting. Past unmarked
activities remain accessible in the All filter; future activities cannot be marked
complete. Admins/operators explicitly confirm manual completion with an optional
note. Source Excel checkboxes are not copied into a program's completion state.

## Calculation and source semantics

The server reads the same immutable source JSON and saved crop overrides as
Panduan. It accepts configuration and revision tokens, never client-supplied cells
or computed plans. Population/area is scaled proportionally to the reference D7/D3;
when one basis is chosen, the other is an estimate using the source density.
Per-plant, per-liter, and per-5000 m² units are calculated from the supplied dose.
Unsupported/missing units or volumes yield an unavailable computed amount and an
explicit warning; the original need and unit remain visible. Computed and source
needs are compared only with compatible units (1% tolerance for source rounding).
No EC value or injector ratio is inferred from mass, volume or concentration.

Only explicit A/B/J Excel merges carry those cells into covered rows. A new named
activity/method starts a group; a product-only continuation can belong to that
activity only within the same explicit activity number and HST. Unlabelled or
ambiguous source rows remain reviewable, not silently repaired. A missing unmerged
J may use the current group's explicit volume for calculation; the original row
remains intact in the pinned source snapshot. Shared water is displayed once per
activity, not summed per product. Different explicit water values trigger a warning.
These groups organize manual work; they do not authorize products to be mixed.

## Persistence and revisions

Migration 034 stores site-scoped programs, immutable program revisions with full
source/plan snapshots, and append-only manual completion records. Program creation
and update check the guide fingerprint and revision seen in the preview. Program
updates also check their own revision under a row lock. Saving a revision and its
audit record is atomic. Guide changes leave existing programs untouched and show
an update notice; Admins preview a before/after comparison before applying them.
The original guide source is never modified by program operations.

Completion fingerprints include the activity's exact requirements and crop/planting
date. Unchanged activities retain their manual completion across program revisions;
changed activities need a new confirmation. Old completions and their revision
snapshots remain in history. Device association alone does not reset completion.
Completion writes serialize with program updates, reject stale revisions and are
idempotent. They record manual work, not measured flow or confirmed pump delivery.

All routes require the normal signed-in session. POST preview/create and PUT update
also require Admin and CSRF. POST completion requires Operator/Admin and CSRF.
Read endpoints are site-scoped and available to signed-in users. Revision and
completion history cannot be rewritten or deleted by the API role.

## Orange Pi deployment

Migration 033 (editable Panduan) must already be applied. Pull the production
branch, apply 034 once, build, and restart the API:

```bash
cd /opt/spff
git pull --ff-only origin feature/fertigation-foundation-20261018
sudo -u postgres psql -X -d spff -v ON_ERROR_STOP=1 \
  -f infrastructure/postgres/migrations/034_guide_based_programs.sql
umask 022
npm run build
sudo systemctl restart spff-api
```

Keep frontend/src/data/protocolGuide.json alongside the API checkout. No firmware
or worker change is required. Subsequent stages can add measured EC calibration,
validated application routes, flow-meter progress and pump execution separately.
