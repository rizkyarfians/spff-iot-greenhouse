import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.source import SPFFSource
from app.store import SQLiteStore
from test_live_engine import real_observation


class SourceDecisionTests(unittest.TestCase):
    def test_record_shadow_scans_hst_only_and_never_inspects_telemetry(self):
        store = SQLiteStore()
        source = SPFFSource("not-connected", "greenhouse-01", "esp32-s3-01", "soil-1")
        observation = real_observation(datetime.now(timezone.utc))
        try:
            with patch.object(source, "inspect", side_effect=AssertionError("telemetry read before ACC")):
                with patch.object(source, "inspect_guides", return_value=observation["guide_programs"]):
                    result = source.record_shadow(store)
                    again = source.record_shadow(store)
            self.assertEqual(result["created"], 1)
            self.assertEqual(again["created"], 0)
            self.assertFalse(result["can_dispatch"])
            self.assertEqual(len(store.read()["live"]["obligations"]), 1)
            self.assertEqual(store.read()["decisions"], {})
            self.assertEqual(store.read()["live"]["decisions"], {})
        finally:
            store.close()
