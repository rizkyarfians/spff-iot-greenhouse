import copy
import unittest
from datetime import datetime, timezone

from app.guide_programs import summarize_program


def saved_program():
    return {"program_id": "test-program", "revision": 1, "guide_revision": 0, "source_sha256": "a" * 64,
            "config": {"cropId": "ubi-jalar", "plantingDate": "2026-10-18", "basis": "plants",
                       "quantity": 20000, "deviceId": "esp32-s3-01"},
            "sheet_snapshot": {"cells": {"F11": {"value": "Pupuk susulan"}}},
            "plan": {"cropName": "Ubi Jalar", "plants": 20000, "area": 5000,
                     "activities": [{"id": "row-11", "hst": 10, "title": "Pemupukan ke-1", "method": "Tabur",
                                     "waterL": None, "warnings": [], "requirements": [
                                         {"row": 11, "product": "Fertiphos", "dose": 2.5, "doseUnit": "gram/tan.",
                                          "amount": 50, "unit": "kg", "waterL": 0, "warnings": []}]}]}}


class GuideProgramTests(unittest.TestCase):
    def setUp(self):
        self.row = saved_program()
        self.now = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)

    def summarize(self, **kwargs):
        return summarize_program(self.row, kwargs.get("completions", []), kwargs.get("edit"),
                                 kwargs.get("crop", "sweet-potato"), kwargs.get("device", "esp32-s3-01"),
                                 kwargs.get("now", self.now), kwargs.get("route", "reference"))

    def test_operator_can_request_drip_for_tabur_fertilizer(self):
        p = self.summarize(route="drip")
        product = p["activities"][0]["products"][0]
        self.assertEqual(product["requested_delivery_route"], "drip")
        self.assertEqual(product["source_method"], "Tabur")
        self.assertEqual(product["product_mass_g"], 50000)
        self.assertFalse(product["can_dispatch"])
        self.assertNotIn("application_route_not_verified_for_drip", p["hold_reasons"])
        self.assertIn("stock_batch_not_configured", p["hold_reasons"])

    def test_foliar_fertilizer_also_gets_requested_drip_route(self):
        self.row["plan"]["activities"][0]["method"] = "Semprot"
        self.row["sheet_snapshot"]["cells"]["F11"]["value"] = "Pupuk foliar"
        self.assertEqual(self.summarize(route="drip")["activities"][0]["products"][0]["requested_delivery_route"], "drip")

    def test_zpt_and_pesticides_not_in_fertilizer_route_override(self):
        for category in ("ZPT", "Insektisida", None):
            self.row["sheet_snapshot"]["cells"]["F11"]["value"] = category
            product = self.summarize(route="drip")["activities"][0]["products"][0]
            self.assertIsNone(product["requested_delivery_route"])
            self.assertFalse(product["is_fertilizer"])

    def test_default_keeps_source_route_and_unknown_route_rejected(self):
        self.assertIsNone(self.summarize()["activities"][0]["products"][0]["requested_delivery_route"])
        with self.assertRaises(ValueError):
            self.summarize(route="anything")

    def test_real_population_not_demo_population(self):
        p = self.summarize()
        self.assertEqual(p["plant_count"], 20000)
        product = p["activities"][0]["products"][0]
        self.assertEqual(product["product_mass_g"], 50000)
        self.assertEqual(product["per_plant_crosscheck_g"], 50000)
        self.assertEqual(product["review_reasons"], [])

    def test_saved_amount_not_scaled_a_second_time(self):
        self.row["config"]["quantity"] = 2000
        self.row["plan"]["plants"] = 2000
        self.row["plan"]["activities"][0]["requirements"][0]["amount"] = 5
        self.assertEqual(self.summarize()["activities"][0]["products"][0]["product_mass_g"], 5000)

    def test_dates_and_hst_use_jakarta_calendar(self):
        p = self.summarize(now=datetime(2026, 10, 30, 18, tzinfo=timezone.utc))
        self.assertEqual(p["current_hst"], 13)
        self.assertEqual(p["activities"][0]["application_date"], "2026-10-28")
        self.assertEqual(p["activities"][0]["calendar_status"], "PAST_DUE")

    def test_hst20_is_november7(self):
        self.row["plan"]["activities"][0]["hst"] = 20
        a = self.summarize()["activities"][0]
        self.assertEqual(a["application_date"], "2026-11-07")
        self.assertEqual(a["calendar_status"], "FUTURE")

    def test_manual_completion_is_not_measured_delivery(self):
        p = self.summarize(completions=[{"activity_id": "row-11", "program_revision": 1, "completed_at": self.now}])
        a = p["activities"][0]
        self.assertEqual(len(a["manual_completion_records"]), 1)
        self.assertIsNone(a["measured_delivered_mass_g"])
        self.assertFalse(a["manual_completion_is_measured_delivery"])

    def test_multiple_products_not_merged(self):
        req = copy.deepcopy(self.row["plan"]["activities"][0]["requirements"][0])
        req.update(product="Nitrea", row=12)
        self.row["plan"]["activities"][0]["requirements"].append(req)
        products = self.summarize()["activities"][0]["products"]
        self.assertEqual(len(products), 2)
        self.assertEqual([p["product_mass_g"] for p in products], [50000, 50000])

    def test_spray_volume_not_assumed_stock_concentration(self):
        self.row["plan"]["activities"][0].update(method="Semprot", waterL=100)
        product = self.summarize()["activities"][0]["products"][0]
        self.assertIsNone(product["stock_concentration_g_l"])
        self.assertFalse(self.summarize()["can_dispatch"])

    def test_changed_guide_edits_require_review(self):
        p = self.summarize(edit={"source_sha256": "a" * 64, "revision": 1})
        self.assertTrue(p["guide_edits_changed"])
        self.assertIn("guide_edits_changed_since_program_was_saved", p["hold_reasons"])

    def test_unknown_crop_or_device_not_bound_implicitly(self):
        self.assertIn("crop_binding_not_verified", self.summarize(crop="tomato")["hold_reasons"])
        self.assertIn("device_binding_not_verified", self.summarize(device="other")["hold_reasons"])

    def test_invalid_plan_reports_review(self):
        self.row["plan"]["plants"] = float("nan")
        self.assertEqual(self.summarize()["status"], "REQUIRES_REVIEW")

    def test_saved_population_and_dose_mismatches_reported(self):
        self.row["plan"]["plants"] = 1000
        p = self.summarize()
        self.assertIn("saved_population_mismatch", p["hold_reasons"])
        self.assertIn("saved_per_plant_mass_mismatch", p["activities"][0]["products"][0]["review_reasons"])

    def test_milliliter_product_never_becomes_grams(self):
        self.row["plan"]["activities"][0]["requirements"][0].update(unit="mL", doseUnit="mL/L", amount=100)
        self.assertIsNone(self.summarize()["activities"][0]["products"][0]["product_mass_g"])
