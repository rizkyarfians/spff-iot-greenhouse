"""SHADOW-only illustrated two-day irrigation deferral, never an ESP32 schedule.

The SPFF water tank is reported as 1800 L / 180 cm. MQTT Worker converts
the legacy tank_water_distance_cm channel as LIQUID HEIGHT from the bottom,
not the raw top-down transducer distance. Empty/full offset, dead volume,
tank cross-section and reserve remain UNCALIBRATED. This is an illustrative
geometric split only, not an authorized pump volume or a firm schedule.
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
    height_health = health.get("tank_water_distance_cm") if isinstance(health, dict) else None
    height_valid = (isinstance(height_health, dict)
                    and height_health.get("valid") is True)
    liquid_height = _finite(telemetry.get("tank_water_distance_cm"))
    reported_percent = _finite(telemetry.get("tank_water_level_pct"))
    percent_health = health.get("tank_water_level_pct") if isinstance(health, dict) else None
    percent_valid = isinstance(percent_health, dict) and percent_health.get("valid") is True
    target = _finite(fuzzy_water_l)
    capacity = _finite(capacity_l)
    height = _finite(height_cm)
    if capacity is None or height is None or capacity <= 0 or height <= 0:
        raise ValueError("invalid preview-only tank dimensions")

    if not source_read_only or not source_current:
        status = "SOURCE_UNAVAILABLE"
    elif target is None or target < 0:
        status = "FUZZY_UNAVAILABLE"
    elif not height_valid or liquid_height is None:
        status = "HEIGHT_UNVERIFIED"
    elif not 0 <= liquid_height <= height:
        status = "HEIGHT_OUT_OF_RANGE"
    elif (not percent_valid or reported_percent is None
          or not 0 <= reported_percent <= 100
          or abs(reported_percent - liquid_height / height * 100) > 1.0):
        status = "LEVEL_CONFLICT"
    else:
        status = "GEOMETRY_ONLY"

    # The historical *_distance_cm field is a normalized liquid HEIGHT.
    # This is not the physical clearance between the transducer and water.
    illustrative_l = (capacity * liquid_height / height
                      if status == "GEOMETRY_ONLY" else None)
    today_max = min(target, illustrative_l) if illustrative_l is not None else None
    tomorrow_min = max(0.0, target - today_max) if today_max is not None else None
    return {
        "status": status,
        "basis": "REPORTED_LIQUID_HEIGHT_UNCALIBRATED",
        "today_date": jakarta_today.isoformat(),
        "tomorrow_date": (jakarta_today + timedelta(days=1)).isoformat(),
        "reported_liquid_height_cm": liquid_height if status == "GEOMETRY_ONLY" else None,
        "illustrative_available_l": illustrative_l,
        "fuzzy_demand_l": target if target is not None and target >= 0 and source_current else None,
        "today_absolute_max_l": today_max,
        "tomorrow_at_least_l": tomorrow_min,
        "reserve_l": None,
        "is_firm_schedule": False,
        "can_dispatch": False,
    }
