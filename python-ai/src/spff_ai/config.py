from dataclasses import dataclass
import math
import os
import json
from dataclasses import field
from .fuzzy import FuzzyProfile


@dataclass(frozen=True)
class Settings:
    database_url: str
    site: str
    device: str
    telemetry_age: int = 120
    status_age: int = 90
    alpha: float = 0.2
    water_min: float = 25
    fert_min: float = 20
    evidence_complete: bool = False
    execution_mode: str = "SHADOW_MODE"
    fuzzy_profile: FuzzyProfile = field(default_factory=FuzzyProfile)
    ema_min_seconds: float = 5
    ema_outlier_factor: float = 3
    ema_profile_revision: str = "default-v1"

    def __post_init__(self):
        if self.execution_mode != "SHADOW_MODE":
            raise ValueError("Only SHADOW_MODE is implemented")
        if not self.database_url or not self.site or not self.device:
            raise ValueError("DATABASE_URL, SITE_ID and DEVICE_ID are required")
        if self.telemetry_age <= 0 or self.status_age <= 0:
            raise ValueError("Freshness limits must be positive")
        if not math.isfinite(self.alpha) or not 0 < self.alpha <= 1:
            raise ValueError("Invalid EMA_ALPHA")
        if not all(math.isfinite(v) and 0 < v <= 100 for v in (self.water_min, self.fert_min)):
            raise ValueError("Tank thresholds must be in (0,100]")
        if (not math.isfinite(self.ema_min_seconds) or not math.isfinite(self.ema_outlier_factor)
                or not 0 < self.ema_min_seconds <= self.telemetry_age or self.ema_outlier_factor <= 1):
            raise ValueError("Invalid EMA interval/outlier settings")
        if not self.ema_profile_revision or self.fuzzy_profile.zone_id != "soil-1":
            raise ValueError("EMA profile and supported soil-1 zone required")

    @classmethod
    def from_env(cls):
        if "IRRIGATION_MAX_L" in os.environ:
            raise ValueError("IRRIGATION_MAX_L is not a zone calibration; replace with FUZZY_PROFILE_JSON")
        complete = os.getenv("DELIVERY_EVIDENCE_COMPLETE", "false")
        if complete not in ("true", "false"):
            raise ValueError("DELIVERY_EVIDENCE_COMPLETE must be true or false")
        return cls(os.environ["DATABASE_URL"], os.environ["SITE_ID"], os.environ["DEVICE_ID"],
                   int(os.getenv("TELEMETRY_MAX_AGE_SECONDS", "120")),
                   int(os.getenv("STATUS_MAX_AGE_SECONDS", "90")),
                   float(os.getenv("EMA_ALPHA", "0.2")),
                   float(os.getenv("MIN_WATER_TANK_PERCENT", "25")),
                   float(os.getenv("MIN_FERT_TANK_PERCENT", "20")),
                   complete == "true",
                   os.getenv("EXECUTION_MODE", "SHADOW_MODE"),
                   FuzzyProfile(**json.loads(os.getenv("FUZZY_PROFILE_JSON", "{}"))),
                   float(os.getenv("EMA_MIN_INTERVAL_SECONDS", "5")),
                   float(os.getenv("EMA_OUTLIER_FACTOR", "3")),
                   os.getenv("EMA_PROFILE_REVISION", "default-v1"))
