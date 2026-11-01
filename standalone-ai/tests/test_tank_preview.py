"""Tank volume previews must never turn unverified level into liters or pump commands."""
import unittest
from decimal import Decimal

from app.tank_preview import estimate_water_tank
from app.dashboard_summary import present_shadow_dashboard
from test_dashboard_summary import NOW, decision


class TankPreviewTests(unittest.TestCase):
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
            {"tank_water_level_pct": 10,
             "sensor_health": {"tank_water_level_pct": {"valid": True}}},
            source_current=True, source_read_only=True, fuzzy_water_l=378.61,
        )
        self.assertEqual(result["estimated_available_l"], 180)
        self.assertAlmostEqual(result["theoretical_balance_l"], -198.61)
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
