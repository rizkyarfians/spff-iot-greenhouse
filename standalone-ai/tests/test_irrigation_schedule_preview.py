"""Two-day SHADOW deferral is an illustration only; no scheduling or actuator rights."""
import unittest
from datetime import datetime, timedelta, timezone

from app.irrigation_schedule_preview import illustrate_two_day_irrigation
from app.tank_preview import estimate_water_tank
from app.dashboard_summary import present_shadow_dashboard
from app.models import Config
from test_dashboard_summary import NOW, decision


class TwoDayDeferralTests(unittest.TestCase):
    def setUp(self):
        self.sample = {
            "tank_water_distance_cm": 159.1,
            "tank_water_level_pct": 88.4,
            "sensor_health": {
                "tank_water_distance_cm": {"valid": True},
                "tank_water_level_pct": {"valid": True},
            },
        }

    def preview(self, **kwargs):
        return illustrate_two_day_irrigation(
            self.sample, now=NOW, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15, **kwargs)

    def test_top_down_preview_defers_shortfall_to_tomorrow(self):
        result = self.preview()
        self.assertEqual(result["status"], "GEOMETRY_ONLY")
        self.assertAlmostEqual(result["illustrative_available_l"], 209)
        self.assertAlmostEqual(result["today_absolute_max_l"], 209)
        self.assertAlmostEqual(result["tomorrow_at_least_l"], 165.15)
        self.assertIsNone(result["reserve_l"])
        self.assertFalse(result["is_firm_schedule"])
        self.assertFalse(result["can_dispatch"])

    def test_percent_conflicting_with_top_down_distance_cannot_become_volume(self):
        tank = estimate_water_tank(
            self.sample, capacity_l=1800, height_cm=180,
            source_current=True, source_read_only=True,
            fuzzy_water_l=374.15,
        )
        self.assertEqual(tank["level_status"], "ORIENTATION_CONFLICT")
        self.assertIsNone(tank["estimated_available_l"])
        self.assertIsNone(tank["theoretical_balance_l"])
        self.assertEqual(tank["reported_level_pct"], 88.4)

    def test_stale_and_missing_input_never_create_today_or_tomorrow_plan(self):
        for current, source, target in (
            (False, True, 374.15),
            (True, False, 374.15),
            (True, True, None),
        ):
            result = illustrate_two_day_irrigation(
                self.sample, now=NOW, source_current=current,
                source_read_only=source, fuzzy_water_l=target,
            )
            self.assertNotEqual(result["status"], "GEOMETRY_ONLY")
            self.assertIsNone(result["today_absolute_max_l"])
            self.assertIsNone(result["tomorrow_at_least_l"])
            self.assertFalse(result["can_dispatch"])

    def test_invalid_or_absent_distance_is_not_inferred_from_percent(self):
        for distance, valid in ((None, True), (159.1, False),
                                (200, True), (-1, True)):
            sample = {
                **self.sample,
                "tank_water_distance_cm": distance,
                "sensor_health": {
                    **self.sample["sensor_health"],
                    "tank_water_distance_cm": {"valid": valid},
                },
            }
            result = illustrate_two_day_irrigation(
                sample, now=NOW, source_current=True,
                source_read_only=True, fuzzy_water_l=374.15,
            )
            self.assertIsNone(result["illustrative_available_l"])
            self.assertIsNone(result["today_absolute_max_l"])
            self.assertIsNone(result["tomorrow_at_least_l"])

    def test_ample_water_leaves_no_unallocated_volume(self):
        sample = {
            **self.sample,
            "tank_water_distance_cm": 10,
        }
        result = illustrate_two_day_irrigation(
            sample, now=NOW, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15,
        )
        self.assertEqual(result["today_absolute_max_l"], 374.15)
        self.assertEqual(result["tomorrow_at_least_l"], 0)
        self.assertFalse(result["is_firm_schedule"])

    def test_calendar_uses_jakarta_midnight_not_utc(self):
        before = self.preview_at(datetime(2026, 11, 1, 16, 59, tzinfo=timezone.utc))
        after = self.preview_at(datetime(2026, 11, 1, 17, 1, tzinfo=timezone.utc))
        self.assertEqual(before["today_date"], "2026-11-01")
        self.assertEqual(before["tomorrow_date"], "2026-11-02")
        self.assertEqual(after["today_date"], "2026-11-02")
        self.assertEqual(after["tomorrow_date"], "2026-11-03")

    def preview_at(self, now):
        return illustrate_two_day_irrigation(
            self.sample, now=now, source_current=True,
            source_read_only=True, fuzzy_water_l=374.15)

    def test_dashboard_integrates_source_only_without_dispatch(self):
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
        plan = result["irrigation_schedule_preview"]
        self.assertEqual(result["tank_preview"]["level_status"], "ORIENTATION_CONFLICT")
        self.assertEqual(plan["status"], "GEOMETRY_ONLY")
        self.assertAlmostEqual(plan["today_absolute_max_l"], 209)
        self.assertGreater(plan["tomorrow_at_least_l"], 0)
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
