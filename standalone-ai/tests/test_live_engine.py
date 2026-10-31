import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.live_engine import LiveEngine, LiveProfile, StockBinding
from app.models import Config
from app.store import SQLiteStore


def real_observation(now, *, manual=False, due_today=True):
    at = now.isoformat()
    activity = {"activity_id": "row-11", "hst": 10, "application_date": "2026-10-28",
                "calendar_status": "DUE_TODAY" if due_today else "PAST_DUE", "method": "Tabur",
                "products": [{"source_row": 11, "product": "Fertiphos", "is_fertilizer": True,
                              "product_mass_g": 50000, "review_reasons": [], "dose_unit": "gram/tan.",
                              "dose": 2.5, "amount": 50, "unit": "kg"}], "manual_completion_records": []}
    keys = ["soil_1_moisture", "tank_water_level_pct", "tank_fert_level_pct"]
    mode = "manual" if manual else "automatic"
    return {"schema_compatible": True,
            "telemetry": {"message_id": at, "recorded_at": at, "soil_1_moisture": 20,
                          "tank_water_level_pct": 100, "tank_fert_level_pct": 100,
                          "sensor_health": {
                              **{key: {"valid": True} for key in keys},
                              "soil_1_moisture": {"valid": True, "raw": 200,
                                  "rawAgeMs": 1000, "rawFresh": True,
                                  "lastPollOk": True, "pollBootId": "test-boot"}}},
            "device_status": {"online": True, "mode": mode, "recorded_at": at,
                              "received_at": at, "pulse_boot_id": "ecc559ca86d29e48"},
            "automatic_control": {"desired_mode": mode, "applied_mode": mode, "revision": 1,
                                  "acknowledged_revision": 1, "acknowledgement_status": "applied", "water_sensor_key": "soil_1_moisture"},
            "guide_programs": {"status": "READ_ONLY_PREVIEW", "programs": [
                {"status": "PREVIEW_ONLY", "program_id": "web-program", "revision": 1, "source_sha256": "a"*64,
                 "guide_revision": 0, "config": {"plantingDate": "2026-10-18"}, "plant_count": 20000,
                 "guide_edits_changed": False, "hold_reasons": [], "activities": [activity]}]},
            "execution_evidence": {"status": "available", "latest_adaptive": {"received_at": at, "payload": {
                "kind": "adaptive_fert_telemetry", "timestamp": at, "state": "IDLE",
                "firmwareVersion": "1.5.03-SHT20-TELEMETRY-SYNC",
                "bootId": "ecc559ca86d29e48",
                "waterPumpKnown": True, "fertPumpKnown": True,
                "waterPump": False, "fertPump": False}}}}


def calibrated_profile():
    return LiveProfile(version="test-calibrated", planning=Config(version="test-calibrated", simulation_only=False),
                       stocks=[StockBinding(program_id="web-program", activity_id="row-11", source_row=11,
                                            batch_id="test-batch", concentration_g_l=25, verified=True)])


class LiveEngineTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 28, 1, tzinfo=timezone.utc)
        self.store = SQLiteStore()
        self.engine = LiveEngine(self.store, "greenhouse-01", "esp32-s3-01", "soil-1")

    def tearDown(self):
        self.store.close()

    def test_real_web_dose_not_demo_dose_no_ec_gate(self):
        observation = real_observation(self.now)
        observation["telemetry"]["liquid_ec_us_cm"] = 152
        result = self.engine.evaluate(observation)
        self.assertEqual(result["proposed_action"], "FERTIGATE")
        self.assertEqual(result["obligations"][0]["target_g"], 50000)
        self.assertFalse(result["ec_target_required_for_scheduling"])
        self.assertNotIn("ec", " ".join(result["hold_reasons"]).split())
        self.assertFalse(result["can_dispatch"])

    def test_obligation_and_decision_idempotent_for_same_observation(self):
        observation = real_observation(self.now)
        a = self.engine.evaluate(observation, now=self.now)
        b = self.engine.evaluate(observation, now=self.now+timedelta(seconds=1))
        self.assertEqual(a["decision_id"], b["decision_id"])
        state = self.store.read()
        self.assertEqual(len(state["live"]["obligations"]), 1)
        self.assertEqual(len(state["decisions"]), 1)

    def test_first_import_past_due_is_review_not_blind_catch_up(self):
        result = self.engine.evaluate(real_observation(self.now, due_today=False))
        self.assertEqual(result["obligations"][0]["status"], "REQUIRES_REVIEW")
        self.assertIn("past_schedule_at_first_import", result["obligations"][0]["review_reasons"])

    def test_due_obligation_survives_next_day_without_review_for_date_alone(self):
        self.engine.evaluate(real_observation(self.now))
        result = self.engine.evaluate(real_observation(self.now+timedelta(days=1), due_today=False), now=self.now+timedelta(days=1))
        self.assertEqual(result["obligations"][0]["status"], "PENDING")

    def test_program_revision_change_does_not_create_new_dose(self):
        observation = real_observation(self.now)
        self.engine.evaluate(observation)
        observation["guide_programs"]["programs"][0]["revision"] = 2
        result = self.engine.evaluate(observation)
        self.assertEqual(len(result["obligations"]), 1)
        self.assertEqual(result["obligations"][0]["status"], "REQUIRES_REVIEW")

    def test_products_separate_conflict_queue(self):
        observation = real_observation(self.now)
        products = observation["guide_programs"]["programs"][0]["activities"][0]["products"]
        products.append({**products[0], "source_row": 12, "product": "Nitrea"})
        result = self.engine.evaluate(observation)
        self.assertEqual(len(result["obligations"]), 2)
        self.assertEqual([o["target_g"] for o in result["obligations"]], [50000, 50000])

    def test_manual_record_does_not_mean_pump_delivered_or_repeat(self):
        observation = real_observation(self.now)
        observation["guide_programs"]["programs"][0]["activities"][0]["manual_completion_records"] = [{"program_revision": 1}]
        result = self.engine.evaluate(observation)
        self.assertEqual(result["obligations"][0]["delivered_g"], 0)
        self.assertEqual(result["obligations"][0]["status"], "REQUIRES_REVIEW")

    def test_fuzzy_when_no_fertilizer_obligation(self):
        observation = real_observation(self.now)
        observation["guide_programs"]["programs"] = []
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        self.assertEqual(result["proposed_action"], "IRRIGATE")
        self.assertGreater(result["plan"]["water_l"], 0)
        self.assertEqual(result["plan"]["stock_l"], 0)
        # A sudden 20->95 change is suspicious, not a trustworthy OFF decision.
        observation["telemetry"]["soil_1_moisture"] = 95
        observation["telemetry"]["sensor_health"]["soil_1_moisture"]["raw"] = 950
        observation["telemetry"]["message_id"] = "next-message"
        observation["telemetry"]["recorded_at"] = (self.now + timedelta(seconds=30)).isoformat()
        observation["device_status"]["recorded_at"] = observation["telemetry"]["recorded_at"]
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now + timedelta(seconds=30))
        self.assertEqual(result["type"], "HOLD")
        self.assertIn("soil_moisture_suspect_change", result["hold_reasons"])
        self.assertIsNone(result["fuzzy"])

    def test_stable_high_moisture_proposes_off(self):
        observation = real_observation(self.now)
        observation["guide_programs"]["programs"] = []
        observation["telemetry"]["soil_1_moisture"] = 95
        observation["telemetry"]["sensor_health"]["soil_1_moisture"]["raw"] = 950
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        self.assertEqual(result["proposed_action"], "OFF")
        self.assertIsNone(result["plan"])

    def test_moisture_zero_spike_blocks_fuzzy_even_with_valid_transport_health(self):
        observation = real_observation(self.now)
        observation["guide_programs"]["programs"] = []
        observation["telemetry"]["soil_1_moisture"] = 59
        observation["telemetry"]["sensor_health"]["soil_1_moisture"]["raw"] = 590
        self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        observation["telemetry"]["soil_1_moisture"] = 0
        observation["telemetry"]["sensor_health"]["soil_1_moisture"]["raw"] = 0
        observation["telemetry"]["message_id"] = "zero-frame-crc-valid"
        observation["telemetry"]["recorded_at"] = (self.now + timedelta(seconds=30)).isoformat()
        observation["device_status"]["recorded_at"] = observation["telemetry"]["recorded_at"]
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now + timedelta(seconds=30))
        self.assertEqual(result["type"], "HOLD")
        self.assertIsNone(result["fuzzy"])
        self.assertIn("soil_moisture_suspect_change", result["hold_reasons"])
        self.assertFalse(result["can_dispatch"])

    def test_validated_stock_allows_plan_without_ec_target(self):
        result = self.engine.evaluate(real_observation(self.now), calibrated_profile(), now=self.now)
        self.assertGreater(result["plan"]["stock_l"], 0)
        self.assertLess(result["plan"]["mass_g"], 50000)
        self.assertNotIn("verified_stock_concentration_missing", result["hold_reasons"])

    def test_water_wait_and_stable_refill(self):
        observation = real_observation(self.now)
        observation["telemetry"]["tank_water_level_pct"] = 4
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        self.assertEqual(result["obligations"][0]["status"], "WAITING_FOR_WATER")
        when = self.now + timedelta(minutes=1)
        result = self.engine.evaluate(real_observation(when), calibrated_profile(), now=when)
        self.assertIn("waiting_for_stable_water_level", result["hold_reasons"])
        when += timedelta(seconds=31)
        result = self.engine.evaluate(real_observation(when), calibrated_profile(), now=when)
        self.assertEqual(result["obligations"][0]["status"], "READY")
        self.assertFalse(result["can_dispatch"])

    def test_adaptive_feedback_is_reported_off_not_actuation_authority(self):
        observation = real_observation(self.now, manual=True)
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        evidence = result["pump_feedback"]
        self.assertEqual(evidence["status"], "REPORTED_OFF_FRESH")
        self.assertTrue(evidence["reported_off"])
        self.assertFalse(evidence["safe_shutdown_verified"])
        self.assertFalse(evidence["physical_relay_contact_verified"])
        self.assertFalse(result["can_dispatch"])
        self.assertIn("manual_mode_blocks_automatic_start", result["hold_reasons"])

    def test_adaptive_boot_mismatch_and_stale_are_holds(self):
        observation = real_observation(self.now)
        observation["execution_evidence"]["latest_adaptive"]["payload"]["bootId"] = "f" * 16
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        self.assertIn("execution_feedback_boot_mismatch", result["hold_reasons"])
        self.assertFalse(result["pump_feedback"]["reported_off"])
        observation["execution_evidence"]["latest_adaptive"]["payload"]["bootId"] = "ecc559ca86d29e48"
        observation["execution_evidence"]["latest_adaptive"]["received_at"] = (
            self.now - timedelta(minutes=2)).isoformat()
        result = self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        self.assertIn("execution_feedback_stale", result["hold_reasons"])
        self.assertFalse(result["can_dispatch"])

    def test_manual_revokes_waiting_auto_resume(self):
        observation = real_observation(self.now)
        observation["telemetry"]["tank_water_level_pct"] = 4
        self.engine.evaluate(observation, calibrated_profile(), now=self.now)
        result = self.engine.evaluate(real_observation(self.now, manual=True), calibrated_profile(), now=self.now)
        self.assertEqual(result["obligations"][0]["status"], "REQUIRES_REVIEW")
        self.assertIn("manual_mode_blocks_automatic_start", result["hold_reasons"])

    def test_unconfigured_or_stale_sensor_does_not_dispatch(self):
        result = self.engine.evaluate(real_observation(self.now), now=self.now+timedelta(minutes=5))
        self.assertIn("sensor_data_stale_or_missing", result["hold_reasons"])
        self.assertIn("validated_planning_configuration_missing", result["hold_reasons"])
        self.assertEqual(result["type"], "HOLD")

    def test_dry_run_no_mutation(self):
        before = self.store.read()
        self.assertEqual(self.engine.evaluate(real_observation(self.now), dry_run=True)["mode"], "DRY_RUN")
        self.assertEqual(self.store.read(), before)

    def test_restart_restores_obligations(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = str(Path(directory)/"live.sqlite3")
            a = SQLiteStore(path)
            LiveEngine(a, "s", "d", "z").evaluate(real_observation(self.now), now=self.now)
            a.close()
            b = SQLiteStore(path)
            try:
                result = LiveEngine(b, "s", "d", "z").evaluate(real_observation(self.now), now=self.now)
                self.assertEqual(len(result["obligations"]), 1)
            finally:
                b.close()
