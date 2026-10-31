import unittest
from datetime import datetime, timedelta, timezone

from app.quality import check_soil_control_quality


class SoilQualityTests(unittest.TestCase):
    def setUp(self):
        self.state = {}
        self.start = datetime(2026, 10, 31, 16, 29, tzinfo=timezone.utc)

    def sample(self, n, moisture, **health):
        return {
            "message_id": f"telemetry-{n}",
            "recorded_at": (self.start + timedelta(seconds=30*n)).isoformat(),
            "soil_1_moisture": moisture,
            "sensor_health": {"soil_1_moisture": {
                "valid": True, "raw": round(moisture * 10), "rawAgeMs": 1000,
                "rawFresh": True, "lastPollOk": True, "pollBootId": "boot-1",
                **health,
            }},
        }

    def check(self, n, moisture, **health):
        return check_soil_control_quality(
            self.state, self.sample(n, moisture, **health), "soil_1_moisture"
        )

    def test_stable_nonzero_first_sample(self):
        self.assertEqual(self.check(0, 58.6), (True, None))
        self.assertEqual(self.check(1, 59.2), (True, None))

    def test_59_zero_59_does_not_confirm_fake_drought(self):
        self.assertTrue(self.check(0, 58.6)[0])
        self.assertEqual(self.check(1, 0), (False, "soil_moisture_suspect_change"))
        self.assertTrue(self.check(2, 59.2)[0])
        self.assertEqual(self.state["moisture_quality"]["soil_1_moisture"]["accepted"]["value"], 59.2)

    def test_repeated_ai_poll_same_message_is_not_recovery(self):
        self.check(0, 58.6)
        observation = self.sample(1, 0)
        self.assertFalse(check_soil_control_quality(self.state, observation, "soil_1_moisture")[0])
        for _ in range(20):
            self.assertFalse(check_soil_control_quality(self.state, observation, "soil_1_moisture")[0])
        entry = self.state["moisture_quality"]["soil_1_moisture"]
        self.assertEqual(entry["candidate"]["count"], 1)

    def test_distinct_valid_zero_samples_can_recover_after_confirmation(self):
        self.check(0, 58.6)
        self.assertFalse(self.check(1, 0)[0])
        self.assertFalse(self.check(2, 0)[0])
        self.assertTrue(self.check(3, 0)[0])

    def test_first_ever_zero_requires_confirmation(self):
        self.assertFalse(self.check(0, 0)[0])
        self.assertFalse(self.check(1, 0)[0])
        self.assertTrue(self.check(2, 0)[0])

    def test_cached_value_in_new_telemetry_does_not_confirm_zero(self):
        self.check(0, 58.6)
        self.assertFalse(self.check(1, 0)[0])
        # A telemetry packet 30 seconds later carries the identical Modbus
        # sample age+30s; this MUST NOT count as a second confirmation.
        self.assertEqual(self.check(2, 0, rawAgeMs=31000),
                         (False, "soil_moisture_cached_measurement"))
        self.assertEqual(self.state["moisture_quality"]["soil_1_moisture"]["candidate"]["count"], 1)

    def test_missing_sensor_diagnostics_stay_hold(self):
        self.assertEqual(self.check(0, 58, pollBootId=None)[1],
                         "soil_moisture_diagnostics_missing_or_failed")
        self.assertEqual(self.check(1, 58, rawFresh=None)[1],
                         "soil_moisture_diagnostics_missing_or_failed")

    def test_failed_poll_and_explicit_control_invalid_are_blocked(self):
        self.check(0, 58.6)
        self.assertEqual(self.check(1, 0, lastPollOk=False)[0], False)
        self.assertEqual(self.check(2, 59, controlValid=False)[0], False)
        self.assertEqual(self.check(3, 59, rawFresh=False)[0], False)

    def test_conflicting_id_or_out_of_order_fails_closed(self):
        self.check(0, 58.6)
        conflict = self.sample(0, 0)
        self.assertEqual(
            check_soil_control_quality(self.state, conflict, "soil_1_moisture")[1],
            "soil_moisture_conflicting_message_id"
        )
        self.check(2, 58.7)
        self.assertEqual(self.check(1, 58.8)[1], "soil_moisture_out_of_order")


if __name__ == "__main__":
    unittest.main()
