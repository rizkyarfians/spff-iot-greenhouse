"""Dashboard must present stored real SHADOW evidence, never fabricate delivery."""
import unittest
from datetime import datetime, timedelta, timezone
from app.dashboard_summary import present_shadow_dashboard
from app.models import Config

NOW = datetime(2026, 11, 1, 3, 0, tzinfo=timezone.utc)


def decision(at=NOW):
    return {
        "decision_id": "real-123", "mode": "SHADOW_MODE", "simulation": False,
        "at": at.isoformat(), "type": "HOLD", "proposed_action": "FERTIGATE",
        "hold_reasons": ["manual_mode_blocks_automatic_start"],
        "configuration_version": None,
        "pump_feedback": {
            "status": "REPORTED_OFF_FRESH", "reported_off": True,
            "boot_matches": True, "water_pump": False, "fert_pump": False,
            "reported_at": at.isoformat(), "received_at": at.isoformat()
        },
        "telemetry": {},
        "plan": None,
        "fuzzy": None,
        "obligations": [],
        "input_snapshot": {
            "telemetry": {
                "recorded_at": at.isoformat(), "soil_1_moisture": 59,
                "tank_water_level_pct": 80, "tank_fert_level_pct": 67,
                "raw_payload": {"secret": "must-not-leak"}},
            "device_status": {"mode": "manual"},
            "guide_programs": {"programs": [{
                "program_id": "prog-1", "crop_name": "Ubi jalar", "current_hst": 14,
                "plant_count": 20000, "config": {"plantingDate": "2026-10-18"},
                "status": "PREVIEW_ONLY", "hold_reasons": [],
                "activities": [{
                    "activity_id": "row-11", "title": "Pemupukan", "hst": 10,
                    "application_date": "2026-10-28", "calendar_status": "PAST_DUE",
                    "method": "Kocor", "reference_water_l": 100,
                    "manual_completion_records": [],
                    "products": [{"source_row": 11, "product": "Pupuk A", "amount": 50,
                                  "unit": "kg", "is_fertilizer": True,
                                  "product_mass_g": 50000, "review_reasons": []}]
                }]
            }]}
        }
    }


class DashboardSummaryTests(unittest.TestCase):
    def test_recent_real_shadow_renders_needs_not_delivered_dose(self):
        value = present_shadow_dashboard([decision()], NOW)
        self.assertEqual(value["status"], "CURRENT")
        self.assertEqual(value["decision"]["proposed_action"], "FERTIGATE")
        self.assertFalse(value["can_dispatch"])
        self.assertTrue(value["feedback"]["boot_matches"])
        product = value["programs"][0]["activities"][0]["products"][0]
        self.assertEqual(product["target_mass_g"], 50000)
        self.assertIsNone(product["credited_mass_g"])
        self.assertIsNone(product["remaining_mass_g"])
        self.assertNotIn("secret", str(value))

    def test_soil_sensor_quality_and_control_source_are_explicit(self):
        row = decision()
        sample = row["input_snapshot"]["telemetry"]
        sample["soil_1_moisture"] = None
        sample["soil_2_moisture"] = 48.9
        sample["sensor_health"] = {
            "soil_1_moisture": {"valid": False, "reason": "stale_or_missing"},
            "soil_2_moisture": {"valid": True},
        }
        row["input_snapshot"]["automatic_control"] = {"water_sensor_key": "soil_1_moisture"}
        result = present_shadow_dashboard([row], NOW)["sensors"]
        self.assertIsNone(result["soil_moisture_pct"])
        self.assertFalse(result["soil_1_valid"])
        self.assertEqual(result["soil_2_moisture_pct"], 48.9)
        self.assertTrue(result["soil_2_valid"])
        self.assertEqual(result["control_moisture_source"], "soil_1_moisture")
        # Never promote sensor 2 to sensor 1, or consider a numeric sensor
        # reading trusted if the health flag explicitly rejects it.
        sample["soil_1_moisture"] = 59
        self.assertIsNone(present_shadow_dashboard([row], NOW)["sensors"]["soil_moisture_pct"])
        row["input_snapshot"]["automatic_control"]["water_sensor_key"] = "unknown_sensor"
        self.assertIsNone(present_shadow_dashboard([row], NOW)["sensors"]["control_moisture_source"])

    def test_sensor_without_health_is_not_assumed_valid(self):
        result = present_shadow_dashboard([decision()], NOW)["sensors"]
        self.assertIsNone(result["soil_moisture_pct"])
        self.assertIsNone(result["soil_2_moisture_pct"])
        self.assertIsNone(result["soil_1_valid"])
        self.assertIsNone(result["soil_2_valid"])

    def test_fuzzy_simulation_preview_never_promotes_operational_plan(self):
        row = decision()
        row["input_snapshot"]["automatic_control"] = {
            "water_sensor_key": "soil_2_moisture",
            "revision": 108, "acknowledged_revision": 108,
            "acknowledgement_status": "applied",
        }
        sample = row["input_snapshot"]["telemetry"]
        sample["soil_2_moisture"] = 25.2
        sample["sensor_health"] = {"soil_2_moisture": {
            "valid": True, "raw": 252, "rawAgeMs": 1000,
            "rawFresh": True, "lastPollOk": True, "pollBootId": "boot-1",
            "controlValid": True,
        }}
        config = Config()
        dashboard = present_shadow_dashboard([row], NOW, simulation_config=config)
        preview = dashboard["fuzzy_preview"]
        self.assertEqual(preview["input_key"], "soil_2_moisture")
        self.assertEqual(preview["moisture_pct"], 25.2)
        self.assertGreater(preview["score"], 0)
        self.assertGreater(preview["illustrative_water_l"], 0)
        self.assertEqual(preview["basis"], "SIMULATION_PROFILE")
        self.assertEqual(dashboard["decision"]["type"], "HOLD")
        self.assertIsNone(dashboard["calculation"]["fuzzy_score"])
        self.assertIsNone(dashboard["calculation"]["water_l"])
        self.assertFalse(dashboard["can_dispatch"])

        # Missing raw freshness must not produce a credible-looking preview.
        sample["sensor_health"]["soil_2_moisture"].pop("rawFresh")
        missing_freshness = present_shadow_dashboard([row], NOW, simulation_config=config)
        self.assertIsNone(missing_freshness["fuzzy_preview"])
        self.assertIn("sensor_raw_poll_not_verified", missing_freshness["fuzzy_preview_blockers"])
        sample["sensor_health"]["soil_2_moisture"]["rawFresh"] = True
        sample["sensor_health"]["soil_2_moisture"]["raw"] = 800
        self.assertIsNone(present_shadow_dashboard(
            [row], NOW, simulation_config=config)["fuzzy_preview"])
        invalid_raw = present_shadow_dashboard([row], NOW, simulation_config=config)
        self.assertIn("sensor_raw_value_unverified", invalid_raw["fuzzy_preview_blockers"])
        sample["sensor_health"]["soil_2_moisture"]["raw"] = 252

        # An unacknowledged control revision cannot be used for a preview.
        row["input_snapshot"]["automatic_control"]["acknowledged_revision"] = 107
        unacknowledged = present_shadow_dashboard([row], NOW, simulation_config=config)
        self.assertIsNone(unacknowledged["fuzzy_preview"])
        self.assertIn("control_config_not_acknowledged", unacknowledged["fuzzy_preview_blockers"])

    def test_current_postgres_planning_is_independent_of_stale_decision(self):
        row = decision(NOW-timedelta(minutes=15))
        observation = {
            **row["input_snapshot"],
            "schema_compatible": True,
            "telemetry": {
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
                "soil_2_moisture": 25.2,
                "sensor_health": {"soil_2_moisture": {
                    "valid": True, "controlValid": True, "raw": 252,
                    "rawAgeMs": 1000, "rawFresh": True,
                    "lastPollOk": True, "pollBootId": "boot-1",
                }},
            },
            "automatic_control": {
                "water_sensor_key": "soil_2_moisture",
                "revision": 108, "acknowledged_revision": 108,
                "acknowledgement_status": "applied",
            },
        }
        observation["guide_programs"] = {
            "programs": [{
                **row["input_snapshot"]["guide_programs"]["programs"][0],
                "activities": [{
                    **row["input_snapshot"]["guide_programs"]["programs"][0]["activities"][0],
                    "reference_water_l": None,
                }],
            }],
        }
        observation["historical_flow_reference"] = {
            "basis": "UNVERIFIED_HISTORICAL_COUNTER_DELTAS",
            "water_lpm": 194.39, "stock_lpm": 8.79,
            "water_delta_l": 508.667, "stock_delta_l": 23.009,
            "duration_seconds": 157, "interval_count": 5,
            "started_at": "2026-11-01T06:14:41+00:00",
            "ended_at": "2026-11-01T06:17:18+00:00",
        }
        result = present_shadow_dashboard(
            [row], NOW, Config(), planning_observation=observation,
        )
        self.assertEqual(result["status"], "STALE")
        self.assertEqual(result["planning_status"], "CURRENT")
        self.assertEqual(result["planning_source"], "POSTGRES_READ_ONLY")
        self.assertIsNotNone(result["fuzzy_preview"])
        planned = result["programs"][0]["activities"][0]["planning_preview"]
        self.assertEqual(planned["water_source"], "FUZZY_SIMULATION")
        self.assertGreater(planned["water_l"], 0)
        self.assertAlmostEqual(planned["water_duration_minutes"], planned["water_l"] / 194.39)
        self.assertIsNone(planned["product_options"][0]["stock_l"])
        self.assertFalse(result["can_dispatch"])
        self.assertEqual(result["decision"]["type"], "HOLD")

        observation["telemetry"]["recorded_at"] = (NOW-timedelta(minutes=10)).isoformat()
        observation["telemetry"]["received_at"] = (NOW-timedelta(minutes=10)).isoformat()
        stale = present_shadow_dashboard([row], NOW, Config(), planning_observation=observation)
        self.assertEqual(stale["planning_status"], "STALE")
        self.assertIsNone(stale["fuzzy_preview"])
        self.assertIn("sensor_snapshot_stale", stale["fuzzy_preview_blockers"])
        self.assertIsNone(stale["programs"][0]["activities"][0]["planning_preview"]["water_l"])

    def test_fuzzy_preview_without_saved_decision_does_not_invent_execution(self):
        row = decision()
        observation = {
            **row["input_snapshot"],
            "schema_compatible": True,
            "telemetry": {
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
                "soil_2_moisture": 25.2,
                "sensor_health": {"soil_2_moisture": {
                    "valid": True, "controlValid": True, "raw": 252,
                    "rawAgeMs": 1000, "rawFresh": True,
                    "lastPollOk": True, "pollBootId": "boot-1",
                }},
            },
            "automatic_control": {
                "water_sensor_key": "soil_2_moisture",
                "revision": 108, "acknowledged_revision": 108,
                "acknowledgement_status": "applied",
            },
        }
        result = present_shadow_dashboard([], NOW, Config(), planning_observation=observation)
        self.assertEqual(result["status"], "NO_DECISION")
        self.assertEqual(result["planning_status"], "CURRENT")
        self.assertIsNotNone(result["fuzzy_preview"])
        self.assertFalse(result["can_dispatch"])
        self.assertIsNone(result["decision"]["type"])
        self.assertIsNone(result["calculation"]["water_l"])

    def test_dry_guide_activity_is_never_assigned_fuzzy_irrigation_volume(self):
        row = decision()
        row["input_snapshot"]["guide_programs"]["programs"][0]["activities"][0][
            "reference_water_l"] = None
        row["input_snapshot"]["guide_programs"]["programs"][0]["activities"][0][
            "method"] = "Tabur"
        row["input_snapshot"]["automatic_control"] = {
            "water_sensor_key": "soil_2_moisture", "revision": 108,
            "acknowledged_revision": 108, "acknowledgement_status": "applied",
        }
        row["input_snapshot"]["telemetry"].update({
            "soil_2_moisture": 25.2,
            "sensor_health": {"soil_2_moisture": {
                "valid": True, "controlValid": True, "raw": 252,
                "rawAgeMs": 1000, "rawFresh": True,
                "lastPollOk": True, "pollBootId": "boot-1",
            }},
        })
        result = present_shadow_dashboard([row], NOW, Config())
        self.assertIsNotNone(result["fuzzy_preview"])
        self.assertIsNone(result["programs"][0]["activities"][0]["planning_preview"]["water_l"])

    def test_generic_approved_recipe_never_assumed_bound_to_guide_product(self):
        row = decision()
        observation = {**row["input_snapshot"], "schema_compatible": True}
        observation["approved_programs"] = [{
            "fertilizer_name": "Pupuk A",
            "stock_concentration_g_per_l": 100,
        }]
        result = present_shadow_dashboard([row], NOW, planning_observation=observation)
        planned = result["programs"][0]["activities"][0]["planning_preview"]
        self.assertIsNone(planned["product_options"][0]["stock_l"])
        self.assertIn("saved_stock_recipe_not_bound_to_guide_product", planned["reasons"])
        self.assertFalse(planned["can_dispatch"])

    def test_fuzzy_simulation_does_not_run_with_non_simulation_profile(self):
        row = decision()
        row["input_snapshot"]["automatic_control"] = {
            "water_sensor_key": "soil_1_moisture",
            "revision": 1, "acknowledged_revision": 1,
            "acknowledgement_status": "applied",
        }
        sample = row["input_snapshot"]["telemetry"]
        sample["sensor_health"] = {"soil_1_moisture": {
            "valid": True, "raw": 590, "rawAgeMs": 3000,
            "rawFresh": True, "lastPollOk": True, "pollBootId": "boot-1",
        }}
        self.assertIsNone(present_shadow_dashboard(
            [row], NOW, simulation_config=Config(simulation_only=False))["fuzzy_preview"])
        self.assertIsNone(present_shadow_dashboard([row], NOW)["fuzzy_preview"])

    def test_manual_completion_cannot_be_shown_as_measured_delivery(self):
        row = decision()
        row["input_snapshot"]["guide_programs"]["programs"][0]["activities"][0][
            "manual_completion_records"] = [{"completed_at": NOW.isoformat()}]
        row["obligations"] = [{
            "program_id": "prog-1", "activity_id": "row-11", "source_row": 11,
            "delivered_g": 0, "remaining_g": 50000, "status": "REQUIRES_REVIEW"}]
        product = present_shadow_dashboard([row], NOW)["programs"][0]["activities"][0]["products"][0]
        self.assertIsNone(product["credited_mass_g"])
        self.assertIsNone(product["remaining_mass_g"])
        self.assertTrue(product["requires_review"])

    def test_bound_ledger_can_show_credit_but_not_physical_claim(self):
        row = decision()
        row["obligations"] = [{
            "program_id": "prog-1", "activity_id": "row-11", "source_row": 11,
            "delivered_g": 200, "remaining_g": 49800, "status": "PARTIAL", "verified_session_count": 1}]
        product = present_shadow_dashboard([row], NOW)["programs"][0]["activities"][0]["products"][0]
        self.assertEqual(product["credited_mass_g"], 200)
        self.assertEqual(product["remaining_mass_g"], 49800)

    def test_completed_obligation_stays_visible_in_progress(self):
        row = decision()
        row["obligations"] = []
        row["obligation_progress"] = [{
            "program_id": "prog-1", "activity_id": "row-11", "source_row": 11,
            "delivered_g": 50000, "remaining_g": 0, "status": "COMPLETED",
            "verified_session_count": 1,
        }]
        product = present_shadow_dashboard([row], NOW)["programs"][0]["activities"][0]["products"][0]
        self.assertEqual(product["credited_mass_g"], 50000)
        self.assertEqual(product["remaining_mass_g"], 0)

    def test_zero_initialized_obligation_is_not_delivery_proof(self):
        row = decision()
        row["obligations"] = [{
            "program_id": "prog-1", "activity_id": "row-11", "source_row": 11,
            "delivered_g": 0, "remaining_g": 50000,
            "verified_session_count": 0, "status": "PENDING"}]
        product = present_shadow_dashboard([row], NOW)["programs"][0]["activities"][0]["products"][0]
        self.assertIsNone(product["credited_mass_g"])
        self.assertIsNone(product["remaining_mass_g"])

    def test_stale_never_claims_live_pump_state(self):
        row = decision(NOW-timedelta(minutes=10))
        value = present_shadow_dashboard([row], NOW)
        self.assertEqual(value["status"], "STALE")
        self.assertIsNone(value["feedback"]["water_pump"])
        self.assertFalse(value["feedback"]["reported_off"])
        self.assertFalse(value["feedback"]["boot_matches"])

    def test_feedback_expires_even_when_decision_is_recent(self):
        row = decision(NOW-timedelta(seconds=27))
        value = present_shadow_dashboard([row], NOW)
        self.assertEqual(value["status"], "CURRENT")
        self.assertIsNone(value["feedback"]["water_pump"])
        self.assertFalse(value["feedback"]["reported_off"])

    def test_simulated_or_dry_run_decisions_are_excluded(self):
        row = decision()
        row["mode"] = "DRY_RUN"
        value = present_shadow_dashboard([row], NOW)
        self.assertEqual(value["status"], "NO_DECISION")
        self.assertEqual(value["programs"], [])
        self.assertIsNone(value["calculation"]["water_l"])
        self.assertFalse(value["can_dispatch"])

    def test_newer_real_decision_selected_without_json_key_assumptions(self):
        old = decision(NOW-timedelta(seconds=50))
        old["decision_id"] = "z"
        new = decision(NOW-timedelta(seconds=2))
        new["decision_id"] = "a"
        new["proposed_action"] = "OFF"
        result = present_shadow_dashboard([old,new], NOW)
        self.assertEqual(result["evaluated_at"], new["at"])
        self.assertEqual(result["decision"]["proposed_action"], "OFF")

    def test_fuzzy_irrigation_uses_proposal_volume_and_no_pupuk(self):
        row = decision()
        row["plan"] = {"water_l": 34.5, "stock_l": 0, "mass_g": 0,
                       "duration_seconds": 45.0}
        row["fuzzy"] = {"score": 0.23}
        result = present_shadow_dashboard([row], NOW)
        self.assertEqual(result["calculation"]["water_l"], 34.5)
        self.assertEqual(result["calculation"]["stock_l"], 0)
        self.assertEqual(result["calculation"]["fuzzy_score"], 0.23)
        self.assertFalse(result["can_dispatch"])


if __name__ == "__main__":
    unittest.main()
