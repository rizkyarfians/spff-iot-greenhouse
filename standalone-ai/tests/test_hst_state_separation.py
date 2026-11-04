"""Regression: HST endpoints never read the giant legacy development state."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Config
from app.settings import Settings
from app.store import initial_state


class FakePostgresStore:
    instances = []

    def __init__(self, dsn, scope):
        self.scope = scope
        self.read_calls = 0
        self.summary_calls = 0
        self.state = initial_state()
        FakePostgresStore.instances.append(self)

    def read(self):
        self.read_calls += 1
        if self.scope.endswith("/source-shadow"):
            raise AssertionError("legacy 56 MB state must not be read by HST endpoints")
        return self.state

    def read_summary(self):
        self.summary_calls += 1
        return {"guide_stock_bindings": {}, "shadow_water_plans": {}}

    def close(self):
        pass

    def runtime_profile(self):
        return None


class HstStateSeparationTests(unittest.TestCase):
    def setUp(self):
        FakePostgresStore.instances = []

    def test_status_ready_and_hst_proposals_only_read_small_scope(self):
        settings = Settings(state_dsn="fake-production-state", mode="SHADOW_MODE")
        with patch("app.api.PostgresStore", FakePostgresStore):
            with TestClient(create_app(settings, Config())) as client:
                self.assertEqual(client.get("/health").status_code, 200)
                self.assertEqual(client.get("/ready").status_code, 200)
                status = client.get("/status")
                self.assertEqual(status.status_code, 200)
                self.assertIsNone(status.json()["legacy_development_decision_count"])
                self.assertEqual(status.json()["legacy_history_scope"], "separate_retained_legacy_scope")
                self.assertEqual(client.get("/hst/proposals").json()["proposals"], [])
                self.assertEqual(client.get("/obligations").json(), [])
        self.assertEqual(len(FakePostgresStore.instances), 2)
        legacy, hst = FakePostgresStore.instances
        self.assertEqual(legacy.read_calls, 0)
        self.assertGreaterEqual(hst.read_calls, 4)
        self.assertEqual(hst.scope, legacy.scope + "/hst-v1")

    def test_summary_uses_lightweight_legacy_fields_without_full_blob(self):
        settings = Settings(state_dsn="fake-production-state",
                            source_dsn="fake-readonly-source", mode="SHADOW_MODE")
        sample = {"schema_compatible": False, "missing": {}, "can_dispatch": False}
        with patch("app.api.PostgresStore", FakePostgresStore):
            with patch("app.api.SPFFSource") as source:
                source.return_value.inspect.return_value = sample
                with TestClient(create_app(settings, Config())) as client:
                    self.assertEqual(client.get("/dashboard/summary").status_code, 200)
        legacy, _ = FakePostgresStore.instances
        self.assertEqual(legacy.read_calls, 0)
        self.assertEqual(legacy.summary_calls, 1)


if __name__ == "__main__":
    unittest.main()
