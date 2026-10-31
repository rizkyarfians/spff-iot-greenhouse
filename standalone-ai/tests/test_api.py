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
            with TestClient(create_app(Settings(source_dsn="test-only"), Config(), self.store)) as client:
                response = client.get("/source/guide-programs")
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["can_dispatch"])
            self.assertEqual(self.store.read()["decisions"], {})
            source.return_value.inspect_guides.assert_called_once()

    def test_index_and_openapi(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertIn("/simulations/evaluate", self.client.get("/openapi.json").json()["paths"])

    def test_arbitrary_feedback_not_exposed(self):
        self.assertEqual(self.client.post("/feedback", json={}).status_code, 404)

    def test_body_validation(self):
        self.assertEqual(self.client.post("/simulations/evaluate", json={"snapshot": {}}).status_code, 422)
