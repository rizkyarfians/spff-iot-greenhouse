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

    def test_measured_mass_waiting_water_and_separate_flow_ema(self):
        result = process_feedback(self.store, self.event, self.end)
        self.assertEqual(result["status"], "WAITING_FOR_WATER")
        self.assertEqual(result["delivered_g"], 2500)
        self.assertAlmostEqual(self.store.read()["live"]["ema"]["test"]["fertilizer"], 6.7)

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
