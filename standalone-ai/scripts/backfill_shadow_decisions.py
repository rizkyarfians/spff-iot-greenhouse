#!/usr/bin/env python3
"""Explicit, one-time backfill of AI SHADOW decisions into a normalized archive.

Default: read-only plan. --apply requires an existing backup and explicit token.
Does not edit engine_state, audit_events, SPFF operational schema, or actuators.
Run with the AI Engine STOPPED after manually applying migration 003.
"""
import argparse
import os
import subprocess
from pathlib import Path

from app.shadow_archive import validate_shadow_decisions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", required=True, help="Exact source-shadow scope")
    parser.add_argument("--apply", action="store_true", help="Insert archived copies")
    parser.add_argument("--confirm", default="", help="Required: BACKFILL_ONLY")
    parser.add_argument("--backup-file", default="", help="Verified pg_dump of engine_state")
    args = parser.parse_args()

    if not args.scope.endswith("/source-shadow") or args.scope.count("/") < 3:
        parser.error("only an exact /source-shadow scope is accepted")
    if args.apply and args.confirm != "BACKFILL_ONLY":
        parser.error("--apply requires --confirm BACKFILL_ONLY")
    if args.apply:
        backup = Path(args.backup_file)
        if not args.backup_file or not backup.is_file() or backup.stat().st_size == 0:
            parser.error("--apply requires a nonempty --backup-file")
        try:
            subprocess.run(
                ["pg_restore", "--list", str(backup)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=30,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            parser.error("backup must be a readable PostgreSQL custom-format dump")

    dsn = os.environ.get("AI_STATE_DSN")
    if not dsn:
        parser.error("AI_STATE_DSN must be set in the caller environment")

    import psycopg
    from psycopg.types.json import Jsonb

    with psycopg.connect(dsn, connect_timeout=5) as connection:
        if not args.apply:
            connection.execute("SET TRANSACTION READ ONLY")
        else:
            connection.execute("SET LOCAL lock_timeout = '5s'")
            # Serializes with the real source-shadow writer.
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                ("spff_ai:" + args.scope,),
            )

        exists = connection.execute(
            "SELECT to_regclass('spff_ai.shadow_decisions')"
        ).fetchone()[0]
        if exists is None:
            raise RuntimeError("migration 003 is missing; no data modified")
        state_row = connection.execute(
            "SELECT payload FROM spff_ai.engine_state WHERE scope=%s",
            (args.scope,),
        ).fetchone()
        if state_row is None:
            raise RuntimeError("AI state scope not found; no data modified")

        records = validate_shadow_decisions(state_row[0])
        previous = connection.execute(
            "SELECT fingerprint,decision_id,payload "
            "FROM spff_ai.shadow_decisions WHERE scope=%s",
            (args.scope,),
        ).fetchall()
        existing = {fingerprint: (decision_id, payload)
                    for fingerprint, decision_id, payload in previous}

        for fingerprint, decision_id, _observed_at, payload in records:
            if fingerprint in existing and existing[fingerprint] != (decision_id, payload):
                raise RuntimeError("historical archive mismatch; refusing to continue")

        missing = [item for item in records if item[0] not in existing]
        print("validated_state_decisions:", len(records))
        print("previously_archived:", len(previous))
        print("missing_from_archive:", len(missing))
        if not args.apply:
            print("DRY_RUN: no writes performed")
            return

        # Inserts are one atomic transaction; a failure rolls back all new copies.
        for fingerprint, decision_id, observed_at, payload in missing:
            connection.execute(
                "INSERT INTO spff_ai.shadow_decisions "
                "(scope,fingerprint,decision_id,observed_at,payload) "
                "VALUES (%s,%s,%s,%s,%s)",
                (args.scope, fingerprint, decision_id, observed_at, Jsonb(payload)),
            )

        final = connection.execute(
            "SELECT count(*) FROM spff_ai.shadow_decisions WHERE scope=%s",
            (args.scope,),
        ).fetchone()[0]
        if final != len(records):
            raise RuntimeError("archive count differs from state; transaction rolled back")
        print("ARCHIVE_COMMITTED:", final)
        print("engine_state_unchanged: true")
        print("audit_events_unchanged: true")


if __name__ == "__main__":
    main()
