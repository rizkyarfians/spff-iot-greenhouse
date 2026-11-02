"""Tank volume previews must never turn unverified level into liters or pump commands."""
import unittest
from decimal import Decimal
from datetime import timedelta

from app.tank_preview import estimate_water_tank, estimate_fertilizer_tank
from app.dashboard_summary import present_shadow_dashboard
from app.models import Config
from app.settings import Settings
from test_dashboard_summary import NOW, decision


class TankPreviewTests(unittest.TestCase):
    def test_updated_nominal_capacity_defaults_do_not_change_worker_heights(self):
        settings = Settings()
        self.assertEqual(settings.tank_capacity_l, 5000)
        self.assertEqual(settings.fert_tank_capacity_l, 500)
        # These are existing MQTT Worker reference heights, not field calibration.
        self.assertEqual(settings.tank_height_cm, 180)
        self.assertEqual(settings.fert_tank_height_cm, 90)

    def test_verified_fresh_sensor_estimates_volume_and_compares_fuzzy(self):
        result = estimate_water_tank(
            {"tank_water_level_pct": 50,
             "sensor_health": {"tank_water_level_pct": {"valid": True}}},
            capacity_l=1800, height_cm=180,
            source_current=True, source_read_only=True,
            fuzzy_water_l=Decimal("378.61"),
        )
        self.assertEqual(result["level_status"], "ESTIMATED")
        self.assertEqual(result["reported_level_pct"], 50)
        self.assertEqual(result["estimated_water_height_cm"], 90)
        self.assertEqual(result["estimated_available_l"], 900)
        self.assertAlmostEqual(result["theoretical_balance_l"], 521.39)
        self.assertEqual(result["comparison_status"], "ENOUGH_ESTIMATE")
        self.assertFalse(result["can_dispatch"])

    def test_insufficient_is_only_a_theoretical_comparison(self):
        result = estimate_water_tank(
            {"tank_water_level_pct": 5,
             "sensor_health": {"tank_water_level_pct": {"valid": True}}},
            source_current=True, source_read_only=True, fuzzy_water_l=378.61,
        )
        self.assertEqual(result["estimated_available_l"], 250)
        self.assertAlmostEqual(result["theoretical_balance_l"], -128.61)
        self.assertEqual(result["comparison_status"], "BELOW_ESTIMATE")
        self.assertFalse(result["can_dispatch"])

    def test_stale_or_non_source_does_not_reuse_old_level_as_water_available(self):
        sample = {"tank_water_level_pct": 90,
                  "sensor_health": {"tank_water_level_pct": {"valid": True}}}
        for fresh, source, expected in (
            (False, True, "STALE"),
            (True, False, "NO_DATA"),
        ):
            result = estimate_water_tank(sample, source_current=fresh,
                                         source_read_only=source,
                                         fuzzy_water_l=378.61)
            self.assertEqual(result["level_status"], expected)
            self.assertIsNone(result["estimated_available_l"])
            self.assertIsNone(result["theoretical_balance_l"])
            self.assertEqual(result["comparison_status"], "NOT_COMPARABLE")

    def test_unverified_or_invalid_sensor_never_generates_liters(self):
        for sample, status in (
            ({"tank_water_level_pct": 90}, "UNVERIFIED"),
            ({"tank_water_level_pct": 90,
              "sensor_health": {"tank_water_level_pct": {"valid": False}}}, "UNVERIFIED"),
            ({"tank_water_level_pct": 120,
              "sensor_health": {"tank_water_level_pct": {"valid": True}}}, "OUT_OF_RANGE"),
            ({"tank_water_level_pct": None}, "NO_DATA"),
        ):
            result = estimate_water_tank(sample, source_current=True,
                                         source_read_only=True,
                                         fuzzy_water_l=378.61)
            self.assertEqual(result["level_status"], status)
            self.assertIsNone(result["estimated_available_l"])
            self.assertIsNone(result["estimated_water_height_cm"])
            self.assertIsNone(result["theoretical_balance_l"])

    def test_zero_valid_level_is_not_mistaken_for_missing(self):
        result = estimate_water_tank(
            {"tank_water_level_pct": 0,
             "sensor_health": {"tank_water_level_pct": {"valid": True}}},
            source_current=True, source_read_only=True,
            fuzzy_water_l=100,
        )
        self.assertEqual(result["estimated_available_l"], 0)
        self.assertEqual(result["level_status"], "ESTIMATED")
        self.assertEqual(result["comparison_status"], "BELOW_ESTIMATE")

    def test_dashboard_compares_real_fuzzy_simulation_to_validated_tank(self):
        row = decision()
        obs = {
            **row["input_snapshot"],
            "schema_compatible": True,
            "telemetry": {
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
                "tank_water_level_pct": 5,
                "soil_2_moisture": 27.6,
                "sensor_health": {
                    "tank_water_level_pct": {"valid": True},
                    "soil_2_moisture": {
                        "valid": True, "controlValid": True, "raw": 276,
                        "rawAgeMs": 1000, "rawFresh": True,
                        "lastPollOk": True, "pollBootId": "boot-1",
                    },
                },
            },
            "automatic_control": {
                "water_sensor_key": "soil_2_moisture",
                "revision": 108, "acknowledged_revision": 108,
                "acknowledgement_status": "applied",
            },
        }
        result = present_shadow_dashboard(
            [row], NOW, Config(), planning_observation=obs)
        tank = result["tank_preview"]
        self.assertIsNotNone(result["fuzzy_preview"])
        self.assertEqual(tank["estimated_available_l"], 250)
        self.assertEqual(tank["fuzzy_demand_l"], result["fuzzy_preview"]["illustrative_water_l"])
        self.assertEqual(tank["comparison_status"], "BELOW_ESTIMATE")
        self.assertFalse(result["can_dispatch"])

        obs["telemetry"]["received_at"] = (NOW-timedelta(minutes=5)).isoformat()
        stale = present_shadow_dashboard(
            [row], NOW, Config(), planning_observation=obs)
        self.assertEqual(stale["tank_preview"]["level_status"], "STALE")
        self.assertIsNone(stale["tank_preview"]["estimated_available_l"])
        self.assertIsNone(stale["fuzzy_preview"])

    def test_fertilizer_tank_estimates_inventory_not_dose(self):
        sample = {
            "tank_fert_distance_cm": 23.4,
            "tank_fert_level_pct": 26.0,
            "sensor_health": {
                "tank_fert_distance_cm": {"valid": True},
                "tank_fert_level_pct": {"valid": True},
            },
        }
        result = estimate_fertilizer_tank(
            sample, source_current=True, source_read_only=True)
        self.assertEqual(result["level_status"], "ESTIMATED")
        self.assertEqual(result["capacity_l"], 500)
        self.assertEqual(result["tank_height_cm"], 90)
        self.assertAlmostEqual(result["estimated_liquid_volume_l"], 130)
        self.assertAlmostEqual(result["estimated_liquid_height_cm"], 23.4)
        self.assertNotIn("fuzzy_demand_l", result)
        self.assertNotIn("fertilizer_mass_g", result)
        self.assertFalse(result["can_dispatch"])

    def test_fertilizer_tank_unverified_or_stale_is_not_inventory(self):
        original = {
            "tank_fert_distance_cm": 23.4,
            "tank_fert_level_pct": 26.0,
            "sensor_health": {
                "tank_fert_distance_cm": {"valid": True},
                "tank_fert_level_pct": {"valid": True},
            },
        }
        for sample, fresh, source, expected in (
            (original, False, True, "STALE"),
            (original, True, False, "NO_DATA"),
            ({**original, "tank_fert_level_pct": 90}, True, True, "ORIENTATION_CONFLICT"),
            ({**original, "tank_fert_distance_cm": 100}, True, True, "OUT_OF_RANGE"),
            ({**original, "sensor_health": {}}, True, True, "UNVERIFIED"),
            ({**original, "tank_fert_level_pct": None}, True, True, "NO_DATA"),
        ):
            with self.subTest(expected=expected):
                result = estimate_fertilizer_tank(
                    sample, source_current=fresh, source_read_only=source)
                self.assertEqual(result["level_status"], expected)
                self.assertIsNone(result["estimated_liquid_volume_l"])

    def test_dashboard_exposes_separate_nominal_tanks(self):
        row = decision()
        obs = {
            **row["input_snapshot"],
            "schema_compatible": True,
            "telemetry": {
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
                "tank_water_distance_cm": 90.0,
                "tank_water_level_pct": 50.0,
                "tank_fert_distance_cm": 23.4,
                "tank_fert_level_pct": 26.0,
                "sensor_health": {
                    "tank_water_distance_cm": {"valid": True},
                    "tank_water_level_pct": {"valid": True},
                    "tank_fert_distance_cm": {"valid": True},
                    "tank_fert_level_pct": {"valid": True},
                },
            },
        }
        result = present_shadow_dashboard([row], NOW, planning_observation=obs)
        self.assertEqual(result["tank_preview"]["capacity_l"], 5000)
        self.assertEqual(result["tank_preview"]["estimated_available_l"], 2500)
        self.assertEqual(result["fertilizer_tank_preview"]["capacity_l"], 500)
        self.assertEqual(result["fertilizer_tank_preview"]["estimated_liquid_volume_l"], 130)
        self.assertFalse(result["can_dispatch"])

    def test_invalid_dimensions_rejected(self):
        for bad in (0, -2, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                estimate_water_tank({}, capacity_l=bad)
            with self.assertRaises(ValueError):
                estimate_water_tank({}, height_cm=bad)

    def test_dashboard_tank_is_independent_of_historical_decision(self):
        row = decision()
        obs = {
            **row["input_snapshot"],
            "schema_compatible": True,
            "telemetry": {
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
                "tank_water_level_pct": 50,
                "sensor_health": {"tank_water_level_pct": {"valid": True}},
            },
        }
        result = present_shadow_dashboard(
            [row], NOW, planning_observation=obs,
            tank_capacity_l=1800, tank_height_cm=180,
        )
        self.assertEqual(result["tank_preview"]["estimated_available_l"], 900)
        self.assertIsNone(result["tank_preview"]["fuzzy_demand_l"])
        self.assertIsNone(result["tank_preview"]["theoretical_balance_l"])
        self.assertFalse(result["can_dispatch"])
        self.assertFalse(result["tank_preview"]["can_dispatch"])
        self.assertEqual(result["decision"]["type"], "HOLD")


if __name__ == "__main__":
    unittest.main()
