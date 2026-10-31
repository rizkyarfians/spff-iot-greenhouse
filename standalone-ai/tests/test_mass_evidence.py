import unittest

from app.mass_evidence import accept_delivery


class MassEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.state = {}
        self.obligation = {
            "delivered_g": 0.0,
            "snapshot": {"target_g": 5000.0},
        }

    def accept(self, session="session-1", event="event-1", volume=100.0, mass=2500.0):
        result = accept_delivery(
            self.state, "ob-1", session, event, self.obligation,
            stock_l=volume, mass_g=mass, concentration_g_l=25.0,
            counter_status="MATCHED"
        )
        if result is None:
            self.obligation["delivered_g"] += mass
        return result

    def test_two_distinct_terminal_sessions_accumulate_measured_mass(self):
        self.assertIsNone(self.accept())
        self.assertIsNone(self.accept("session-2", "event-2", 100, 2500))
        self.assertEqual(self.obligation["delivered_g"], 5000)
        self.assertEqual(len(self.state["mass_balance_evidence"]["ob-1"]), 2)

    def test_same_bound_session_cannot_double_credit(self):
        self.assertIsNone(self.accept())
        self.assertEqual(self.accept("session-1", "event-conflict"), "duplicate_bound_session_delivery_requires_review")
        self.assertEqual(self.obligation["delivered_g"], 2500)

    def test_counter_disagreement_not_a_mass_estimate(self):
        self.assertEqual(self.accept(volume=100, mass=10), "invalid_mass_balance_measurement")
        self.assertEqual(self.obligation["delivered_g"], 0)

    def test_unknown_existing_ledger_baseline_requires_review(self):
        self.state["mass_balance_evidence"] = {"ob-1": {"other-session": {
            "mass_g": 120, "safe_shutdown_verified": True,
        }}}
        self.assertEqual(self.accept(), "mass_balance_baseline_missing_requires_review")

    def test_obligation_mass_tampering_requires_review(self):
        self.assertIsNone(self.accept())
        self.obligation["delivered_g"] = 3000
        self.assertEqual(self.accept("session-2", "event-2", 20, 500),
                         "mass_balance_ledger_mismatch_requires_review")

    def test_mass_cannot_exceed_target(self):
        self.assertIsNone(self.accept())
        self.assertEqual(self.accept("session-2", "event-2", 120, 3000),
                         "mass_balance_target_exceeded_requires_review")
        self.assertEqual(self.obligation["delivered_g"], 2500)


if __name__ == "__main__":
    unittest.main()
