import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.calculations import fuzzy_volume, membership, occurrences, tank_liters
from app.engine import Engine
from app.models import Config
from app.scenarios import final_feedback, program, run_scenario, sample
from app.store import SQLiteStore


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.c = Config()
        self.store = SQLiteStore()
        self.engine = Engine(self.store, self.c, simulator=True)
        self.now = datetime(2026, 10, 11, 1, tzinfo=timezone.utc)
        self.p = program()

    def tearDown(self):
        self.store.close()

    def evaluate(self, **changes):
        return self.engine.evaluate(sample(self.now, **changes), [self.p], self.now)

    def start(self):
        d = self.evaluate()
        return self.engine.start_mock(d["decision_id"], self.now)

    def pause(self):
        session = self.start()
        end = self.now + timedelta(minutes=20)
        result = self.engine.feedback_mock(final_feedback(session, end, reason="water_low", fraction=0.5))
        return session, end, result

    def test_01_hst1_dry_soil_fuzzy(self):
        d = self.engine.evaluate(sample(self.now), [], self.now)
        self.assertEqual(d["type"], "IRRIGATE")
        self.assertEqual(d["plan"]["stock_l"], 0)

    def test_02_wet_soil_off(self):
        self.assertEqual(self.engine.evaluate(sample(self.now, moisture=95), [], self.now)["type"], "OFF")

    def test_03_rain_does_not_cancel_fertilizer(self):
        self.assertEqual(self.evaluate(rain=True, moisture=95)["type"], "FERTIGATE")

    def test_04_session_water_precedes_injection(self):
        session = self.start()
        self.assertEqual(session["stages"], ["PRIMING", "WATER_FLOW_VERIFIED", "INJECTING"])
        self.assertGreater(session["plan"]["water_l"], session["plan"]["flush_reserve_l"])

    def test_05_water_low_prevents_start(self):
        d = self.evaluate(water_percent=4)
        self.assertEqual(d["type"], "HOLD")
        self.assertEqual(len(self.store.read()["sessions"]), 0)

    def test_06_partial_dose_waits_for_water(self):
        _, _, result = self.pause()
        self.assertEqual(result["obligation"]["status"], "WAITING_FOR_WATER")
        self.assertGreater(result["obligation"]["delivered_g"], 0)
        self.assertLess(result["obligation"]["delivered_g"], 5000)

    def test_07_same_day_refill_requires_stability(self):
        _, end, _ = self.pause()
        when = end + timedelta(seconds=61)
        d = self.engine.evaluate(sample(when), [self.p], when)
        self.assertEqual(d["reason"], "waiting_for_stable_refill")
        when += timedelta(seconds=31)
        d = self.engine.evaluate(sample(when), [self.p], when)
        self.assertEqual(d["type"], "FERTIGATE")

    def test_08_next_day_refill_continues_same_obligation(self):
        _, end, _ = self.pause()
        when = end + timedelta(days=1)
        self.engine.evaluate(sample(when), [self.p], when)
        when += timedelta(seconds=31)
        self.assertEqual(self.engine.evaluate(sample(when), [self.p], when)["type"], "FERTIGATE")
        self.assertEqual(len(self.store.read()["obligations"]), 1)

    def test_09_no_refill_waits(self):
        _, end, _ = self.pause()
        self.assertEqual(self.engine.evaluate(sample(end, water_percent=4), [self.p], end)["type"], "HOLD")

    def test_10_valid_mass_balance_completes(self):
        result = run_scenario("complete")
        o = next(iter(result["state"]["obligations"].values()))
        self.assertEqual(o["status"], "COMPLETED")
        self.assertAlmostEqual(o["delivered_g"], 5000, places=6)

    def test_11_after_completion_returns_to_fuzzy(self):
        result = run_scenario("complete")
        self.assertEqual(result["events"][-1]["type"], "OFF")

    def test_12_manual_latches_review(self):
        self.pause()
        when = self.now + timedelta(minutes=30)
        self.engine.evaluate(sample(when, mode="manual"), [self.p], when)
        when += timedelta(minutes=1)
        self.assertEqual(self.engine.evaluate(sample(when), [self.p], when)["reason"], "outstanding_obligation_requires_review")

    def test_13_emergency_stop_no_start(self):
        self.assertEqual(self.evaluate(emergency_stop=True)["reason"], "emergency_stop")

    def test_14_invalid_jsn_blocks_resume(self):
        _, end, _ = self.pause()
        self.assertEqual(self.engine.evaluate(sample(end, water_valid=False), [self.p], end)["reason"], "invalid_water_sensor_or_flow")

    def test_15_invalid_flow_never_claims_dose(self):
        session = self.start()
        f = final_feedback(session, self.now + timedelta(minutes=30)).model_copy(update={"measurement_valid": False})
        result = self.engine.feedback_mock(f)
        self.assertEqual(result["obligation"]["delivered_g"], 0)
        self.assertEqual(result["obligation"]["status"], "REQUIRES_REVIEW")
        self.assertEqual(self.store.read()["ema_history"], [])

    def test_16_restart_does_not_duplicate_obligation_or_session(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            path = str(Path(folder) / "restart.sqlite3")
            a = SQLiteStore(path)
            e = Engine(a, self.c, simulator=True)
            d = e.evaluate(sample(self.now), [self.p], self.now)
            session = e.start_mock(d["decision_id"], self.now)
            a.close()
            b = SQLiteStore(path)
            try:
                e = Engine(b, self.c, simulator=True)
                d = e.evaluate(sample(self.now), [self.p], self.now)
                self.assertEqual(d["type"], "HOLD")
                self.assertEqual(len(b.read()["obligations"]), 1)
                self.assertEqual(len(b.read()["sessions"]), 1)
                self.assertIn(session["session_id"], b.read()["sessions"])
            finally:
                b.close()

    def test_17_esp_restart_requires_reconciliation(self):
        self.pause()
        when = self.now + timedelta(minutes=30)
        self.assertEqual(self.engine.evaluate(sample(when, execution_known=False), [self.p], when)["reason"], "execution_unreconciled")

    def test_18_duplicate_feedback_no_double_dose_or_ema(self):
        session = self.start()
        f = final_feedback(session, self.now + timedelta(minutes=30), reason="water_low", fraction=0.5)
        first = self.engine.feedback_mock(f)
        before = self.store.read()
        self.assertEqual(self.engine.feedback_mock(f), first)
        self.assertEqual(self.store.read(), before)

    def test_19_next_schedule_queues_without_merge(self):
        p2 = self.p.model_copy(update={"program_id": "new-program"})
        d = self.engine.evaluate(sample(self.now), [self.p, p2], self.now)
        self.assertEqual(d["conflict_policy"], "oldest_due_first_no_merge")
        self.assertEqual(len(d["queued_obligations"]), 1)
        self.assertEqual(len(self.store.read()["obligations"]), 2)
        self.assertEqual(d["remaining_g"], 5000)

    def test_20_infeasible_water_budget_held(self):
        c = self.c.model_copy(update={"minimum_stock_session_l": 200})
        engine = Engine(self.store, c, simulator=True)
        d = engine.evaluate(sample(self.now), [self.p], self.now)
        self.assertEqual(d["reason"], "no_feasible_session_within_water_stock_time_limits")

    def test_stale_sensor(self):
        self.assertEqual(self.engine.evaluate(sample(self.now), [], self.now + timedelta(minutes=5))["type"], "HOLD")

    def test_shadow_never_reserves_mock_pumps(self):
        engine = Engine(self.store, self.c)
        d = engine.evaluate(sample(self.now), [self.p], self.now)
        self.assertFalse(d["can_dispatch"])
        with self.assertRaises(ValueError):
            engine.start_mock(d["decision_id"], self.now)

    def test_dry_run_does_not_persist(self):
        engine = Engine(self.store, self.c, mode="DRY_RUN")
        before = self.store.read()
        result = engine.evaluate(sample(self.now), [self.p], self.now)
        self.assertEqual(result["type"], "FERTIGATE")
        self.assertEqual(result["mode"], "DRY_RUN")
        self.assertEqual(self.store.read(), before)

    def test_active_rejected(self):
        with self.assertRaises(ValueError):
            Engine(self.store, self.c, mode="ACTIVE")

    def test_conflicting_feedback_rejected(self):
        session = self.start()
        f = final_feedback(session, self.now + timedelta(minutes=30))
        self.engine.feedback_mock(f)
        with self.assertRaises(ValueError):
            self.engine.feedback_mock(f.model_copy(update={"actual_stock_l": 1}))

    def test_two_concurrent_workers_reserve_once(self):
        d = self.evaluate()
        with ThreadPoolExecutor(max_workers=2) as executor:
            sessions = list(executor.map(lambda _: self.engine.start_mock(d["decision_id"], self.now), range(2)))
        self.assertEqual(sessions[0]["session_id"], sessions[1]["session_id"])
        self.assertEqual(len(self.store.read()["sessions"]), 1)

    def test_invalid_config_rejected(self):
        with self.assertRaises(ValueError):
            Config(water_level_start_threshold=2)
        with self.assertRaises(ValueError):
            Config(alpha=float("nan"))

    def test_program_edit_requires_review(self):
        self.evaluate()
        edited = self.p.model_copy(update={"revision": 2, "target_stock_l": 300})
        d = self.engine.evaluate(sample(self.now), [edited], self.now)
        self.assertEqual(d["reason"], "outstanding_obligation_requires_review")

    def test_sensor_program_not_silently_made_daily(self):
        sensor = self.p.model_copy(update={"application_mode": "sensor"})
        self.assertEqual(self.engine.evaluate(sample(self.now), [sensor], self.now)["reason"], "sensor_schedule_needs_explicit_calendar_policy")

    def test_hysteresis_drops_stability(self):
        _, end, _ = self.pause()
        end += timedelta(minutes=1)
        self.engine.evaluate(sample(end), [self.p], end)
        end += timedelta(seconds=20)
        self.engine.evaluate(sample(end, water_percent=29), [self.p], end)
        end += timedelta(seconds=20)
        self.assertEqual(self.engine.evaluate(sample(end), [self.p], end)["reason"], "waiting_for_stable_refill")

    def test_old_plan_cannot_start_after_manual_mode(self):
        d = self.evaluate()
        self.engine.evaluate(sample(self.now, mode="manual", message_id="manual"), [self.p], self.now)
        with self.assertRaises(ValueError):
            self.engine.start_mock(d["decision_id"], self.now)

    def test_mass_balance_uses_session_volume_not_cumulative_counter(self):
        session, _, result = self.pause()
        self.assertAlmostEqual(result["obligation"]["delivered_g"], session["plan"]["stock_l"] * 0.5 * 25)

    def test_geometry_interpolates_non_linear_tank(self):
        self.assertEqual(tank_liters(50, [(0, 0), (50, 1000), (100, 5000)]), 1000)

    def test_fuzzy_min_max_centroid(self):
        self.assertEqual(membership(25, (0, 0, 25, 50)), 1)
        self.assertAlmostEqual(membership(37.5, (0, 0, 25, 50)), 0.5)
        self.assertGreater(fuzzy_volume(10, self.c)["water_l"], fuzzy_volume(50, self.c)["water_l"])
        self.assertEqual(fuzzy_volume(100, self.c)["water_l"], 0)

    def test_ema_updates_water_and_stock_separately(self):
        session = self.start()
        f = final_feedback(session, self.now + timedelta(minutes=30), fraction=0.5)
        f = f.model_copy(update={"actual_stock_l": f.actual_stock_l * 6 / 7})
        self.engine.feedback_mock(f)
        ema = self.store.read()["ema"][self.c.version]
        self.assertAlmostEqual(ema["fertilizer"], 6.7)
        self.assertAlmostEqual(ema["water"], 220)

    def test_schedule_occurrence_uses_calendar_hst(self):
        from datetime import date
        self.assertEqual(occurrences(self.p, date(2026, 10, 10)), [])
        self.assertEqual(occurrences(self.p, date(2026, 10, 12)), [date(2026, 10, 11)])

    def test_all_builtin_scenarios(self):
        from app.scenarios import SCENARIOS
        for name in SCENARIOS:
            with self.subTest(name=name):
                self.assertEqual(run_scenario(name)["hardware_commands"], 0)
