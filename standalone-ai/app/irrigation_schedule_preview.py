"""SHADOW-only illustrated two-day irrigation deferral, never an ESP32 schedule.

The SPFF water tank is reported as 1800 L / 180 cm, with the ranging sensor
mounted at the TOP facing DOWN. Empty/full offset, dead volume and reserve
remain UNCALIBRATED. This models an absolute geometric upper bound for today,
not an authorized pump volume. Tomorrow's remainder is a LOWER bound, not a
promise to irrigate or evidence that tomorrow's refill will exist.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from math import isfinite
from zoneinfo import ZoneInfo


def _finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None
    return number if isfinite(number) else None


def illustrate_two_day_irrigation(
    telemetry, *, now=None, capacity_l=1800, height_cm=180,
    fuzzy_water_l=None, source_current=False, source_read_only=False,
):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    jakarta_today = now.astimezone(ZoneInfo("Asia/Jakarta")).date()
    telemetry = telemetry if isinstance(telemetry, dict) else {}
    health = telemetry.get("sensor_health")
    distance_health = health.get("tank_water_distance_cm") if isinstance(health, dict) else None
    distance_valid = (isinstance(distance_health, dict)
                      and distance_health.get("valid") is True)
    distance = _finite(telemetry.get("tank_water_distance_cm"))
    target = _finite(fuzzy_water_l)
    capacity = _finite(capacity_l)
    height = _finite(height_cm)
    if capacity is None or height is None or capacity <= 0 or height <= 0:
        raise ValueError("invalid preview-only tank dimensions")

    if not source_read_only or not source_current:
        status = "SOURCE_UNAVAILABLE"
    elif target is None or target < 0:
        status = "FUZZY_UNAVAILABLE"
    elif not distance_valid or distance is None:
        status = "DISTANCE_UNVERIFIED"
    elif not 0 <= distance <= height:
        status = "DISTANCE_OUT_OF_RANGE"
    else:
        status = "GEOMETRY_ONLY"

    # Top-down range: 0cm means full, 180cm means empty ONLY IF the
    # sensor-to-tank-bottom calibration really is 180cm.
    illustrative_l = (capacity * (height - distance) / height
                      if status == "GEOMETRY_ONLY" else None)
    today_max = min(target, illustrative_l) if illustrative_l is not None else None
    tomorrow_min = max(0.0, target - today_max) if today_max is not None else None
    return {
        "status": status,
        "basis": "TOP_DOWN_UNCALIBRATED_GEOMETRY",
        "today_date": jakarta_today.isoformat(),
        "tomorrow_date": (jakarta_today + timedelta(days=1)).isoformat(),
        "distance_cm": distance if status == "GEOMETRY_ONLY" else None,
        "illustrative_available_l": illustrative_l,
        "fuzzy_demand_l": target if target is not None and target >= 0 and source_current else None,
        "today_absolute_max_l": today_max,
        "tomorrow_at_least_l": tomorrow_min,
        "reserve_l": None,
        "is_firm_schedule": False,
        "can_dispatch": False,
    }
