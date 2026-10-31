"""Fase 4A: fail-closed adaptive pump output evidence, no dispatch."""
import unittest
from datetime import datetime, timedelta, timezone

from app.adaptive_feedback import assess_adaptive_feedback

NOW = datetime(2026, 11, 1, 0, 16, 40, tzinfo=timezone.utc)
BOOT = "ecc559ca86d29e48"


def reported(*, age=5):
    return {
        "received_at": (NOW-timedelta(seconds=age)).isoformat(),
        "payload": {
            "kind": "adaptive_fert_telemetry",
            "timestamp": (NOW-timedelta(seconds=age+1)).isoformat(),
            "firmwareVersion": "1.5.03-SHT20-TELEMETRY-SYNC",
            "bootId": BOOT,
            "state": "IDLE",
            "waterPump": False,
            "fertPump": False,
            "waterPumpKnown": True,
            "fertPumpKnown": True,
            "waterVolumeL": 0,
            "fertVolumeL": 0,
        },
    }


def status(*, age=1):
    return {
        "recorded_at": (NOW-timedelta(seconds=age)).isoformat(),
        "received_at": (NOW-timedelta(seconds=age)).isoformat(),
        "online": True,
        "mode": "manual",
        "pulse_boot_id": BOOT,
    }


class AdaptiveFeedbackTests(unittest.TestCase):
    def test_1503_idle_known_off_matches_boot_and_is_fresh(self):
        value = assess_adaptive_feedback(reported(), status(), NOW)
        self.assertEqual(value["status"], "REPORTED_OFF_FRESH")
        self.assertTrue(value["reported_off"])
        self.assertTrue(value["boot_matches"])
        self.assertFalse(value["safe_shutdown_verified"])
        self.assertFalse(value["physical_relay_contact_verified"])
        self.assertFalse(value["session_volume_verified"])
        self.assertFalse(value["can_dispatch"])

    def test_missing_frame_fails_closed(self):
        value = assess_adaptive_feedback(None, status(), NOW)
        self.assertIn("execution_feedback_unavailable", value["hold_reasons"])
        self.assertFalse(value["reported_off"])

    def test_stale_received_time_fails_closed(self):
        value = assess_adaptive_feedback(reported(age=35), status(), NOW)
        self.assertIn("execution_feedback_stale", value["hold_reasons"])

    def test_stale_device_status_fails_closed(self):
        value = assess_adaptive_feedback(reported(), status(age=40), NOW)
        self.assertIn("execution_feedback_device_status_unavailable", value["hold_reasons"])

    def test_boot_mismatch_fails_closed(self):
        frame = reported()
        frame["payload"]["bootId"] = "9a58fec28041c6e0"
        value = assess_adaptive_feedback(frame, status(), NOW)
        self.assertIn("execution_feedback_boot_mismatch", value["hold_reasons"])

    def test_missing_boot_is_not_assumed_to_match(self):
        device = status()
        del device["pulse_boot_id"]
        value = assess_adaptive_feedback(reported(), device, NOW)
        self.assertIn("execution_feedback_boot_unavailable", value["hold_reasons"])

    def test_output_unknown_fails_closed(self):
        frame = reported()
        frame["payload"]["fertPumpKnown"] = False
        value = assess_adaptive_feedback(frame, status(), NOW)
        self.assertIn("execution_feedback_output_unknown", value["hold_reasons"])

    def test_pump_on_fails_closed(self):
        frame = reported()
        frame["payload"]["waterPump"] = True
        value = assess_adaptive_feedback(frame, status(), NOW)
        self.assertIn("device_busy_faulted_or_pumps_not_verified_off", value["hold_reasons"])

    def test_completed_is_not_safe_shutdown(self):
        frame = reported()
        frame["payload"]["state"] = "COMPLETED"
        value = assess_adaptive_feedback(frame, status(), NOW)
        self.assertFalse(value["safe_shutdown_verified"])
        self.assertFalse(value["reported_off"])

    def test_wrong_kind_and_firmware_not_trusted(self):
        frame = reported()
        frame["payload"]["kind"] = "adaptive_fert_ack"
        frame["payload"]["firmwareVersion"] = "legacy"
        value = assess_adaptive_feedback(frame, status(), NOW)
        self.assertIn("execution_feedback_kind_invalid", value["hold_reasons"])
        self.assertIn("execution_feedback_firmware_unverified", value["hold_reasons"])

    def test_future_report_and_naive_times_not_trusted(self):
        frame = reported()
        frame["payload"]["timestamp"] = (NOW+timedelta(seconds=7)).isoformat()
        self.assertIn("execution_feedback_stale", assess_adaptive_feedback(frame, status(), NOW)["hold_reasons"])
        frame["payload"]["timestamp"] = "2026-11-01T00:16:38"
        self.assertIn("execution_feedback_stale", assess_adaptive_feedback(frame, status(), NOW)["hold_reasons"])

    def test_clock_inversion_fails_closed(self):
        frame = reported()
        frame["payload"]["timestamp"] = (NOW+timedelta(seconds=2)).isoformat()
        frame["received_at"] = (NOW-timedelta(seconds=5)).isoformat()
        self.assertIn("execution_feedback_clock_conflict", assess_adaptive_feedback(frame, status(), NOW)["hold_reasons"])

    def test_malformed_payload_fails_closed(self):
        frame = {"received_at": NOW.isoformat(), "payload": []}
        value = assess_adaptive_feedback(frame, status(), NOW)
        self.assertFalse(value["reported_off"])
        self.assertFalse(value["can_dispatch"])


if __name__ == "__main__":
    unittest.main()
