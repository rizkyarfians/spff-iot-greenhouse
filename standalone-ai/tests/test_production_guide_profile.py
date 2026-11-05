import copy
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.api import create_app, HstApproval
from app.dashboard_summary import present_shadow_dashboard
from app.live_engine import LiveProfile
from app.models import Config
from app.production_profile import bind_guide_irrigation, resolve_guide_irrigation
from app.settings import Settings
from test_hst_state_separation import FakePostgresStore

NOW = datetime(2026, 11, 4, 15, 59, tzinfo=timezone.utc)


def guides():
    return {"status": "READ_ONLY_PREVIEW", "programs": [{
        "program_id": "program-1", "revision": 2, "guide_revision": 3,
        "source_sha256": "a" * 64, "status": "PREVIEW_ONLY", "hold_reasons": [],
        "crop_name": "Tanaman uji", "current_hst": 20, "plant_count": 100,
        "config": {"deviceId": "esp32-s3-01", "plantingDate": "2026-10-15"},
        "activities": [{"activity_id": "row-19", "method": "Kocor", "title": "Air uji",
            "hst": 20, "application_date": "2026-11-04", "calendar_status": "DUE_TODAY",
            "reference_water_l": 1000.0, "warnings": [], "products": []}],
    }]}


def base():
    return LiveProfile(version="test-hydraulics", planning=Config(
        version="test-hydraulics", simulation_only=False))


def bound():
    return bind_guide_irrigation(base(), guides(), program_id="program-1", activity_id="row-19",
        device_id="esp32-s3-01", version="test-guide-1", reference="Verified synthetic test Guide")


def observation():
    return {"schema_compatible": True, "guide_programs": guides(),
        "device_status": {"mode": "manual"},
        "automatic_control": {"water_sensor_key": "soil_2_moisture", "revision": 1,
            "acknowledged_revision": 1, "acknowledgement_status": "applied"},
        "telemetry": {"recorded_at": NOW.isoformat(), "received_at": NOW.isoformat(), "soil_2_moisture": 19.9,
            "tank_water_level_pct": 41.9, "tank_water_distance_cm": 75.42,
            "tank_fert_level_pct": 20.2, "tank_fert_distance_cm": 18.18,
            "sensor_health": {"soil_2_moisture": {"valid": True, "controlValid": True,
                "raw": 199, "rawAgeMs": 0, "rawFresh": True, "lastPollOk": True,
                "pollBootId": "test-boot"}, "tank_water_level_pct": {"valid": True},
                "tank_water_distance_cm": {"valid": True}, "tank_fert_level_pct": {"valid": True},
                "tank_fert_distance_cm": {"valid": True}}}}


class ProductionGuideProfileTests(unittest.TestCase):
    def test_execution_only_source_holds_do_not_block_water_calculation(self):
        from app.production_profile import EXECUTION_ONLY_HOLDS
        source = guides()
        source["programs"][0]["hold_reasons"] = sorted(EXECUTION_ONLY_HOLDS)
        profile = bind_guide_irrigation(base(), source, program_id="program-1", activity_id="row-19",
            device_id="esp32-s3-01", version="test-calculation", reference="Verified synthetic water target")
        sample = observation()
        sample["guide_programs"] = source
        result = present_shadow_dashboard([], NOW, simulation_config=Config(),
            planning_observation=sample, operational_profile=profile)
        self.assertEqual(result["production_fuzzy"]["status"], "READY")
        self.assertFalse(result["production_fuzzy"]["can_dispatch"])
        self.assertEqual(source["programs"][0]["hold_reasons"], sorted(EXECUTION_ONLY_HOLDS))
        for hold in ("crop_binding_not_verified", "guide_edits_changed_since_program_was_saved",
                     "saved_population_mismatch", "unknown_future_hold"):
            source["programs"][0]["hold_reasons"].append(hold)
            self.assertIsNone(resolve_guide_irrigation(profile, source)[0])
            source["programs"][0]["hold_reasons"].pop()
        for method in ("Semprot", "Tabur"):
            source["programs"][0]["activities"][0]["method"] = method
            self.assertIsNone(resolve_guide_irrigation(profile, source)[0])
            from app.configure_guide_irrigation import candidate_status
            candidate = candidate_status(source, "program-1", "row-19", "esp32-s3-01")
            self.assertFalse(candidate["water_target_eligible"])
            self.assertEqual(candidate["water_target_blockers"], ["guide_route_not_irrigation"])

    def test_target_is_taken_from_guide_without_changing_tank_capacity_or_promoting_simulation(self):
        profile = bound()
        self.assertEqual(profile.planning.max_irrigation_l, 1000)
        self.assertEqual(profile.planning.water_curve[-1][1], 5000)
        self.assertEqual(base().planning.max_irrigation_l, 500)
        with self.assertRaisesRegex(ValueError, "existing_operational_profile_required"):
            bind_guide_irrigation(LiveProfile(version="simulation-1", planning=Config()), guides(),
                program_id="program-1", activity_id="row-19", device_id="esp32-s3-01",
                version="invalid", reference="Cannot promote a simulator")

    def test_operational_fuzzy_uses_guide_ceiling_and_remains_non_actuating(self):
        result = present_shadow_dashboard([], NOW, simulation_config=Config(),
            planning_observation=observation(), operational_profile=bound())
        fuzzy = result["fuzzy_preview"]
        self.assertEqual(fuzzy["basis"], "OPERATIONAL_PROFILE")
        self.assertEqual(fuzzy["model_max_irrigation_l"], 1000)
        self.assertAlmostEqual(fuzzy["illustrative_water_l"], fuzzy["score"] * 1000)
        self.assertGreater(fuzzy["illustrative_water_l"], 500)
        self.assertTrue(result["operational_profile"]["calculation_ready"])
        self.assertFalse(result["can_dispatch"])
        self.assertFalse(result["operational_profile"]["can_dispatch"])
        self.assertIsNone(result["calculation"]["water_l"])
        production = result["production_fuzzy"]
        self.assertEqual(production["status"], "READY")
        self.assertEqual(production["dominant_input_classes"], ["LOW"])
        self.assertEqual(production["rule_outputs"], ["HIGH"])
        self.assertAlmostEqual(production["target_water_l"], 844.445)
        self.assertEqual(production["expires_at"], (NOW + timedelta(seconds=60)).isoformat())
        self.assertTrue(production["irrigation_needed"])
        self.assertFalse(production["can_dispatch"])

    def test_production_never_falls_back_to_simulation_or_completed_or_other_day_targets(self):
        for condition in ("missing", "future", "completed", "date_rollover", "stale_guide"):
            sample = observation()
            profile = bound()
            now = NOW
            activity = sample["guide_programs"]["programs"][0]["activities"][0]
            if condition == "missing": profile = None
            if condition == "future": activity["calendar_status"] = "FUTURE"
            if condition == "completed": activity["manual_completion_records"] = [{"program_revision": 2}]
            if condition == "stale_guide": sample["guide_programs"]["programs"][0]["revision"] += 1
            if condition == "date_rollover":
                now = NOW + timedelta(days=1)
                sample["telemetry"]["recorded_at"] = now.isoformat()
            with self.subTest(condition=condition):
                result = present_shadow_dashboard([], now, simulation_config=Config(),
                    planning_observation=sample, operational_profile=profile)
                self.assertEqual(result["production_fuzzy"]["status"], "BLOCKED")
                self.assertIsNone(result["production_fuzzy"]["target_water_l"])
                self.assertFalse(result["operational_profile"]["calculation_ready"])

    def test_production_uses_saved_rules_for_wet_soil_and_stricter_freshness(self):
        sample = observation()
        sample["telemetry"]["soil_2_moisture"] = 90
        sample["telemetry"]["sensor_health"]["soil_2_moisture"]["raw"] = 900
        result = present_shadow_dashboard([], NOW, simulation_config=Config(),
            planning_observation=sample, operational_profile=bound())["production_fuzzy"]
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["dominant_input_classes"], ["HIGH"])
        self.assertEqual(result["rule_outputs"], ["OFF"])
        self.assertEqual(result["target_water_l"], 0)
        self.assertFalse(result["irrigation_needed"])
        profile = bound()
        profile.planning.sensor_data_max_age = 30
        sample["telemetry"]["recorded_at"] = (NOW - timedelta(seconds=31)).isoformat()
        result = present_shadow_dashboard([], NOW, simulation_config=Config(),
            planning_observation=sample, operational_profile=profile)["production_fuzzy"]
        self.assertEqual(result["status"], "BLOCKED")
        self.assertIn("sensor_snapshot_stale", result["blockers"])

    def test_stale_guide_bindings_and_wrong_routes_require_review(self):
        for change in ("revision", "water", "device", "method", "planting", "source"):
            source = copy.deepcopy(guides())
            program = source["programs"][0]
            if change == "revision": program["revision"] += 1
            if change == "water": program["activities"][0]["reference_water_l"] = 5000
            if change == "device": program["config"]["deviceId"] = "other-device"
            if change == "method": program["activities"][0]["method"] = "Semprot"
            if change == "planting": program["config"]["plantingDate"] = "2026-10-16"
            if change == "source": program["source_sha256"] = "b" * 64
            config, status = resolve_guide_irrigation(bound(), source)
            self.assertIsNone(config, change)
            self.assertEqual(status["status"], "REVIEW_REQUIRED", change)

    def test_stale_sensor_does_not_produce_operational_output(self):
        sample = observation()
        sample["telemetry"]["recorded_at"] = (NOW - timedelta(minutes=5)).isoformat()
        result = present_shadow_dashboard([], NOW, simulation_config=Config(),
            planning_observation=sample, operational_profile=bound())
        self.assertIsNone(result["fuzzy_preview"])
        self.assertFalse(result["operational_profile"]["calculation_ready"])
        self.assertIsNone(result["production_fuzzy"]["target_water_l"])

    def test_hst_review_reads_profile_from_original_scope_without_reading_legacy_state(self):
        FakePostgresStore.instances = []
        calls = []
        def read_profile(store):
            calls.append(store.scope)
            return base().model_dump(mode="json") if store.scope.endswith("/source-shadow") else None
        settings = Settings(state_dsn="fake-state", source_dsn="fake-source", mode="SHADOW_MODE",
                            hst_bridge_key="test-only-bridge-key-32-characters")
        with patch("app.api.PostgresStore", FakePostgresStore), patch.object(FakePostgresStore, "runtime_profile", read_profile), patch("app.api.SPFFSource") as source, patch("app.api.HstWorkflow") as workflow:
            source.return_value.inspect.return_value = {"schema_compatible": True}
            workflow.return_value.review_approval.return_value = {"checked": True}
            app = create_app(settings, Config())
            endpoint = next(route.endpoint for route in app.routes if getattr(route, "path", None) == "/hst/approvals")
            try:
                result = endpoint(HstApproval.model_validate({
                    "obligation_id": "a" * 64, "approval_id": "bd713b4c-8532-4d18-8d67-b45afac99ae8",
                    "expected_remaining_g": 100, "actor": "test-admin", "confirmation": "REVIEW_HST_SHADOW_SESSION"}),
                    x_spff_bridge_key=settings.hst_bridge_key)
                self.assertEqual(result, {"checked": True})
            finally:
                for instance in FakePostgresStore.instances:
                    instance.close()
            self.assertEqual(workflow.return_value.review_approval.call_args.kwargs["profile"].version, "test-hydraulics")
        self.assertTrue(calls[0].endswith("/source-shadow"))
        self.assertEqual(FakePostgresStore.instances[0].read_calls, 0)


if __name__ == "__main__":
    unittest.main()
