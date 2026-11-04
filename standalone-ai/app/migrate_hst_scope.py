"""One-time non-destructive migration of HST subsection to a separate small scope.

Run only after checking the production AI_STATE_DSN and taking an engine_state
backup. The legacy row and all of its history remain unchanged. Never copy
the 55+ MB legacy decisions field to HST. This migration is idempotent.
"""
from __future__ import annotations

from .settings import Settings


def migrate():
    import psycopg
    from psycopg.types.json import Jsonb

    settings = Settings.load()
    if settings.mode != "SHADOW_MODE" or not settings.state_dsn:
        raise ValueError("HST migration requires SHADOW_MODE and PostgreSQL state DSN")

    original = (f"{settings.site_id}/{settings.device_id}/"
                f"{settings.zone_id}/source-shadow")
    hst_scope = original + "/hst-v1"
    with psycopg.connect(settings.state_dsn, connect_timeout=5) as connection:
        connection.execute("SET LOCAL statement_timeout = '8s'")
        connection.execute("SET LOCAL lock_timeout = '2s'")
        row = connection.execute(
            "SELECT payload->'hst_workflow' FROM spff_ai.engine_state "
            "WHERE scope=%s", (original,)
        ).fetchone()
        prior = row[0] if row and row[0] is not None else {}
        if not isinstance(prior, dict):
            raise ValueError("legacy hst_workflow must be a JSON object")
        for key in ("obligations", "proposals", "approvals"):
            if key in prior and not isinstance(prior[key], dict):
                raise ValueError("legacy HST section malformed")
        # Never overwrite an existing v1 HST scope during repeat rollouts.
        # All existing ACK/review identities and progress remain authoritative.
        inserted = connection.execute(
            "INSERT INTO spff_ai.engine_state(scope,payload) VALUES (%s,%s) "
            "ON CONFLICT(scope) DO NOTHING RETURNING scope",
            (hst_scope, Jsonb({"hst_workflow": prior})),
        ).fetchone() is not None
        actual = connection.execute(
            "SELECT payload->'hst_workflow' FROM spff_ai.engine_state "
            "WHERE scope=%s", (hst_scope,)
        ).fetchone()
        if not actual or not isinstance(actual[0], dict):
            raise RuntimeError("new HST scope could not be verified")
        new = actual[0]
    print("HST_SCOPE_MIGRATION=" + ("CREATED" if inserted else "EXISTING_PRESERVED"))
    print("HST_OBLIGATIONS=" + str(len(new.get("obligations", {}))))
    print("HST_PROPOSALS=" + str(len(new.get("proposals", {}))))
    print("HST_APPROVALS=" + str(len(new.get("approvals", {}))))
    print("LEGACY_STATE_UNCHANGED=YES")


if __name__ == "__main__":
    migrate()
