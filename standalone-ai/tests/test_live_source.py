import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.source import SPFFSource
from app.store import SQLiteStore
from test_live_engine import real_observation


class SourceDecisionTests(unittest.TestCase):
    def test_record_shadow_uses_live_scheduler_and_does_not_require_ec_profile(self):
        store = SQLiteStore()
        source = SPFFSource("not-connected", "greenhouse-01", "esp32-s3-01", "soil-1")
        observation = real_observation(datetime.now(timezone.utc))
        try:
            with patch.object(source, "inspect", return_value=observation):
                result = source.record_shadow(store)
                again = source.record_shadow(store)
            self.assertEqual(result["decision_id"], again["decision_id"])
            self.assertEqual(result["proposed_action"], "FERTIGATE")
            self.assertEqual(result["obligations"][0]["target_g"], 50000)
            self.assertFalse(result["ec_target_required_for_scheduling"])
            self.assertEqual(len(store.read()["live"]["obligations"]), 1)
        finally:
            store.close()
