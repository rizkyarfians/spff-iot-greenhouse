"""Bind Fuzzy's crop-demand ceiling to one explicitly verified saved Guide activity.

No dispatch flags, commands, irrigation schedules or fertilizer doses are changed.
An existing operational hydraulic profile is required; simulator defaults are rejected.
"""
import argparse
import json
from pathlib import Path

from .configure_live import save_profile
from .live_engine import LiveProfile
from .production_profile import bind_guide_irrigation, _activity
from .settings import Settings
from .source import SPFFSource
from .store import PostgresStore


def candidate_status(guides, program_id, activity_id, device_id):
    try:
        _activity(guides, program_id, activity_id, device_id)
    except ValueError as error:
        return {"water_target_eligible": False, "water_target_blockers": [str(error)]}
    return {"water_target_eligible": True, "water_target_blockers": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--program-id")
    parser.add_argument("--activity-id")
    parser.add_argument("--version")
    parser.add_argument("--reference")
    parser.add_argument("--actor")
    parser.add_argument("--base-profile", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    settings = Settings.load()
    if not settings.state_dsn or not settings.source_dsn:
        parser.error("AI_STATE_DSN and AI_SOURCE_DSN are required from the running AI service environment")
    scope = f"{settings.site_id}/{settings.device_id}/{settings.zone_id}/source-shadow"
    store = PostgresStore(settings.state_dsn, scope)
    try:
        raw = store.runtime_profile()
    finally:
        store.close()
    source = SPFFSource(settings.source_dsn, settings.site_id, settings.device_id, settings.zone_id,
                        fertilizer_delivery_route=settings.fertilizer_delivery_route)
    guides = source.inspect_guides()
    if args.list:
        print(json.dumps({"operational_profile_present": raw is not None,
            "profile_version": raw.get("version") if raw else None,
            "device_id": settings.device_id, "source_status": guides.get("status"),
            "programs": [{"program_id": p.get("program_id"), "revision": p.get("revision"),
                "crop_name": p.get("crop_name"), "hold_reasons": p.get("hold_reasons"),
                "activities": [{"activity_id": a.get("activity_id"), "hst": a.get("hst"),
                    "method": a.get("method"), "water_l": a.get("reference_water_l"),
                    "calendar_status": a.get("calendar_status"), "warnings": a.get("warnings", []),
                    **candidate_status(guides, p.get("program_id"), a.get("activity_id"), settings.device_id)}
                    for a in p.get("activities", [])]}
                for p in guides.get("programs", [])]}, indent=2))
        return
    if not all((args.program_id, args.activity_id, args.version, args.reference, args.actor)):
        parser.error("--program-id, --activity-id, --version, --reference and --actor are required")
    if args.base_profile:
        base = LiveProfile.model_validate_json(args.base_profile.read_text(encoding="utf-8-sig"))
    elif raw:
        base = LiveProfile.model_validate(raw)
    else:
        parser.error("No operational profile is installed. Supply a verified hydraulic --base-profile; simulation-1 will not be promoted")
    profile = bind_guide_irrigation(base, guides, program_id=args.program_id,
        activity_id=args.activity_id, device_id=settings.device_id,
        version=args.version, reference=args.reference)
    if args.apply:
        save_profile(settings, profile, args.actor)
        print("GUIDE_IRRIGATION_PROFILE=SAVED; PUMP_COMMANDS=NONE; DISPATCH_FLAGS=UNCHANGED")
    else:
        print(profile.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
