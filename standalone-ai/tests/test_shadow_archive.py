import unittest
from datetime import datetime, timezone

from app.shadow_archive import validate_shadow_decisions


def sample_state():
    fingerprint = "a" * 64
    decision = {
        "decision_id": "decision-1",
        "at": datetime(2026, 11, 4, tzinfo=timezone.utc).isoformat(),
        "mode": "SHADOW_MODE",
        "can_dispatch": False,
        "input_snapshot": {"source": "real"},
    }
    return {
        "live": {"decisions": {fingerprint: decision}, "obligations": {}},
        "decisions": {"decision-1": dict(decision)},
        "current_decision_id": "decision-1",
    }


class ShadowDecisionBackfillValidation(unittest.TestCase):
    def test_valid_existing_ledger_unchanged(self):
        state = sample_state()
        before = repr(state)
        rows = validate_shadow_decisions(state)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "a" * 64)
        self.assertEqual(rows[0][1], "decision-1")
        self.assertEqual(rows[0][3]["input_snapshot"], {"source": "real"})
        self.assertEqual(repr(state), before)

    def test_rejects_mismatched_duplicated_payload(self):
        state = sample_state()
        state["decisions"]["decision-1"]["input_snapshot"] = {}
        with self.assertRaisesRegex(ValueError, "differ"):
            validate_shadow_decisions(state)

    def test_rejects_missing_main_entry(self):
        state = sample_state()
        state["decisions"] = {}
        with self.assertRaises(ValueError):
            validate_shadow_decisions(state)

    def test_rejects_invalid_fingerprint(self):
        state = sample_state()
        state["live"]["decisions"] = {"unsafe": next(iter(state["live"]["decisions"].values()))}
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            validate_shadow_decisions(state)

    def test_rejects_time_without_utc_offset(self):
        state = sample_state()
        state["live"]["decisions"]["a" * 64]["at"] = "2026-11-04T01:00:00"
        state["decisions"]["decision-1"]["at"] = "2026-11-04T01:00:00"
        with self.assertRaisesRegex(ValueError, "UTC"):
            validate_shadow_decisions(state)

    def test_rejects_duplicate_identity_in_two_fingerprints(self):
        state = sample_state()
        state["live"]["decisions"]["b" * 64] = state["live"]["decisions"]["a" * 64]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_shadow_decisions(state)

    def test_rejects_unknown_current_decision(self):
        state = sample_state()
        state["current_decision_id"] = "missing"
        with self.assertRaisesRegex(ValueError, "current"):
            validate_shadow_decisions(state)


if __name__ == "__main__":
    unittest.main()
