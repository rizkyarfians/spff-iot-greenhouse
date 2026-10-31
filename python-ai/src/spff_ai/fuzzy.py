"""Configurable Mamdani simulation. Calibration is explicitly zone-total liters."""
from dataclasses import dataclass, field
import math


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True)
class FuzzyProfile:
    moisture: dict = field(default_factory=lambda: {
        "LOW": ["left", 20, 50], "MEDIUM": ["triangle", 25, 50, 75],
        "HIGH": ["right", 50, 80]})
    output: dict = field(default_factory=lambda: {
        "OFF": ["left", 0, 10], "LOW": ["triangle", 10, 25, 40],
        "MEDIUM": ["triangle", 25, 50, 75], "HIGH": ["triangle", 60, 80, 100]})
    rules: dict = field(default_factory=lambda: {"LOW": "HIGH", "MEDIUM": "MEDIUM", "HIGH": "OFF"})
    zone_id: str = "soil-1"
    full_scale_zone_l: float | None = None
    max_zone_l: float | None = None
    calibration_reference: str | None = None

    def __post_init__(self):
        if set(self.moisture) != {"LOW", "MEDIUM", "HIGH"} or set(self.output) != {"OFF", "LOW", "MEDIUM", "HIGH"}:
            raise ValueError("Missing fuzzy sets")
        for definition in (*self.moisture.values(), *self.output.values()):
            kind, *points = definition
            if kind not in ("left", "right", "triangle") or len(points) != (3 if kind == "triangle" else 2):
                raise ValueError("Invalid membership shape")
            if not all(finite(p) and 0 <= p <= 100 for p in points) or any(a >= b for a, b in zip(points, points[1:])):
                raise ValueError("Membership points must increase in [0,100]")
        if any(k not in self.moisture or v not in self.output for k, v in self.rules.items()):
            raise ValueError("Invalid rule reference")
        calibrated = self.full_scale_zone_l is not None or self.max_zone_l is not None or self.calibration_reference is not None
        if calibrated and (not finite(self.full_scale_zone_l) or self.full_scale_zone_l <= 0
                           or not finite(self.max_zone_l) or self.max_zone_l <= 0
                           or not isinstance(self.calibration_reference, str) or not self.calibration_reference.strip()):
            raise ValueError("Zone calibration requires full scale, ceiling and reference")
        if not self.zone_id:
            raise ValueError("Zone identity required")


def membership(x, definition):
    kind, *p = definition
    if kind == "left":
        return max(0.0, min(1.0, (p[1]-x)/(p[1]-p[0])))
    if kind == "right":
        return max(0.0, min(1.0, (x-p[0])/(p[1]-p[0])))
    a, b, c = p
    if x == b:
        return 1.0
    if x <= a or x >= c:
        return 0.0
    return (x-a)/(b-a) if x < b else (c-x)/(c-b)


def fuzzy_water(moisture, temperature=None, max_l=None, *, profile=None):
    """Temperature is optional metadata, not an inference input in this version.

    Legacy max_l is deliberately refused: an arbitrary ceiling cannot establish
    liters/plant, liters/bed or liters/zone. Use a referenced zone calibration.
    """
    if not finite(moisture) or not 0 <= moisture <= 100:
        raise ValueError("Invalid moisture")
    if max_l is not None:
        raise ValueError("Legacy liter scale is uncalibrated; use FuzzyProfile")
    p = profile or FuzzyProfile()
    degrees = {key: membership(moisture, shape) for key, shape in p.moisture.items()}
    strengths = {key: 0.0 for key in p.output}
    for antecedent, consequent in p.rules.items():
        strengths[consequent] = max(strengths[consequent], degrees[antecedent])
    aggregate = [max(min(strengths[key], membership(x, shape))
                     for key, shape in p.output.items()) for x in range(101)]
    area = sum(aggregate)
    centroid = sum(x*y for x, y in enumerate(aggregate))/area if area else None
    off_only = strengths["OFF"] > 0 and all(v == 0 for k, v in strengths.items() if k != "OFF")
    demand = 0.0 if off_only else centroid
    calibrated = p.full_scale_zone_l is not None
    target = min(p.max_zone_l, p.full_scale_zone_l*(demand/100)) if calibrated and demand is not None else None
    return {"method": "mamdani_min_max_centroid", "calibration_status": "CALIBRATED" if calibrated else "NOT_CALIBRATED",
            "inference_status": "OK" if area else "NO_RULE_ACTIVE", "centroid_percent": centroid,
            "demand_percent": demand, "raw_unit": "dimensionless_percent", "target_water_zone_l": target,
            "target_unit": "L/zone" if target is not None else None, "zone_id": p.zone_id,
            "trace": {"input_moisture_percent": moisture, "temperature_used": False,
                      "memberships": degrees, "rule_strengths": strengths,
                      "membership_config": p.moisture, "output_config": p.output, "rules": p.rules,
                      "aggregate_step": 1, "aggregate": aggregate, "area": area,
                      "calibration_reference": p.calibration_reference,
                      "full_scale_zone_l": p.full_scale_zone_l, "max_zone_l": p.max_zone_l}}
