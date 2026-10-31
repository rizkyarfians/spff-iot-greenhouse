from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Config(Model):
    version: str = "simulation-1"
    simulation_only: bool = True
    timezone: Literal["Asia/Jakarta"] = "Asia/Jakarta"
    alpha: float = Field(default=0.3, gt=0, le=1)
    water_flow_lpm: float = Field(default=220, gt=0)
    fertilizer_flow_lpm: float = Field(default=7, gt=0)
    water_curve: list[tuple[float, float]] = [(0, 0), (100, 5000)]
    fertilizer_curve: list[tuple[float, float]] = [(0, 0), (100, 500)]
    water_level_start_threshold: float = Field(default=30, ge=0, le=100)
    water_level_stop_threshold: float = Field(default=5, ge=0, le=100)
    water_level_stable_duration: float = Field(default=30, ge=0)
    minimum_flush_reserve: float = Field(default=100, gt=0)
    priming_water_l: float = Field(default=20, gt=0)
    sensor_data_max_age: float = Field(default=120, gt=0)
    minimum_restart_interval: float = Field(default=60, ge=0)
    minimum_stock_session_l: float = Field(default=1, gt=0)
    fertilizer_stop_percent: float = Field(default=2, ge=0, lt=100)
    max_session_water_l: float = Field(default=4500, gt=0)
    max_session_seconds: float = Field(default=1800, gt=0)
    max_irrigation_l: float = Field(default=500, gt=0)
    dose_tolerance_g: float = Field(default=1, ge=0)
    fuzzy_off_threshold: float = Field(default=0.04, ge=0, lt=1)
    fuzzy_inputs: dict[str, tuple[float, float, float, float]] = {
        "LOW": (0, 0, 25, 50), "MEDIUM": (25, 45, 55, 75), "HIGH": (55, 75, 100, 100)
    }
    fuzzy_outputs: dict[str, tuple[float, float, float, float]] = {
        "OFF": (0, 0, 0.01, 0.02), "LOW": (0.05, 0.15, 0.25, 0.4),
        "MEDIUM": (0.25, 0.4, 0.6, 0.75), "HIGH": (0.6, 0.8, 1, 1)
    }
    fuzzy_rules: dict[str, str] = {"LOW": "HIGH", "MEDIUM": "LOW", "HIGH": "OFF"}

    @model_validator(mode="after")
    def check_config(self):
        if self.water_level_start_threshold <= self.water_level_stop_threshold:
            raise ValueError("water start threshold must exceed stop threshold")
        if self.priming_water_l + self.minimum_flush_reserve >= self.max_session_water_l:
            raise ValueError("priming + flushing must fit the water budget")
        for curve in (self.water_curve, self.fertilizer_curve):
            if len(curve) < 2 or curve[0][0] != 0 or curve[-1][0] != 100:
                raise ValueError("tank curves must cover 0..100 percent")
            if any(not (0 <= x <= 100 and y >= 0) for x, y in curve):
                raise ValueError("invalid tank curve")
            if any(a[0] >= b[0] or a[1] >= b[1] for a, b in zip(curve, curve[1:])):
                raise ValueError("tank curves must increase strictly")
        for groups, upper in ((self.fuzzy_inputs, 100), (self.fuzzy_outputs, 1)):
            for points in groups.values():
                if list(points) != sorted(points) or points[0] < 0 or points[-1] > upper or points[0] == points[-1]:
                    raise ValueError("invalid membership trapezoid")
        if not self.fuzzy_rules or set(self.fuzzy_rules) != set(self.fuzzy_inputs):
            raise ValueError("each input membership requires a rule")
        if any(v not in self.fuzzy_outputs for v in self.fuzzy_rules.values()):
            raise ValueError("unknown fuzzy output")
        # A gap must fail at configuration time, not appear as zero irrigation.
        for i in range(1001):
            x = i / 10
            if not any(a <= x <= d and (a < x < d or a == b == x or c == d == x)
                       for a, b, c, d in self.fuzzy_inputs.values()):
                raise ValueError("input memberships leave an uncovered moisture value")
        return self


class Snapshot(Model):
    message_id: str = Field(min_length=1)
    recorded_at: datetime
    mode: Literal["manual", "automatic"]
    emergency_stop: bool
    critical_fault: bool
    interlock: bool
    execution_known: bool
    pumps_off: bool
    moisture: float = Field(ge=0, le=100)
    moisture_valid: bool
    water_percent: float = Field(ge=0, le=100)
    water_valid: bool
    fertilizer_percent: float = Field(ge=0, le=100)
    fertilizer_valid: bool
    water_flow_valid: bool
    fertilizer_flow_valid: bool
    rain: bool = False

    @model_validator(mode="after")
    def aware_time(self):
        if self.recorded_at.tzinfo is None:
            raise ValueError("recorded_at must include timezone")
        return self


class Program(Model):
    program_id: str = Field(min_length=1)
    revision: int = Field(default=1, ge=1)
    crop_id: str = "sweet-potato"
    planting_date: date
    application_mode: Literal["once", "interval", "sensor"] = "once"
    application_date: date | None = None
    hst_from: int = Field(default=10, ge=0)
    hst_to: int = Field(default=10, ge=0)
    interval_days: int | None = Field(default=None, ge=1)
    target_stock_l: float = Field(gt=0)
    concentration_g_l: float = Field(gt=0)
    approved: bool = False

    @model_validator(mode="after")
    def schedule_valid(self):
        if self.hst_to < self.hst_from or self.hst_to > 1000:
            raise ValueError("HST range must be ordered and <= 1000")
        if self.application_mode == "once" and self.application_date is None:
            raise ValueError("once program needs application_date")
        if self.application_mode == "interval" and self.interval_days is None:
            raise ValueError("interval program needs interval_days")
        return self


class Feedback(Model):
    session_id: str
    event_id: str
    recorded_at: datetime
    actual_water_l: float = Field(ge=0)
    actual_stock_l: float = Field(ge=0)
    water_on_seconds: float = Field(ge=0)
    fertilizer_on_seconds: float = Field(ge=0)
    measurement_valid: bool
    pumps_off: bool
    safe_shutdown_complete: bool
    reason: Literal["target_reached", "water_low", "partial", "emergency_stop", "critical_fault", "manual", "restart", "stock_low"]

    @model_validator(mode="after")
    def aware_time(self):
        if self.recorded_at.tzinfo is None:
            raise ValueError("recorded_at must include timezone")
        return self
