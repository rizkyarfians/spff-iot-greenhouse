# Stage: SHADOW decision history archive (no pruning or deletion)

## Why

Production observations on 2026-11-04: `spff_ai.engine_state` has 4,458
identically counted entries in `decisions` and `live.decisions` for
`greenhouse-01/esp32-s3-01/soil-1/source-shadow`. The historical audit table
is about 121 GB, of which about 116 GB is retained snapshot payload.
The separate audit-write bug was corrected in production and four events
were confirmed as 228-byte checkpoints.

This stage **does not** reclaim disk and **does not** change SHADOW runtime
behavior. It only prepares a durable, per-decision archive and an explicit
backfill utility. It does not touch `spff.control_commands`, MQTT, firmware,
`spff_ai.engine_state`, or `spff_ai.audit_events`.

## Safety gates

1. Keep the AI SHADOW engine stopped during a real backfill; local API, MQTT,
   Edge Gateway and ESP32 continue independently. Confirm the service is really
   stopped. Do not enable any AI LIVE flags.
2. Confirm NVMe has space. Take a **verified** `pg_dump -Fc` of
   `spff_ai.engine_state` in a protected path before the migration/backfill.
   This table-only backup is **not** a whole-database disaster-recovery backup.
   Maintain a separate tested off-device backup for disaster recovery.
3. Review and explicitly authorize applying
   `standalone-ai/migrations/003_shadow_decisions.sql`. The migration adds a
   table/index but never rewrites/deletes prior data; check ownership and
   least-privilege grants for the real AI DB user.
4. The script defaults to a read-only inventory, validates that both decision
   ledgers match exactly, that keys and timestamps are valid, and never
   silently chooses one ledger if they differ.

## Local tests (safe; no database)

From the `standalone-ai` directory:

```bash
python3 -m unittest discover -s tests -p 'test_shadow_archive.py' -v
```

## Database preparation (separate authorization required)

With production AI engine stopped and an explicit maintenance plan, take a
dedicated `pg_dump -Fc -t spff_ai.engine_state` backup. Validate with
`pg_restore --list`. Copy off-device if possible. Apply the SQL migration
with `psql -v ON_ERROR_STOP=1 -f` under a reviewed migration role; never
run at service startup.

Use the same AI database credentials already configured by the operator.
Do not paste the DSN, password, or `.env` into chat/logs.

With `AI_STATE_DSN` exported in the executing process environment:

```bash
cd standalone-ai
python3 scripts/backfill_shadow_decisions.py \
  --scope greenhouse-01/esp32-s3-01/soil-1/source-shadow
```

Dry-run only: prints validated decision counts and missing records.

The actual backfill requires explicit operator approval and a verified
backup; it writes new copies ONLY to `spff_ai.shadow_decisions`:

```bash
python3 scripts/backfill_shadow_decisions.py \
  --scope greenhouse-01/esp32-s3-01/soil-1/source-shadow \
  --apply --confirm BACKFILL_ONLY \
  --backup-file /path/to/verified-engine-state.dump
```

This transaction is atomic and idempotent by `scope,fingerprint`: existing
rows must match both ID and payload; mismatches abort. The utility does not
modify original decision caches or old audit snapshots.

## Next stage — NOT part of this change

Only after the archive is verified, implement and test an opt-in runtime
transition using the archive for durable deduplication, `/decisions`, and
dashboard reads. Then bound `live.decisions` and `decisions` in
`engine_state` with an atomic, rollback-safe migration. Never prune the
current decision, obligations, sessions, feedback, or safety/ACK evidence.
Retain the full archive and check total counts/fingerprints before any removal.
Historic 116 GB audit cleanup is an independent operation requiring its own
backup and destructive-change approval.
