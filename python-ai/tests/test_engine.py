import copy
from datetime import date, datetime, timedelta, timezone
import math
import unittest

from spff_ai.adapters import ExistingFinalSessionAdapter
from spff_ai.config import Settings
from spff_ai.core import (EMA, JAKARTA, decide, due, fresh, fuzzy_water,
                          mass_balance, obligation_id, sensor_ok, fertilizer_dose)
from spff_ai.fuzzy import FuzzyProfile

NOW = datetime(2026, 10, 31, 3, tzinfo=timezone.utc)
DAY = NOW.astimezone(JAKARTA).date()


def recipe():
    return {"recipe_id": "r1", "approval_status": "approved", "planting_date": date(2026, 10, 1),
            "hst_from": 10, "hst_to": 40, "application_mode": "interval",
            "application_interval_days": 5, "target_stock_l": 2.0, "target_water_l": 20.0}


def snapshot():
    values = {"soil_1_moisture": 20, "air_temp": 30, "tank_water_level_pct": 80,
              "tank_fert_level_pct": 70, "flow_water_lpm": 0, "flow_fert_lpm": 0}
    return {"telemetry": {**values, "recorded_at": NOW, "sensor_valid": True,
                          "sensor_health": {k: {"valid": True} for k in values}},
            "status": {"recorded_at": NOW, "online": True, "mode": "automatic"},
            "config": {"desired_mode": "automatic", "applied_mode": "automatic", "revision": 2,
                       "acknowledged_revision": 2, "acknowledgement_status": "applied"},
            "evidence_complete": True, "recipes": []}


def obligation(actual=0, day=DAY):
    return {**mass_balance(2.0, 100, [("s1", actual)]), "obligation_id": "o1",
            "application_day": day, "evidence_known": True,
            "min_water_tank_percent": 30, "min_stock_tank_percent": 25}


class FuzzyTests(unittest.TestCase):
    def test_dry_medium_wet(self):
        self.assertGreater(fuzzy_water(20)["demand_percent"], fuzzy_water(50)["demand_percent"])
        self.assertEqual(fuzzy_water(90)["demand_percent"], 0)

    def test_temperature_not_required(self):
        self.assertEqual(fuzzy_water(50), fuzzy_water(50, None))
        self.assertEqual(fuzzy_water(50, 20), fuzzy_water(50, 35))

    def test_centroid_and_zone_calibration(self):
        self.assertAlmostEqual(fuzzy_water(0)["centroid_percent"], 80)
        profile = FuzzyProfile(full_scale_zone_l=1000, max_zone_l=600, calibration_reference="test only")
        value = fuzzy_water(0, profile=profile)
        self.assertEqual(value["target_water_zone_l"], 600)
        self.assertEqual(value["target_unit"], "L/zone")

    def test_rule_coverage_grid(self):
        for moisture in range(101):
            value = fuzzy_water(moisture)
            self.assertTrue(0 <= value["demand_percent"] <= 100)
            self.assertIsNone(value["target_water_zone_l"])

    def test_invalid(self):
        for value in (None, math.nan, math.inf, -1, 101, True):
            with self.assertRaises(ValueError):
                fuzzy_water(value)

    def test_uncalibrated_legacy_scale_is_refused(self):
        self.assertEqual(fuzzy_water(30)["calibration_status"], "NOT_CALIBRATED")
        self.assertIsNone(fuzzy_water(30)["target_unit"])
        with self.assertRaises(ValueError):
            fuzzy_water(30, 32, 10)

    def test_config_changes_membership_and_overlap_trace(self):
        profile = FuzzyProfile(rules={"LOW": "LOW", "MEDIUM": "OFF", "HIGH": "OFF"})
        self.assertNotEqual(fuzzy_water(30)["demand_percent"], fuzzy_water(30, profile=profile)["demand_percent"])
        trace = fuzzy_water(30)["trace"]
        self.assertGreater(trace["memberships"]["LOW"], 0)
        self.assertGreater(trace["memberships"]["MEDIUM"], 0)
        self.assertEqual(len(trace["aggregate"]), 101)

    def test_no_rule_active_and_invalid_config(self):
        self.assertEqual(fuzzy_water(30, profile=FuzzyProfile(rules={}))["inference_status"], "NO_RULE_ACTIVE")
        for args in ({"full_scale_zone_l": -1}, {"max_zone_l": math.inf},
                     {"moisture": {"LOW": ["left", 50, 20], "MEDIUM": ["triangle", 25,50,75], "HIGH": ["right",50,80]}}):
            with self.assertRaises(ValueError):
                FuzzyProfile(**args)


class EmaTests(unittest.TestCase):
    def test_learns_actual_and_keeps_channels_separate(self):
        water = EMA().observe(10, NOW, .2).observe(20, NOW+timedelta(seconds=1), .2)
        fertilizer = EMA().observe(2, NOW, .2)
        self.assertEqual(water.value, 12)
        self.assertEqual(fertilizer.value, 2)

    def test_replay_out_of_order_and_invalid_do_not_train(self):
        initial = EMA().observe(10, NOW, .2)
        for value, at, valid in ((20, NOW, True), (20, NOW-timedelta(seconds=1), True),
                                 (20, NOW+timedelta(seconds=1), False), (math.nan, NOW, True),
                                 (0, NOW, True), (-1, NOW, True)):
            self.assertEqual(initial.observe(value, at, .2, valid), initial)

    def test_invalid_alpha(self):
        for alpha in (0, -1, 2, math.nan):
            with self.assertRaises(ValueError):
                EMA().observe(10, NOW, alpha)


class BalanceTests(unittest.TestCase):
    def test_replay_is_not_double_counted(self):
        b = mass_balance(2, 100, [("s1", .5), ("s1", .5), ("s2", .25)])
        self.assertEqual(b["remaining_stock_l"], 1.25)
        self.assertEqual(b["remaining_fertilizer_g"], 125)
        self.assertEqual(b["evidence_count"], 2)

    def test_conflict_and_invalid(self):
        for deliveries in ([("s1", .5), ("s1", .6)], [("s1", -1)], [("s1", math.nan)]):
            with self.assertRaises(ValueError):
                mass_balance(2, 100, deliveries)

    def test_excess_never_negative_debt(self):
        b = mass_balance(2, 100, [("s1", 3)])
        self.assertEqual(b["remaining_stock_l"], 0)
        self.assertEqual(b["excess_stock_l"], 1)

    def test_identity_is_stable_and_device_day_scoped(self):
        oid = obligation_id("site", "dev", "recipe", DAY)
        self.assertEqual(oid, obligation_id("site", "dev", "recipe", DAY))
        self.assertNotEqual(oid, obligation_id("site", "other", "recipe", DAY))
        self.assertNotEqual(oid, obligation_id("site", "dev", "recipe", DAY+timedelta(days=1)))


class PriorityTests(unittest.TestCase):
    def test_no_fertilizer_uses_fuzzy(self):
        self.assertEqual(decide(snapshot(), [], NOW)["action"], "NOT_CALIBRATED")

    def test_fertilizer_ignores_wet_soil_and_temperature(self):
        s = snapshot()
        s["telemetry"]["soil_1_moisture"] = 100
        s["telemetry"]["air_temp"] = None
        self.assertEqual(decide(s, [obligation()], NOW)["action"], "SCHEDULED_FERTIGATION")

    def test_same_day_partial_resumes(self):
        d = decide(snapshot(), [obligation(.5)], NOW)
        self.assertEqual(d["action"], "RESUME_FERTIGATION")
        self.assertEqual(d["obligation"]["remaining_stock_l"], 1.5)

    def test_debt_precedes_new_schedule(self):
        new, debt = obligation(), obligation(.5)
        new["obligation_id"], debt["obligation_id"] = "a", "z"
        self.assertEqual(decide(snapshot(), [new, debt], NOW)["obligation"]["obligation_id"], "z")

    def test_manual_precedes_fertilizer(self):
        s = snapshot()
        s["status"]["mode"] = "manual"
        self.assertEqual(decide(s, [obligation()], NOW)["action"], "MANUAL_HOLD")

    def test_waiting_water_then_same_obligation(self):
        s = snapshot()
        o = obligation(.5)
        s["telemetry"]["tank_water_level_pct"] = 10
        self.assertEqual(decide(s, [o], NOW)["action"], "WAITING_FOR_WATER")
        s["telemetry"]["tank_water_level_pct"] = 80
        self.assertEqual(decide(s, [o], NOW)["action"], "RESUME_FERTIGATION")
        self.assertEqual(o["actual_stock_l"], .5)

    def test_revision_unknown_history_and_safety_block(self):
        for mutate, action in ((lambda s: s["config"].update(acknowledged_revision=1), "SAFETY_HOLD"),
                               (lambda s: s.update(evidence_complete=False), "WAITING_FOR_EVIDENCE"),
                               (lambda s: s.update(safety_reasons=["ota"]), "SAFETY_HOLD")):
            s = snapshot()
            mutate(s)
            self.assertEqual(decide(s, [obligation()], NOW)["action"], action)

    def test_unsupported_water_program_blocks_fuzzy(self):
        s = snapshot()
        s["recipes"] = [{**recipe(), "target_stock_l": 0}]
        self.assertEqual(decide(s, [], NOW)["action"], "ADAPTER_HOLD")

    def test_freshness_future_and_health(self):
        for offset in (-121, 1):
            s = snapshot()
            s["telemetry"]["recorded_at"] = NOW+timedelta(seconds=offset)
            self.assertEqual(decide(s, [], NOW)["action"], "SAFETY_HOLD")
        s = snapshot()
        s["telemetry"]["sensor_health"].pop("soil_1_moisture")
        self.assertEqual(decide(s, [], NOW)["action"], "SAFETY_HOLD")

    def test_shadow_invariant(self):
        for obligations in ([], [obligation()], [obligation(.5)]):
            d = decide(snapshot(), obligations, NOW)
            self.assertFalse(d["can_dispatch"])
            self.assertEqual(d["execution_mode"], "SHADOW_MODE")


class ScheduleAdapterTests(unittest.TestCase):
    def test_interval_hst_boundaries_and_once(self):
        r = recipe()
        self.assertTrue(due(r, DAY))  # HST 30, (30-10)%5 == 0
        self.assertFalse(due(r, DAY+timedelta(days=1)))
        self.assertFalse(due(r, date(2026, 10, 5)))
        self.assertFalse(due(r, date(2026, 12, 1)))
        r.update(application_mode="once", application_date=DAY)
        self.assertTrue(due(r, DAY))
        r["approval_status"] = "draft"
        self.assertFalse(due(r, DAY))

    def test_sensor_schedule_not_guessed(self):
        self.assertFalse(due({**recipe(), "application_mode": "sensor"}, DAY))

    def test_final_session_adapter_and_unknown_default(self):
        s = {"session_id": "s1", "recipe_id": "r1", "started_at": NOW,
             "status": "aborted", "pumps_off": True, "actual_stock_l": .5, "actual_water_l": 5}
        evidence, known = ExistingFinalSessionAdapter(True).collect([s], "r1", DAY)
        self.assertFalse(known)  # Date-only attribution was unsafe in Step 2.
        self.assertEqual(evidence, [])
        self.assertFalse(ExistingFinalSessionAdapter().collect([], "r1", DAY)[1])
        self.assertFalse(ExistingFinalSessionAdapter(True).collect([{**s, "actual_stock_l": None}], "r1", DAY)[1])

    def test_active_mode_configuration_rejected(self):
        with self.assertRaises(ValueError):
            Settings("dsn", "site", "dev", execution_mode="ACTIVE")


if __name__ == "__main__":
    unittest.main()
