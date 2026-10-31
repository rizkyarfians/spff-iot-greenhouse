import unittest
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

    def test_index_and_openapi(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertIn("/simulations/evaluate", self.client.get("/openapi.json").json()["paths"])

    def test_arbitrary_feedback_not_exposed(self):
        self.assertEqual(self.client.post("/feedback", json={}).status_code, 404)

    def test_body_validation(self):
        self.assertEqual(self.client.post("/simulations/evaluate", json={"snapshot": {}}).status_code, 422)
