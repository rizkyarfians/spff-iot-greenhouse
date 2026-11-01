"""Read-only planning calculations must not turn simulation or history into dispatch."""
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.flow_reference import observed_flow_reference
from app.planning_preview import activity_planning_preview
from app.dashboard_summary import present_shadow_dashboard
from test_dashboard_summary import NOW, decision


def sample(seconds, water, stock, valid=True):
    return {
        "recorded_at": datetime(2026, 11, 1, 6, 14, 41, tzinfo=timezone.utc) + timedelta(seconds=seconds),
        "flow_water_total_l": Decimal(str(water)),
        "flow_fert_total_l": Decimal(str(stock)),
        "sensor_health": {
            "flow_water_total_l": {"valid": valid},
            "flow_fert_total_l": {"valid": valid},
        },
    }


class PlanningPreviewTests(unittest.TestCase):
    def test_real_historical_counters_without_unsafe_calibration_claim(self):
        rows = [
            sample(0, 0, 0),
            sample(35, 39, 1.516),
            sample(65, 197.917, 8.06),
            sample(96, 365.5, 15.436),
            sample(127, 436.417, 19.916),
            sample(157, 508.667, 23.009),
            sample(187, 508.667, 23.009),
        ]
        flow = observed_flow_reference(list(reversed(rows)))
        self.assertIsNotNone(flow)
        self.assertEqual(flow["basis"], "UNVERIFIED_HISTORICAL_COUNTER_DELTAS")
        self.assertAlmostEqual(flow["water_lpm"], 508.667 * 60 / 157, places=5)
        self.assertAlmostEqual(flow["stock_lpm"], 23.009 * 60 / 157, places=5)
        self.assertEqual(flow["interval_count"], 5)

    def test_reset_invalid_or_gap_is_not_bridged(self):
        rows = [
            sample(0, 0, 0),
            sample(30, 100, 5),
            sample(60, 200, 10),
            sample(90, 0, 0),
            sample(120, 80, 4),
            sample(150, 170, 8),
            sample(180, 250, 11),
        ]
        # The first two intervals cannot be concatenated through the reset.
        flow = observed_flow_reference(rows)
        self.assertIsNotNone(flow)
        self.assertEqual(flow["interval_count"], 3)
        self.assertAlmostEqual(flow["water_delta_l"], 250)

        bad = [sample(0, 0, 0), sample(30, 100, 5), sample(60, 200, 10),
               sample(90, 300, 15, valid=False), sample(120, 400, 20)]
        self.assertIsNone(observed_flow_reference(bad))

    def test_stock_requires_explicit_concentration(self):
        activity = {
            "reference_water_l": 100,
            "products": [{"is_fertilizer": True, "product_mass_g": 50000,
                          "review_reasons": []}],
        }
        flow = {
            "basis": "UNVERIFIED_HISTORICAL_COUNTER_DELTAS",
            "water_lpm": 194.39, "stock_lpm": 8.79,
        }
        without = activity_planning_preview(activity, flow)
        self.assertEqual(without["water_l"], 100)
        self.assertEqual(without["fertilizer_mass_g"], 50000)
        self.assertIsNone(without["stock_l"])
        self.assertIsNone(without["stock_concentration_g_l"])
        self.assertFalse(without["can_dispatch"])
        with_input = activity_planning_preview(activity, flow, 100)
        self.assertAlmostEqual(with_input["stock_l"], 500)
        self.assertAlmostEqual(with_input["water_duration_minutes"], 100 / 194.39)
        self.assertAlmostEqual(with_input["stock_duration_minutes"], 500 / 8.79)

    def test_multi_fertilizer_is_not_summed_or_assumed_safe(self):
        activity = {"reference_water_l": 100, "products": [
            {"is_fertilizer": True, "product_mass_g": 5000},
            {"is_fertilizer": True, "product_mass_g": 3000},
        ]}
        result = activity_planning_preview(activity, None, 100)
        self.assertIsNone(result["fertilizer_mass_g"])
        self.assertIsNone(result["stock_l"])
        self.assertIn("multiple_fertilizers_not_combined", result["reasons"])

    def test_dashboard_keeps_operational_plan_separate(self):
        row = decision()
        row["input_snapshot"]["historical_flow_reference"] = {
            "basis": "UNVERIFIED_HISTORICAL_COUNTER_DELTAS",
            "water_lpm": 194.39, "stock_lpm": 8.79,
            "water_delta_l": 508.667, "stock_delta_l": 23.009,
            "duration_seconds": 157, "interval_count": 5,
            "started_at": "2026-11-01T06:14:41+00:00",
            "ended_at": "2026-11-01T06:17:18+00:00",
        }
        dashboard = present_shadow_dashboard([row], NOW, stock_concentration_g_l=100)
        guide = dashboard["programs"][0]["activities"][0]["planning_preview"]
        self.assertEqual(guide["water_l"], 100)
        self.assertEqual(guide["fertilizer_mass_g"], 50000)
        self.assertEqual(guide["stock_l"], 500)
        self.assertIsNone(dashboard["calculation"]["water_l"])
        self.assertEqual(dashboard["decision"]["type"], "HOLD")
        self.assertFalse(dashboard["can_dispatch"])


if __name__ == "__main__":
    unittest.main()
