"""SHADOW two-day preview uses worker-provided LIQUID HEIGHT, not raw range."""
import unittest
from datetime import datetime, timedelta, timezone

from app.irrigation_schedule_preview import illustrate_two_day_irrigation
from app.tank_preview import estimate_water_tank
from app.dashboard_summary import present_shadow_dashboard
from app.models import Config
from test_dashboard_summary import NOW, decision


class TwoDayDeferralTests(unittest.TestCase):
    def setUp(self):
        # Worker code: 159.8cm is liquid height from bottom (88.8%), even
        # though the physical ultrasonic transducer is mounted at the top.
        self.sample = {
            "tank_water_distance_cm": 159.8,
            "tank_water_level_pct": 88.8,
            "sensor_health": {
                "tank_water_distance_cm": {"valid": True},
                "tank_water_level_pct": {"valid": True},
            },
        }

    def preview(self, **kwargs):
        return illustrate_two_day_irrigation(
            self.sample, now=NOW, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15, **kwargs)

    def test_worker_liquid_height_is_not_inverted(self):
        result = self.preview()
        self.assertEqual(result["status"], "GEOMETRY_ONLY")
        self.assertEqual(result["basis"], "REPORTED_LIQUID_HEIGHT_UNCALIBRATED")
        self.assertAlmostEqual(result["illustrative_available_l"], 1598)
        self.assertAlmostEqual(result["today_absolute_max_l"], 374.15)
        self.assertEqual(result["tomorrow_at_least_l"], 0)
        self.assertEqual(result["reported_liquid_height_cm"], 159.8)
        self.assertIsNone(result["reserve_l"])
        self.assertFalse(result["is_firm_schedule"])
        self.assertFalse(result["can_dispatch"])

    def test_low_liquid_height_has_carryover_not_a_firm_schedule(self):
        sample = {**self.sample, "tank_water_distance_cm": 20.2,
                  "tank_water_level_pct": 11.2}
        result = illustrate_two_day_irrigation(
            sample, now=NOW, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15)
        self.assertAlmostEqual(result["illustrative_available_l"], 202)
        self.assertAlmostEqual(result["today_absolute_max_l"], 202)
        self.assertAlmostEqual(result["tomorrow_at_least_l"], 172.15)
        self.assertFalse(result["is_firm_schedule"])

    def test_height_percent_conflict_blocks_volume(self):
        sample = {**self.sample, "tank_water_level_pct": 11.2}
        tank = estimate_water_tank(sample, source_current=True,
                                   source_read_only=True, fuzzy_water_l=374.15)
        self.assertEqual(tank["level_status"], "ORIENTATION_CONFLICT")
        self.assertIsNone(tank["estimated_available_l"])
        plan = illustrate_two_day_irrigation(
            sample, now=NOW, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15)
        self.assertEqual(plan["status"], "LEVEL_CONFLICT")
        self.assertIsNone(plan["today_absolute_max_l"])

    def test_matching_height_percent_preserves_tank_volume(self):
        tank = estimate_water_tank(self.sample, source_current=True,
                                   source_read_only=True, fuzzy_water_l=374.15)
        self.assertEqual(tank["level_status"], "ESTIMATED")
        self.assertAlmostEqual(tank["estimated_available_l"], 1598)
        self.assertGreater(tank["theoretical_balance_l"], 0)

    def test_stale_missing_invalid_prevent_any_plan(self):
        for current, source, target in (
            (False, True, 374.15),
            (True, False, 374.15),
            (True, True, None),
        ):
            result = illustrate_two_day_irrigation(
                self.sample, now=NOW, source_current=current,
                source_read_only=source, fuzzy_water_l=target)
            self.assertNotEqual(result["status"], "GEOMETRY_ONLY")
            self.assertIsNone(result["today_absolute_max_l"])
            self.assertIsNone(result["tomorrow_at_least_l"])

        for h, valid in ((None, True), (159.8, False),
                         (200, True), (-1, True)):
            sample = {**self.sample, "tank_water_distance_cm": h,
                      "sensor_health": {
                          **self.sample["sensor_health"],
                          "tank_water_distance_cm": {"valid": valid},
                      }}
            result = illustrate_two_day_irrigation(
                sample, now=NOW, source_current=True,
                source_read_only=True, fuzzy_water_l=374.15)
            self.assertNotEqual(result["status"], "GEOMETRY_ONLY")
            self.assertIsNone(result["today_absolute_max_l"])

    def test_jakarta_midnight(self):
        before = self.preview_at(datetime(2026, 11, 1, 16, 59, tzinfo=timezone.utc))
        after = self.preview_at(datetime(2026, 11, 1, 17, 1, tzinfo=timezone.utc))
        self.assertEqual(before["today_date"], "2026-11-01")
        self.assertEqual(after["today_date"], "2026-11-02")

    def preview_at(self, now):
        return illustrate_two_day_irrigation(
            self.sample, now=now, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15)

    def test_dashboard_preserves_hold(self):
        row = decision()
        source = {
            **row["input_snapshot"],
            "schema_compatible": True,
            "telemetry": {
                **self.sample,
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
                "soil_2_moisture": 27.6,
                "sensor_health": {
                    **self.sample["sensor_health"],
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
            [row], NOW, Config(), planning_observation=source)
        self.assertEqual(result["tank_preview"]["level_status"], "ESTIMATED")
        plan = result["irrigation_schedule_preview"]
        self.assertEqual(plan["status"], "GEOMETRY_ONLY")
        self.assertAlmostEqual(plan["today_absolute_max_l"], plan["fuzzy_demand_l"])
        self.assertEqual(plan["tomorrow_at_least_l"], 0)
        self.assertFalse(plan["can_dispatch"])
        self.assertFalse(result["can_dispatch"])
        self.assertEqual(result["decision"]["type"], "HOLD")

        source["telemetry"]["received_at"] = (NOW-timedelta(minutes=5)).isoformat()
        stale = present_shadow_dashboard(
            [row], NOW, Config(), planning_observation=source)
        self.assertEqual(stale["irrigation_schedule_preview"]["status"], "SOURCE_UNAVAILABLE")
        self.assertIsNone(stale["irrigation_schedule_preview"]["today_absolute_max_l"])


if __name__ == "__main__":
    unittest.main()
