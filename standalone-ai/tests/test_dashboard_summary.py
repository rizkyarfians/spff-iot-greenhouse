"""Dashboard must present stored real SHADOW evidence, never fabricate delivery."""
import unittest
from datetime import datetime, timedelta, timezone
from app.dashboard_summary import present_shadow_dashboard

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
