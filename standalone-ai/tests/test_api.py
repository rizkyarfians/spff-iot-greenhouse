import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api import create_app
from app.models import Config
from app.settings import Settings
from app.store import SQLiteStore


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore()
        self.client = TestClient(create_app(Settings(), Config(), self.store))

    def tearDown(self):
        self.client.close()
        self.store.close()

    def test_health_and_ready(self):
        self.assertEqual(self.client.get("/health").json()["mode"], "SHADOW_MODE")
        self.assertEqual(self.client.get("/ready").status_code, 200)
        self.assertFalse(self.client.get("/ready").json()["hardware_ready"])
        self.assertEqual(self.client.get("/obligations").json(), [])
        self.assertFalse(self.client.get("/live/state").json()["ec_target_required_for_scheduling"])

    def test_decisions_sorted_by_timestamp_not_jsonb_key_order(self):
        from datetime import datetime, timedelta, timezone
        when = datetime(2026, 11, 1, tzinfo=timezone.utc)
        with self.store.transaction() as state:
            # Simulate JSONB lexicographic key ordering and an old 2085 snapshot.
            state["decisions"] = {
                "z-old": {"decision_id": "z-old", "at": (when - timedelta(hours=2)).isoformat(),
                          "type": "HOLD", "input_snapshot": {"telemetry": {"telemetry_id": 88368}}},
                "a-new": {"decision_id": "a-new", "at": when.isoformat(),
                          "type": "HOLD", "input_snapshot": {"telemetry": {"telemetry_id": 140817}}},
            }
        results = self.client.get("/decisions?limit=1")
        self.assertEqual(results.status_code, 200)
        self.assertEqual(results.json()[0]["decision_id"], "a-new")
        self.assertEqual(results.json()[0]["input_snapshot"]["telemetry"]["telemetry_id"], 140817)

    def test_config_has_no_credentials(self):
        self.assertNotIn("dsn", self.client.get("/config").text.lower())

    def test_simulation_isolation(self):
        self.assertEqual(self.client.post("/simulations/complete").status_code, 200)
        self.assertEqual(self.client.get("/decisions").json(), [])

    def test_unknown_scenario(self):
        self.assertEqual(self.client.post("/simulations/unknown").status_code, 404)

    def test_source_unconfigured(self):
        self.assertEqual(self.client.get("/source/audit").status_code, 503)
        self.assertEqual(self.client.get("/source/guide-programs").status_code, 503)

    def test_guide_preview_route_only_reads_source(self):
        with patch("app.api.SPFFSource") as source:
            source.return_value.inspect_guides.return_value = {
                "status": "READ_ONLY_PREVIEW", "programs": [], "can_dispatch": False}
            with TestClient(create_app(Settings(source_dsn="test-only", fertilizer_delivery_route="drip"), Config(), self.store)) as client:
                response = client.get("/source/guide-programs")
                self.assertEqual(client.get("/status").json()["fertilizer_delivery_route"], "drip")
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["can_dispatch"])
            self.assertEqual(self.store.read()["decisions"], {})
            source.return_value.inspect_guides.assert_called_once()
            self.assertEqual(source.call_args.kwargs["fertilizer_delivery_route"], "drip")

    def test_index_and_openapi(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertIn("/simulations/evaluate", self.client.get("/openapi.json").json()["paths"])

    def test_arbitrary_feedback_not_exposed(self):
        self.assertEqual(self.client.post("/feedback", json={}).status_code, 404)

    def test_body_validation(self):
        self.assertEqual(self.client.post("/simulations/evaluate", json={"snapshot": {}}).status_code, 422)
