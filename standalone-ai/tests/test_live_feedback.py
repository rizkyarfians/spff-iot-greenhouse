import copy
import unittest
from datetime import datetime, timedelta, timezone

from app.live_feedback import process_feedback
from app.store import SQLiteStore
from app.live_engine import empty_live


class LiveFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore()
        self.start = datetime(2026, 10, 28, 1, tzinfo=timezone.utc)
        self.end = self.start + timedelta(minutes=20)
        with self.store.transaction() as container:
            state = container["live"] = empty_live()
            state["obligations"]["obligation"] = {"status": "RUNNING", "snapshot": {"target_g": 5000}, "delivered_g": 0, "review_reasons": []}
            state["sessions"]["session"] = {"status": "RUNNING", "obligation_id": "obligation", "boot_id": "test-boot",
                "started_at": self.start.isoformat(), "concentration_g_l": 25, "target_stock_l": 200,
                "tolerance_g": 1, "alpha": 0.3, "configuration_version": "test", "ema_used": {"water": 220, "fertilizer": 7}}
        self.event = {"message_id": "event", "payload": {"sessionId": "session", "bootId": "test-boot",
            "timestamp": self.end.isoformat(), "flowValid": True, "flowAgeMs": 100,
            "volumeEstimated": False, "waterPumpKnown": True, "fertPumpKnown": True,
            "waterPump": False, "fertPump": False, "waterVolumeL": 3000, "fertVolumeL": 100,
            "state": "WAITING_FOR_WATER", "stopReason": "water_low", "safeShutdownComplete": True,
            "waterOnSeconds": 3000/220*60, "fertilizerOnSeconds": 100/6*60}}

    def tearDown(self):
        self.store.close()

    def test_measured_mass_waiting_water_without_counter_proof_does_not_learn_ema(self):
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["status"], "WAITING_FOR_WATER")
        self.assertEqual(result["delivered_g"], 2500)
        self.assertEqual(result["counter_evidence"], "MISSING")
        self.assertEqual(self.store.read()["live"]["ema_history"], [])

    def test_verified_bound_counter_proves_mass_and_updates_separate_ema(self):
        with self.store.transaction() as container:
            container["live"]["sessions"]["session"]["flow_counter_baseline"] = {
                "water": 100.0, "fertilizer": 40.0
            }
        self.event["payload"]["waterFlowTotalL"] = 3100.0
        self.event["payload"]["fertFlowTotalL"] = 140.0
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["counter_evidence"], "MATCHED")
        self.assertEqual(result["delivered_g"], 2500)
        history = self.store.read()["live"]["ema_history"]
        self.assertEqual(len(history), 2)
        self.assertTrue(all(entry["counter_backed"] for entry in history))
        self.assertAlmostEqual(
            self.store.read()["live"]["ema"]["test"]["fertilizer"], 6.7
        )

    def test_counter_reset_requires_review_and_never_credits_mass(self):
        with self.store.transaction() as container:
            live = container["live"]
            live["sessions"]["session"]["flow_counter_baseline"] = {
                "water": 100.0, "fertilizer": 40.0
            }
            live["flow_counter_state"] = {"water": {
                "boot_id": "test-boot", "high_water_l": 4000.0,
                "reset_pending": False
            }}
        self.event["payload"]["waterFlowTotalL"] = 3100.0
        self.event["payload"]["fertFlowTotalL"] = 140.0
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["status"], "REQUIRES_REVIEW")
        self.assertFalse(result["dose_changed"])
        self.assertEqual(result["delivered_g"], 0)
        self.assertEqual(self.store.read()["live"]["ema_history"], [])
        self.assertTrue(self.store.read()["live"]["flow_counter_state"]["water"]["reset_pending"])

    def test_counter_volume_conflict_does_not_credit_mass(self):
        with self.store.transaction() as container:
            container["live"]["sessions"]["session"]["flow_counter_baseline"] = {
                "water": 100.0, "fertilizer": 40.0
            }
        self.event["payload"]["waterFlowTotalL"] = 3100.0
        self.event["payload"]["fertFlowTotalL"] = 55.0
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["status"], "REQUIRES_REVIEW")
        self.assertEqual(result["delivered_g"], 0)

    def test_unsafe_terminal_never_credits_mass(self):
        for change in (
            {"safeShutdownComplete": False},
            {"waterPump": True},
            {"fertPump": True},
            {"state": "FAULT"}
        ):
            with self.subTest(change=change):
                event = copy.deepcopy(self.event)
                event["payload"].update(change)
                result = process_feedback(self.store, event, self.end)
                self.assertEqual(result["status"], "REQUIRES_REVIEW")
                self.assertEqual(result["delivered_g"], 0)
                self.assertEqual(self.store.read()["live"]["ema_history"], [])
                # Restore only the intentionally isolated test database state.
                with self.store.transaction() as container:
                    live = container["live"]
                    live["sessions"]["session"]["status"] = "RUNNING"
                    live["obligations"]["obligation"]["status"] = "RUNNING"
                    live["feedback"].clear()

    def test_duplicate_feedback_never_updates_mass_or_ema_twice(self):
        result = process_feedback(self.store, self.event, self.end)
        before = self.store.read()
        self.assertEqual(process_feedback(self.store, self.event, self.end), result)
        self.assertEqual(self.store.read(), before)

    def test_foreign_legacy_session_does_not_allocate_dose(self):
        self.event["payload"]["sessionId"] = "unbound"
        before = self.store.read()
        self.assertEqual(process_feedback(self.store, self.event, self.end)["status"], "UNBOUND")
        self.assertEqual(self.store.read(), before)

    def test_bad_flow_wrong_boot_and_estimates_cannot_claim_dose(self):
        for patch in ({"flowValid": False}, {"volumeEstimated": True}, {"bootId": "reboot"}):
            with self.subTest(patch=patch):
                event = copy.deepcopy(self.event)
                event["message_id"] = str(patch)
                event["payload"].update(patch)
                result = process_feedback(self.store, event, self.end)
                self.assertEqual(result["delivered_g"], 0)
                self.assertEqual(result["status"], "REQUIRES_REVIEW")

    def test_current_firmware_low_water_fault_never_auto_resumes(self):
        self.event["payload"].update(state="FAULT", faultReason="water_tank_low", safeShutdownComplete=False)
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["status"], "REQUIRES_REVIEW")
        self.assertEqual(self.store.read()["live"]["ema_history"], [])

    def test_conflicting_replay_is_reviewed(self):
        process_feedback(self.store, self.event, self.end)
        self.event["payload"]["fertVolumeL"] = 110
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["status"], "CONFLICTING_REPLAY")

    def test_wall_clock_not_substituted_for_pump_active_duration(self):
        del self.event["payload"]["waterOnSeconds"]
        del self.event["payload"]["fertilizerOnSeconds"]
        process_feedback(self.store, self.event, self.end)
        self.assertEqual(self.store.read()["live"]["ema_history"], [])
