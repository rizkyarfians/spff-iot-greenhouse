from datetime import date, timedelta
from .models import Config, Program


def tank_liters(percent: float, curve: list[tuple[float, float]]) -> float:
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= percent <= x1:
            return y0 + (percent - x0) / (x1 - x0) * (y1 - y0)
    raise ValueError("level outside calibrated tank curve")


def membership(x: float, points: tuple[float, float, float, float]) -> float:
    a, b, c, d = points
    if x < a or x > d:
        return 0.0
    if b <= x <= c:
        return 1.0
    if x < b:
        return (x - a) / (b - a) if b != a else 1.0
    return (d - x) / (d - c) if d != c else 1.0


def fuzzy_volume(moisture: float, config: Config) -> dict:
    strengths = {name: membership(moisture, points) for name, points in config.fuzzy_inputs.items()}
    numerator = denominator = 0.0
    # Discrete centroid, trapezoidal integration, MIN implication and MAX aggregation.
    for i in range(1001):
        x = i / 1000
        value = max(min(strengths[rule], membership(x, config.fuzzy_outputs[result]))
                    for rule, result in config.fuzzy_rules.items())
        weight = 0.5 if i in (0, 1000) else 1.0
        numerator += weight * x * value
        denominator += weight * value
    if denominator <= 0:
        raise ValueError("fuzzy rules have no support")
    score = numerator / denominator
    return {"score": score, "memberships": strengths,
            "water_l": 0.0 if score <= config.fuzzy_off_threshold else score * config.max_irrigation_l}


def occurrences(program: Program, today: date) -> list[date]:
    """Explicit policy: oldest missed approved calendar occurrence first; sensor schedules held."""
    if not program.approved or program.application_mode == "sensor":
        return []
    if program.application_mode == "once":
        day = program.application_date
        assert day is not None
        hst = (day - program.planting_date).days
        return [day] if day <= today and program.hst_from <= hst <= program.hst_to else []
    return [day for hst in range(program.hst_from, program.hst_to + 1, program.interval_days or 1)
            if (day := program.planting_date + timedelta(days=hst)) <= today]


def plan_fertigation(remaining_g: float, concentration: float, water_pct: float,
                     stock_pct: float, flows: dict, c: Config) -> dict:
    water_available = min(c.max_session_water_l,
                          tank_liters(water_pct, c.water_curve) - tank_liters(c.water_level_stop_threshold, c.water_curve))
    reserve = c.priming_water_l + c.minimum_flush_reserve
    injection_water = water_available - reserve
    if injection_water <= 0:
        return {"hold": "insufficient_water_with_flush_reserve"}
    stock_available = tank_liters(stock_pct, c.fertilizer_curve) - tank_liters(c.fertilizer_stop_percent, c.fertilizer_curve)
    duration_budget = c.max_session_seconds / 60 - reserve / flows["water"]
    stock_target = min(remaining_g / concentration, stock_available,
                       injection_water / flows["water"] * flows["fertilizer"],
                       max(0, duration_budget) * flows["fertilizer"])
    if stock_target <= 0 or (stock_target < c.minimum_stock_session_l and remaining_g / concentration > stock_target + 1e-9):
        return {"hold": "no_feasible_session_within_water_stock_time_limits"}
    water_target = reserve + stock_target / flows["fertilizer"] * flows["water"]
    return {"water_l": water_target, "stock_l": stock_target,
            "mass_g": stock_target * concentration,
            "duration_seconds": water_target / flows["water"] * 60,
            "priming_water_l": c.priming_water_l, "flush_reserve_l": c.minimum_flush_reserve}
