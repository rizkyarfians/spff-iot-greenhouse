import unittest

from app.flow_evidence import counter_evidence, learn_counter_ema
from app.live_engine import empty_live


class CounterEMATests(unittest.TestCase):
    def setUp(self):
        self.state = empty_live()
        self.session = {
            "started_at": "2026-10-31T17:00:00+00:00", "boot_id": "boot-1",
            "configuration_version": "test", "ema_used": {
                "water": 220.0, "fertilizer": 7.0
            }, "alpha": 0.3,
            "flow_counter_baseline": {"water": 100.0, "fertilizer": 40.0}
        }
        self.payload = {
            "bootId": "boot-1", "sessionId": "session-1",
            "timestamp": "2026-10-31T17:20:00+00:00",
            "waterFlowTotalL": 3100.0, "fertFlowTotalL": 140.0,
            "waterVolumeL": 3000.0, "fertVolumeL": 100.0,
            "waterOnSeconds": 3000 / 220 * 60,
            "fertilizerOnSeconds": 100 / 6 * 60,
        }

    def test_two_independent_counter_backed_updates(self):
        status, reason, proof = counter_evidence(self.state, self.session, self.payload)
        self.assertEqual(status, "MATCHED")
        self.assertIsNone(reason)
        learn_counter_ema(self.state, self.session, self.payload, "event-1", proof)
        self.assertEqual(len(self.state["ema_history"]), 2)
        self.assertAlmostEqual(self.state["ema"]["test"]["water"], 220)
        self.assertAlmostEqual(self.state["ema"]["test"]["fertilizer"], 6.7)

    def test_no_counter_baseline_means_no_ema_learning(self):
        self.session.pop("flow_counter_baseline")
        self.payload.pop("waterFlowTotalL")
        self.payload.pop("fertFlowTotalL")
        status, _, proof = counter_evidence(self.state, self.session, self.payload)
        self.assertEqual((status, proof), ("MISSING", {}))
        self.assertEqual(self.state["ema_history"], [])

    def test_start_less_than_previous_high_water_is_reset(self):
        self.state["flow_counter_state"] = {"water": {
            "boot_id": "boot-1", "high_water_l": 4000, "reset_pending": False
        }}
        status, reason, _ = counter_evidence(self.state, self.session, self.payload)
        self.assertEqual((status, reason), ("INVALID", "counter_reset_requires_review"))
        self.assertTrue(self.state["flow_counter_state"]["water"]["reset_pending"])

    def test_implausible_flow_rate_is_rejected_without_model_change(self):
        self.payload["fertilizerOnSeconds"] = 5.0
        status, _, proof = counter_evidence(self.state, self.session, self.payload)
        self.assertEqual(status, "MATCHED")
        learn_counter_ema(self.state, self.session, self.payload, "event-1", proof)
        self.assertAlmostEqual(self.state["ema"]["test"]["fertilizer"], 7.0)
        self.assertIn("counter_flow_outlier",
                      [x["reason"] for x in self.state["ema_rejections"]])


if __name__ == "__main__":
    unittest.main()
