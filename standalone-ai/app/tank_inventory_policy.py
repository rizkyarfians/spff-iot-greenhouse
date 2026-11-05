"""Operator-selected tank inventory target, independent of Guide application methods.

Fuzzy determines whether water is needed. It does not scale inventory by its score.
The target is an inventory estimate, never a command to bypass a low-level stop.
"""
import hashlib
import json
from datetime import datetime, timedelta

from .calculations import fuzzy_volume


def policy_fingerprint(config, *, capacity_l, height_cm, site_id, device_id, zone_id):
    model = config.model_dump(mode="json")
    rules = {key: model[key] for key in ("fuzzy_inputs", "fuzzy_outputs", "fuzzy_rules",
        "fuzzy_off_threshold", "sensor_data_max_age")}
    data = {"policy": "AVAILABLE_TANK", "rules": rules, "capacity_l": capacity_l,
        "height_cm": height_cm, "site_id": site_id, "device_id": device_id, "zone_id": zone_id}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def evaluate_inventory_target(config, preview, sensor_blockers, tank, *, approval, fingerprint, now, live_source,
                              sensor_expires_at=None):
    blockers = list(sensor_blockers)
    result = {"status": "BLOCKED", "basis": "TANK_INVENTORY_FUZZY",
        "evaluated_at": now.isoformat(), "recorded_at": None, "expires_at": None,
        "profile_version": "tank-inventory-" + fingerprint[:12], "program_id": None,
        "activity_id": None, "input_key": None, "moisture_pct": None,
        "memberships": {}, "dominant_input_classes": [], "rule_outputs": [],
        "score": None, "max_water_l": None, "target_water_l": None,
        "irrigation_needed": None, "can_dispatch": False, "blockers": [],
        "target_policy": "AVAILABLE_TANK", "applies_to": "ALL_PROGRAMS",
        "volume_basis": "LINEAR_LEVEL_APPROXIMATION",
        "stop_policy": "DEVICE_LOW_LEVEL_INTERLOCK",
        "execution_blockers": ["inventory_volume_not_physically_calibrated",
                               "production_water_session_not_commissioned"]}
    if approval != fingerprint:
        blockers.append("tank_policy_rules_or_geometry_require_review")
    if not live_source:
        blockers.append("live_source_required")
    if tank.get("level_status") != "ESTIMATED" or tank.get("estimated_available_l") is None:
        blockers.append("water_inventory_unavailable")
    elif tank["estimated_available_l"] <= 0:
        blockers.append("water_inventory_empty")
    if preview is None:
        blockers.append("fuzzy_classification_unavailable")
    else:
        recorded = datetime.fromisoformat(preview["recorded_at"])
        expires = recorded + timedelta(seconds=min(120, config.sensor_data_max_age))
        if sensor_expires_at is not None:
            expires = min(expires, sensor_expires_at)
        result.update(recorded_at=recorded.isoformat(), expires_at=expires.isoformat())
        if now > expires or (recorded - now).total_seconds() > 5:
            blockers.append("sensor_snapshot_stale")
    result["blockers"] = sorted(set(blockers))
    if blockers:
        return result
    projected = fuzzy_volume(preview["moisture_pct"], config)
    maximum = max(projected["memberships"].values())
    dominant = sorted(name for name, value in projected["memberships"].items() if abs(value - maximum) < 1e-9)
    inventory = tank["estimated_available_l"]
    needed = projected["score"] > config.fuzzy_off_threshold
    result.update(status="READY", input_key=preview["input_key"], moisture_pct=preview["moisture_pct"],
        memberships=projected["memberships"], dominant_input_classes=dominant,
        rule_outputs=sorted(set(config.fuzzy_rules[name] for name in dominant)),
        score=projected["score"], max_water_l=inventory,
        target_water_l=inventory if needed else 0.0, irrigation_needed=needed)
    return result


if __name__ == "__main__":
    from .settings import Settings, load_config
    settings = Settings.load()
    print(policy_fingerprint(load_config(), capacity_l=settings.tank_capacity_l,
        height_cm=settings.tank_height_cm, site_id=settings.site_id,
        device_id=settings.device_id, zone_id=settings.zone_id))
