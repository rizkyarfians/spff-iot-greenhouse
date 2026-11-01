"""Read-only water tank estimate for the SPFF staging dashboard.

A 1,800 L tank with an effective water height of 180 cm was provided by
the operator. The proportional (linear) model is a visual approximation only:
tank cross-section, dead volume, and level calibration are NOT verified.
No value from this module is a pump command or an interlock decision.
"""
from decimal import Decimal
from math import isfinite


def _value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    try:
        number = float(value)
    except (ValueError, OverflowError):
        return None
    return number if isfinite(number) else None


def estimate_water_tank(telemetry, *, capacity_l=1800.0, height_cm=180.0,
                        source_current=False, source_read_only=False,
                        fuzzy_water_l=None):
    """Never estimate available liters from stale or unverified sensor data."""
    capacity = _value(capacity_l)
    height = _value(height_cm)
    if capacity is None or height is None or capacity <= 0 or height <= 0:
        raise ValueError("tank dimensions must be positive, finite values")
    telemetry = telemetry if isinstance(telemetry, dict) else {}
    raw = _value(telemetry.get("tank_water_level_pct"))
    level = raw if raw is not None and 0 <= raw <= 100 else None
    health = telemetry.get("sensor_health")
    diagnostics = health.get("tank_water_level_pct") if isinstance(health, dict) else None
    sensor_valid = diagnostics.get("valid") if isinstance(diagnostics, dict) else None
    sensor_valid = sensor_valid if type(sensor_valid) is bool else None
    # IMPORTANT: MQTT Worker tankLevels.ts defines this legacy "distance"
    # channel as LIQUID HEIGHT from the bottom after firmware processing.
    # The physical ultrasonic transducer faces down, but the persisted value
    # is NOT raw sensor-to-surface distance. Never invert it here.
    liquid_height = _value(telemetry.get("tank_water_distance_cm"))
    height_health = health.get("tank_water_distance_cm") if isinstance(health, dict) else None
    height_valid = (isinstance(height_health, dict)
                    and height_health.get("valid") is True)
    orientation_conflict = (
        height_valid and liquid_height is not None and 0 <= liquid_height <= height
        and level is not None and sensor_valid is True
        and abs(level - liquid_height / height * 100) > 1.0
    )

    if not source_read_only or not telemetry:
        status = "NO_DATA"
    elif not source_current:
        status = "STALE"
    elif raw is None:
        status = "NO_DATA"
    elif level is None:
        status = "OUT_OF_RANGE"
    elif sensor_valid is not True:
        status = "UNVERIFIED"
    elif orientation_conflict:
        status = "ORIENTATION_CONFLICT"
    else:
        status = "ESTIMATED"

    estimated_l = capacity * level / 100 if status == "ESTIMATED" else None
    estimated_height = height * level / 100 if status == "ESTIMATED" else None
    demand = _value(fuzzy_water_l)
    demand = demand if demand is not None and demand >= 0 and source_current else None
    delta = estimated_l - demand if estimated_l is not None and demand is not None else None
    return {
        "basis": "LINEAR_LEVEL_APPROXIMATION",
        "capacity_l": capacity,
        "tank_height_cm": height,
        "reported_level_pct": level,
        "sensor_valid": sensor_valid,
        "estimated_water_height_cm": estimated_height,
        "estimated_available_l": estimated_l,
        "fuzzy_demand_l": demand,
        "theoretical_balance_l": delta,
        "level_status": status,
        "comparison_status": (
            "ENOUGH_ESTIMATE" if delta is not None and delta >= 0
            else "BELOW_ESTIMATE" if delta is not None
            else "NOT_COMPARABLE"
        ),
        "can_dispatch": False,
    }
