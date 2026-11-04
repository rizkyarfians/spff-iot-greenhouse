"""Resolve a verified Guide target without treating tank capacity as crop demand."""
from __future__ import annotations

import copy
import math


def _positive(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0)


def _activity(guides, program_id, activity_id, device_id):
    if not isinstance(guides, dict) or guides.get("status") != "READ_ONLY_PREVIEW":
        raise ValueError("guide_source_unavailable")
    programs = [p for p in guides.get("programs", []) if p.get("program_id") == program_id]
    if len(programs) != 1:
        raise ValueError("guide_program_not_unique")
    program = programs[0]
    if program.get("status") != "PREVIEW_ONLY" or program.get("hold_reasons"):
        raise ValueError("guide_program_requires_review")
    config = program.get("config") or {}
    if config.get("deviceId") != device_id:
        raise ValueError("guide_device_binding_changed")
    activities = [a for a in program.get("activities", []) if a.get("activity_id") == activity_id]
    if len(activities) != 1:
        raise ValueError("guide_activity_not_unique")
    activity = activities[0]
    if str(activity.get("method") or "").strip().lower() not in ("kocor", "irigasi", "fertigasi", "tetes", "drip"):
        raise ValueError("guide_route_not_irrigation")
    if activity.get("warnings") or not _positive(activity.get("reference_water_l")):
        raise ValueError("guide_water_target_requires_review")
    return program, activity


def bind_guide_irrigation(base_profile, guides, *, program_id, activity_id,
                         device_id, version, reference):
    """Require an existing operational hydraulic profile; never promote simulation defaults."""
    from .live_engine import LiveProfile
    if base_profile.planning.simulation_only or base_profile.version != base_profile.planning.version:
        raise ValueError("existing_operational_profile_required")
    program, activity = _activity(guides, program_id, activity_id, device_id)
    data = copy.deepcopy(base_profile.model_dump(mode="json"))
    data["version"] = version
    data["planning"]["version"] = version
    data["planning"]["max_irrigation_l"] = activity["reference_water_l"]
    data["irrigation_guide"] = {
        "program_id": program_id, "activity_id": activity_id, "device_id": device_id,
        "program_revision": program["revision"], "guide_revision": str(program["guide_revision"]),
        "source_sha256": program["source_sha256"],
        "planting_date": program["config"]["plantingDate"],
        "water_l": activity["reference_water_l"], "verification_reference": reference,
    }
    return LiveProfile.model_validate(data)


def resolve_guide_irrigation(profile, guides):
    result = {"status": "MISSING", "version": None, "program_id": None,
              "activity_id": None, "target_water_l": None,
              "calculation_ready": False, "can_dispatch": False,
              "blockers": ["operational_profile_missing"]}
    if profile is None:
        return None, result
    result.update(status="REVIEW_REQUIRED", version=profile.version)
    if profile.planning.simulation_only or profile.version != profile.planning.version:
        result["blockers"] = ["operational_profile_not_validated"]
        return None, result
    binding = profile.irrigation_guide
    if binding is None:
        result["blockers"] = ["verified_guide_irrigation_binding_missing"]
        return None, result
    result.update(program_id=binding.program_id, activity_id=binding.activity_id)
    try:
        program, activity = _activity(guides, binding.program_id, binding.activity_id, binding.device_id)
        if (program["revision"] != binding.program_revision
                or str(program["guide_revision"]) != binding.guide_revision
                or program["source_sha256"] != binding.source_sha256
                or program["config"]["plantingDate"] != binding.planting_date
                or abs(activity["reference_water_l"] - binding.water_l) > 0.000001):
            raise ValueError("guide_irrigation_binding_stale")
    except (ValueError, KeyError, TypeError) as error:
        code = str(error) if isinstance(error, ValueError) else "guide_irrigation_source_invalid"
        result["blockers"] = [code]
        return None, result
    result.update(status="GUIDE_BOUND", target_water_l=binding.water_l, blockers=[])
    return profile.planning, result
