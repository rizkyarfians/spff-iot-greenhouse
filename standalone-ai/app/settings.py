import json
import os
import math
from dataclasses import dataclass
from pathlib import Path

from .models import Config

ROOT = Path(__file__).resolve().parent.parent


def load_env(path):
    """Small .env reader: no shell expansion, execution, or inherited SPFF config."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.strip().replace("_", "").isalnum():
            raise ValueError("invalid .env entry")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 5010
    mode: str = "SHADOW_MODE"
    state_path: str = "data/shadow.sqlite3"
    source_dsn: str = ""
    state_dsn: str = ""
    site_id: str = "greenhouse-01"
    device_id: str = "esp32-s3-01"
    zone_id: str = "soil-1"
    poll_seconds: float = 300
    poll_enabled: bool = False
    hst_bridge_key: str = ""
    fertilizer_delivery_route: str = "reference"
    tank_capacity_l: float = 5000.0
    fert_tank_capacity_l: float = 500.0
    fert_tank_height_cm: float = 90.0
    tank_height_cm: float = 180.0

    @classmethod
    def load(cls):
        load_env(ROOT / ".env")
        result = cls(host=os.getenv("AI_HOST", "127.0.0.1"), port=int(os.getenv("AI_PORT", "5010")),
                     mode=os.getenv("AI_MODE", "SHADOW_MODE"), state_path=os.getenv("AI_STATE_PATH", "data/shadow.sqlite3"),
                     source_dsn=os.getenv("AI_SOURCE_DSN", ""), state_dsn=os.getenv("AI_STATE_DSN", ""),
                     site_id=os.getenv("AI_SITE_ID", "greenhouse-01"), device_id=os.getenv("AI_DEVICE_ID", "esp32-s3-01"),
                     zone_id=os.getenv("AI_ZONE_ID", "soil-1"), poll_seconds=float(os.getenv("AI_POLL_SECONDS", "300")),
                     poll_enabled=os.getenv("AI_POLL_ENABLED", "false").lower() == "true",
                      hst_bridge_key=os.getenv("AI_HST_BRIDGE_KEY", ""),
                     fertilizer_delivery_route=os.getenv("AI_FERTILIZER_DELIVERY_ROUTE", "reference"),
                     tank_capacity_l=float(os.getenv("AI_TANK_CAPACITY_L", "5000")),
                     tank_height_cm=float(os.getenv("AI_TANK_HEIGHT_CM", "180")),
                     fert_tank_capacity_l=float(os.getenv("AI_FERT_TANK_CAPACITY_L", "500")),
                     fert_tank_height_cm=float(os.getenv("AI_FERT_TANK_HEIGHT_CM", "90")))
        if result.host != "127.0.0.1":
            raise ValueError("local prototype API must bind to 127.0.0.1")
        if not 1 <= result.port <= 65535 or result.poll_seconds < 1:
            raise ValueError("invalid port or polling interval")
        if result.hst_bridge_key and len(result.hst_bridge_key) < 32:
            raise ValueError("AI_HST_BRIDGE_KEY must have at least 32 characters")
        if result.mode not in ("DRY_RUN", "SHADOW_MODE"):
            raise ValueError("ACTIVE is unavailable until the session firmware contract is verified")
        if result.fertilizer_delivery_route not in ("reference", "drip"):
            raise ValueError("AI_FERTILIZER_DELIVERY_ROUTE must be reference or drip")
        if (not math.isfinite(result.tank_capacity_l) or not 0 < result.tank_capacity_l <= 1e7
                or not math.isfinite(result.tank_height_cm) or not 0 < result.tank_height_cm <= 10000
                or not math.isfinite(result.fert_tank_capacity_l) or not 0 < result.fert_tank_capacity_l <= 1e7
                or not math.isfinite(result.fert_tank_height_cm) or not 0 < result.fert_tank_height_cm <= 10000):
            raise ValueError("invalid preview-only tank capacity or height")
        if result.poll_enabled and (not result.source_dsn or not result.state_dsn or result.mode != "SHADOW_MODE"):
            raise ValueError("background shadow polling requires source + PostgreSQL state DSNs and SHADOW_MODE")
        return result


def load_config():
    path = Path(os.getenv("AI_CONFIG", "config/simulation.json"))
    if not path.is_absolute():
        path = ROOT / path
    return Config.model_validate_json(path.read_text(encoding="utf-8-sig"))
