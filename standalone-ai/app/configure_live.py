"""Admin CLI: save a validated AI profile, never SPFF doses or actuator commands.

Usage: python -m app.configure_live /path/to/calibrated-profile.json --actor name
Requires AI_STATE_DSN with write rights for AI profile tables; no HTTP mutation.
"""
import argparse
from pathlib import Path

from .live_engine import LiveProfile
from .settings import Settings


def main():
    import psycopg
    from psycopg.types.json import Jsonb
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    parser.add_argument("--actor", required=True)
    args = parser.parse_args()
    settings = Settings.load()
    if not settings.state_dsn:
        raise ValueError("AI_STATE_DSN is required")
    profile = LiveProfile.model_validate_json(args.profile.read_text(encoding="utf-8-sig"))
    if profile.planning.simulation_only or profile.version != profile.planning.version:
        raise ValueError("Profile requires a consistent version and simulation_only=false")
    if profile.missed_schedule_policy != "review":
        raise ValueError("Only explicit review of schedules missed before first import is supported")
    scope = f"{settings.site_id}/{settings.device_id}/{settings.zone_id}/source-shadow"
    data = profile.model_dump(mode="json")
    with psycopg.connect(settings.state_dsn, connect_timeout=5) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ("spff_ai:" + scope,))
        old = connection.execute("SELECT profile FROM spff_ai.runtime_profile_history WHERE scope=%s AND version=%s", (scope, profile.version)).fetchone()
        if old and old[0] != data:
            raise ValueError("Version already exists with different data; increment the version")
        connection.execute("INSERT INTO spff_ai.runtime_profile_history(scope,version,profile,updated_by) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", (scope, profile.version, Jsonb(data), args.actor))
        connection.execute("INSERT INTO spff_ai.runtime_profiles(scope,version,profile,updated_by) VALUES (%s,%s,%s,%s) ON CONFLICT(scope) DO UPDATE SET version=excluded.version,profile=excluded.profile,updated_by=excluded.updated_by,updated_at=now()", (scope, profile.version, Jsonb(data), args.actor))
    print("Validated AI profile saved; no SPFF program or actuator command changed.")


if __name__ == "__main__":
    main()
