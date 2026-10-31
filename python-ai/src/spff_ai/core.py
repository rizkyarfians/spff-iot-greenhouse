"""Pure calculations. This module has no device or network transport."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import math
from uuid import NAMESPACE_URL, uuid5

JAKARTA = timezone(timedelta(hours=7), "Asia/Jakarta")


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def fresh(at, now, seconds):
    return (isinstance(at, datetime) and at.tzinfo is not None
            and 0 <= (now - at).total_seconds() <= seconds)


RANGES = {
    "soil_1_moisture": (0, 100), "soil_2_moisture": (0, 100),
    "soil_1_temp": (-20, 70), "soil_2_temp": (-20, 70), "air_temp": (-20, 70),
    "soil_2_ec_us_cm": (0, 100000), "soil_2_ph": (0, 14),
    "flow_water_total_l": (0, 1e12), "flow_fert_total_l": (0, 1e12),
    "liquid_ec_us_cm": (0, 100000), "liquid_ph": (0, 14),
    "soil_1_ec_us_cm": (0, 100000), "soil_1_ph": (0, 14),
    "tank_water_level_pct": (0, 100), "tank_fert_level_pct": (0, 100),
    "flow_water_lpm": (0, 10000), "flow_fert_lpm": (0, 10000),
}


def sensor_ok(telemetry, key, now, max_age=120):
    value = telemetry.get(key)
    limits = RANGES[key]
    health = (telemetry.get("sensor_health") or {}).get(key)
    return (fresh((telemetry.get("parameter_recorded_at") or {}).get(key, telemetry.get("recorded_at")), now, max_age)
            and isinstance(health, dict) and health.get("valid") is True
            and number(value) and limits[0] <= value <= limits[1])


def triangle(x, a, b, c):
    if x == b:
        return 1.0
    if x <= a or x >= c:
        return 0.0
    return (x-a)/(b-a) if x < b else (c-x)/(c-b)


from .fuzzy import fuzzy_water, FuzzyProfile


@dataclass(frozen=True)
class EMA:
    value: float | None = None
    last_at: datetime | None = None

    def observe(self, value, at, alpha, valid=True):
        if not number(alpha) or not 0 < alpha <= 1:
            raise ValueError("EMA alpha must be in (0,1]")
        if (not valid or not number(value) or not 0 < value <= 10000
                or not isinstance(at, datetime) or at.tzinfo is None
                or (self.last_at is not None and at <= self.last_at)):
            return self
        result = value if self.value is None else alpha*value+(1-alpha)*self.value
        return EMA(result, at)


def hst(recipe, day):
    planted = recipe.get("planting_date")
    return (day-planted).days if isinstance(planted, date) else None


def due(recipe, day):
    age = hst(recipe, day)
    if recipe.get("approval_status") != "approved" or age is None:
        return False
    if not recipe["hst_from"] <= age <= recipe["hst_to"]:
        return False
    mode = recipe.get("application_mode")
    if mode == "once":
        return recipe.get("application_date") == day
    if mode == "interval":
        interval = recipe.get("application_interval_days")
        return isinstance(interval, int) and interval > 0 and (age-recipe["hst_from"]) % interval == 0
    # 'sensor' is not a calendar instruction; requires a future explicit adapter.
    return False


def obligation_id(site, device, recipe_id, day):
    # Revision is deliberately NOT identity: editing a recipe cannot recreate
    # a second dose on the same application day.
    return str(uuid5(NAMESPACE_URL, f"spff:shadow:{site}:{device}:{recipe_id}:{day.isoformat()}"))


def mass_balance(target_l, concentration, deliveries):
    """Absolute final stock liters keyed by globally stable source session ID.

    Identical replays collapse; conflicting evidence fails closed. Never infer
    physical delivery from elapsed time, EMA, EC or a shadow recommendation.
    """
    if not number(target_l) or target_l < 0:
        raise ValueError("Invalid target")
    if not number(concentration) or concentration <= 0:
        raise ValueError("Missing stock concentration")
    unique = {}
    for identity, liters in deliveries:
        if not identity or not number(liters) or liters < 0:
            raise ValueError("Invalid delivery evidence")
        if identity in unique and unique[identity] != liters:
            raise ValueError("Conflicting delivery replay")
        unique[identity] = liters
    actual = sum(unique.values())
    if not math.isfinite(actual):
        raise ValueError("Non-finite delivery total")
    return {"target_stock_l": target_l, "actual_stock_l": actual,
            "remaining_stock_l": max(0.0, target_l-actual),
            "remaining_fertilizer_g": max(0.0, target_l-actual)*concentration,
            "target_fertilizer_g": target_l*concentration,
            "delivered_fertilizer_g": actual*concentration,
            "excess_stock_l": max(0.0, actual-target_l), "evidence_count": len(unique)}


def decide(snapshot, obligations, now, *, telemetry_age=120, status_age=90,
           water_min=25, fert_min=20, max_water_l=None, fuzzy_profile=None):
    """Priority: safety/manual -> outstanding debt -> due calendar -> fuzzy."""
    if max_water_l is not None:
        raise ValueError("Use a referenced zone FuzzyProfile instead of max_water_l")
    t, status, config = snapshot.get("telemetry") or {}, snapshot.get("status") or {}, snapshot.get("config") or {}
    result = {"execution_mode": "SHADOW_MODE", "can_dispatch": False,
              "evaluated_at": now.isoformat(), "action": "HOLD", "reason": ""}

    def finish(action, reason, **extra):
        return {**result, "action": action,
                "status": "HOLD" if action.endswith("HOLD") or action.startswith("WAITING_FOR_EVIDENCE") else action,
                "reason": reason, **extra}

    if not fresh(status.get("recorded_at"), now, status_age) or status.get("online") is not True:
        return finish("SAFETY_HOLD", "device_offline_or_stale")
    if status.get("mode") == "manual" or config.get("desired_mode") == "manual" or config.get("applied_mode") == "manual":
        return finish("MANUAL_HOLD", "manual_mode")
    if (status.get("mode") != "automatic" or config.get("desired_mode") != "automatic"
            or config.get("applied_mode") != "automatic" or config.get("revision") is None
            or config.get("revision") != config.get("acknowledged_revision")
            or config.get("acknowledgement_status") != "applied"):
        return finish("SAFETY_HOLD", "automatic_mode_not_confirmed")
    if snapshot.get("safety_reasons"):
        return finish("SAFETY_HOLD", ";".join(snapshot["safety_reasons"]))
    if not sensor_ok(t, "tank_water_level_pct", now, telemetry_age):
        return finish("SAFETY_HOLD", "water_level_invalid_or_stale")
    if t["tank_water_level_pct"] < water_min:
        pending = sorted((o for o in obligations if number(o.get("remaining_stock_l")) and o["remaining_stock_l"] > 0),
                         key=lambda o:(not (o.get("actual_stock_l",0)>0),o["application_day"],o["obligation_id"]))
        return finish("WAITING_FOR_WATER", "water_below_minimum",
                      obligation_id=pending[0]["obligation_id"] if pending else None)
    if snapshot.get("blockers"):
        return finish("ADAPTER_HOLD", ";".join(snapshot["blockers"]))
    # Unknown delivery history must also block fuzzy: otherwise unknown debt
    # would be silently demoted below normal irrigation.
    if not snapshot.get("evidence_complete", False):
        return finish("WAITING_FOR_EVIDENCE", "delivery_history_not_verified")
    outstanding = sorted((o for o in obligations if o.get("remaining_stock_l", 0) > 0),
                         key=lambda o: (not (o["actual_stock_l"] > 0 or o["application_day"] < now.astimezone(JAKARTA).date()),
                                        o["application_day"], str(o["obligation_id"])))
    if outstanding:
        o = outstanding[0]
        if not o.get("evidence_known", False):
            return finish("WAITING_FOR_EVIDENCE", "obligation_volume_unknown")
        if t["tank_water_level_pct"] < max(water_min, o["min_water_tank_percent"]):
            return finish("WAITING_FOR_WATER", "program_water_minimum", obligation_id=o["obligation_id"])
        if not sensor_ok(t, "tank_fert_level_pct", now, telemetry_age):
            return finish("SAFETY_HOLD", "fertilizer_level_invalid_or_stale")
        if t["tank_fert_level_pct"] < max(fert_min, o["min_stock_tank_percent"]):
            return finish("WAITING_FOR_FERTILIZER", "fertilizer_below_minimum")
        if not all(sensor_ok(t, key, now, telemetry_age) for key in ("flow_water_lpm", "flow_fert_lpm")):
            return finish("SAFETY_HOLD", "flow_sensor_invalid_or_stale")
        action = "RESUME_FERTIGATION" if o["application_day"] < now.astimezone(JAKARTA).date() or o["actual_stock_l"] > 0 else "SCHEDULED_FERTIGATION"
        return finish(action, "outstanding_fertilizer_priority", obligation=o,
                      requires_water_flow_proof=True)
    water_programs = [r for r in snapshot.get("recipes", [])
                      if due(r, now.astimezone(JAKARTA).date()) and r["target_stock_l"] == 0]
    if water_programs:
        # Water-only program completion/correlation is not a fertilizer ledger.
        # Never silently ignore a due database program and fall through to Fuzzy.
        return finish("ADAPTER_HOLD", "water_only_program_requires_completion_adapter")
    completed = [o for o in obligations if o.get("evidence_known") and o.get("remaining_stock_l") == 0]
    if completed and snapshot.get("report_completion", True):
        return finish("COMPLETED", "fertilizer_target_proven", obligation=completed[-1])
    if not all(sensor_ok(t, key, now, telemetry_age) for key in (snapshot.get("moisture_sensor_key", "soil_1_moisture"), "flow_water_lpm")):
        return finish("SAFETY_HOLD", "irrigation_sensor_invalid_or_stale")
    fuzzy = fuzzy_water(t[snapshot.get("moisture_sensor_key", "soil_1_moisture")], profile=fuzzy_profile)
    if fuzzy["inference_status"] != "OK":
        return finish("HOLD", "no_fuzzy_rule_active", fuzzy=fuzzy)
    if fuzzy["demand_percent"] == 0:
        return finish("NO_WATER_NEEDED", "fuzzy_off", fuzzy=fuzzy)
    if fuzzy["calibration_status"] == "NOT_CALIBRATED":
        return finish("NOT_CALIBRATED", "zone_volume_calibration_missing", fuzzy=fuzzy)
    return finish("IRRIGATE", "no_outstanding_fertilizer", fuzzy=fuzzy)


def fertilizer_dose(plant_count, dose_g_per_plant, fertilizer_mass_g, final_stock_volume_l):
    values = (plant_count, dose_g_per_plant, fertilizer_mass_g, final_stock_volume_l)
    if (not all(number(v) and v > 0 for v in values)
            or not isinstance(plant_count, int) or isinstance(plant_count, bool)):
        raise ValueError("Positive explicit plant count, dose, mass and FINAL stock volume required")
    total = plant_count*dose_g_per_plant
    concentration = fertilizer_mass_g/final_stock_volume_l
    return {"total_fertilizer_g": total, "stock_concentration_g_per_l": concentration,
            "required_stock_l": total/concentration}
