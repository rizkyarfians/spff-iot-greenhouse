"""No simulated/pump/flow data may silently count as delivered irrigation."""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from app.store import SQLiteStore
from app.water_carryover import (
    new_water_plan, credit_device_session, present_carryover,
)

NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
SITE, DEVICE = "greenhouse-01", "esp32-s3-01"


def source_dashboard():
    return {
        "planning_source": "POSTGRES_READ_ONLY",
        "planning_status": "CURRENT",
        "can_dispatch": False,
        "fuzzy_preview": {
            "basis": "SIMULATION_PROFILE",
            "illustrative_water_l": 374.15,
            "recorded_at": NOW.isoformat(),
            "config_version": "simulation-1",
        },
    }


def completed_water_session():
    start = NOW + timedelta(minutes=1)
    finish = NOW + timedelta(minutes=2)
    return {
        "source": "SPFF_COMPLETED_SESSION_EVENT",
        "session_id": str(uuid4()), "site_id": SITE,
        "device_id": DEVICE, "status": "completed",
        "pumps_off": True, "target_stock_l": 0,
        "actual_stock_l": 0, "actual_water_l": 200.0,
        "started_at": start.isoformat(),
        "finished_at": finish.isoformat(),
        "event_recorded_at": finish.isoformat(),
        "event_received_at": (finish+timedelta(seconds=2)).isoformat(),
        "message_id": str(uuid4()), "sequence": 8,
    }


class WaterCarryoverTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore()
        self.plan = new_water_plan(self.store, source_dashboard(), SITE, DEVICE, now=NOW)

    def tearDown(self):
        self.store.close()

    def test_plan_no_sessions_never_claims_delivery(self):
        summary = present_carryover(self.store.read(), now=NOW)
        self.assertEqual(summary["status"], "ACTIVE")
        self.assertEqual(summary["frozen_fuzzy_target_l"], 374.15)
        self.assertEqual(summary["device_reported_delivered_l"], 0)
        self.assertEqual(summary["remaining_for_reassessment_l"], 374.15)
        self.assertEqual(summary["credited_session_count"], 0)
        self.assertFalse(summary["can_dispatch"])

    def test_device_completed_proof_credits_once_and_persists(self):
        proof = completed_water_session()
        credit_device_session(self.store, self.plan["plan_id"], proof, now=NOW+timedelta(minutes=4))
        summary = present_carryover(self.store.read(), now=NOW+timedelta(minutes=4))
        self.assertEqual(summary["device_reported_delivered_l"], 200)
        self.assertAlmostEqual(summary["remaining_for_reassessment_l"], 174.15)
        self.assertEqual(summary["credited_session_count"], 1)
        credit_device_session(self.store, self.plan["plan_id"], proof, now=NOW+timedelta(minutes=5))
        self.assertEqual(present_carryover(self.store.read(), now=NOW)["credited_session_count"], 1)

    def test_same_session_with_changed_evidence_is_not_idempotent(self):
        proof = completed_water_session()
        credit_device_session(self.store, self.plan["plan_id"], proof, now=NOW+timedelta(minutes=4))
        for changed in ({"actual_water_l": 250.0},
                        {"message_id": str(uuid4())},
                        {"sequence": 9}):
            with self.subTest(changed=changed):
                with self.assertRaises(ValueError):
                    credit_device_session(self.store, self.plan["plan_id"],
                                          {**proof, **changed}, now=NOW+timedelta(minutes=5))
        summary = present_carryover(self.store.read(), now=NOW)
        self.assertEqual(summary["credited_session_count"], 1)
        self.assertEqual(summary["device_reported_delivered_l"], 200)

    def test_tomorrow_requires_new_reassessment_no_pump_schedule(self):
        credit_device_session(self.store, self.plan["plan_id"], completed_water_session(),
                              now=NOW+timedelta(minutes=4))
        summary = present_carryover(self.store.read(), now=NOW+timedelta(days=1))
        self.assertEqual(summary["status"], "CARRY_OVER_REVIEW")
        self.assertAlmostEqual(summary["remaining_for_reassessment_l"], 174.15)
        self.assertTrue(summary["requires_fresh_reassessment"])
        self.assertFalse(summary["can_dispatch"])
        self.assertEqual(present_carryover(self.store.read(), now=NOW+timedelta(days=3))["status"],
                         "REVIEW_REQUIRED")

    def test_daily_plan_idempotent_and_target_is_immutable(self):
        candidate = source_dashboard()
        candidate["fuzzy_preview"]["illustrative_water_l"] = 400
        existing = new_water_plan(self.store, candidate, SITE, DEVICE, now=NOW)
        self.assertEqual(existing["plan_id"], self.plan["plan_id"])
        self.assertEqual(existing["target_l"], 374.15)

    def test_reject_unproven_or_wrong_scope_or_fertilizer_credit(self):
        original = completed_water_session()
        changes = (
            {"source": "HISTORICAL_FLOW_COUNTER_DELTA"},
            {"status": "running"},
            {"pumps_off": False},
            {"actual_stock_l": 0.1},
            {"target_stock_l": 1},
            {"site_id": "other-site"},
            {"device_id": "other-device"},
            {"event_recorded_at": NOW.isoformat()},
            {"actual_water_l": 0},
            {"actual_water_l": -1},
            {"message_id": ""},
            {"sequence": -1},
        )
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    credit_device_session(self.store, self.plan["plan_id"],
                                          {**original, **change}, now=NOW+timedelta(minutes=4))
        self.assertEqual(present_carryover(self.store.read(), now=NOW)["credited_session_count"], 0)

    def test_session_before_plan_is_not_auto_credited(self):
        proof = completed_water_session()
        prior = NOW - timedelta(minutes=5)
        proof["started_at"] = prior.isoformat()
        with self.assertRaisesRegex(ValueError, "after plan creation"):
            credit_device_session(self.store, self.plan["plan_id"], proof,
                                  now=NOW+timedelta(minutes=4))

    def test_plan_requires_fresh_postgres_and_no_simulation_input(self):
        for change in (
            {"planning_source": "DECISION_SNAPSHOT"},
            {"planning_status": "STALE"},
            {"can_dispatch": True},
            {"fuzzy_preview": None},
        ):
            store = SQLiteStore()
            try:
                with self.subTest(change=change):
                    with self.assertRaises(ValueError):
                        new_water_plan(store, {**source_dashboard(), **change}, SITE, DEVICE, now=NOW)
            finally:
                store.close()

    def test_stale_fuzzy_sample_cannot_create_plan(self):
        dashboard = source_dashboard()
        dashboard["fuzzy_preview"]["recorded_at"] = (NOW-timedelta(minutes=4)).isoformat()
        store = SQLiteStore()
        try:
            with self.assertRaises(ValueError):
                new_water_plan(store, dashboard, SITE, DEVICE, now=NOW)
        finally:
            store.close()

    def test_duplicate_session_across_plans_rejected(self):
        proof = completed_water_session()
        credit_device_session(self.store, self.plan["plan_id"], proof, now=NOW+timedelta(minutes=4))
        other = new_water_plan(
            self.store,
            {**source_dashboard(), "fuzzy_preview": {
                **source_dashboard()["fuzzy_preview"],
                "recorded_at": (NOW+timedelta(days=1)).isoformat(),
            }},
            SITE, DEVICE, now=NOW+timedelta(days=1)
        )
        with self.assertRaises(ValueError):
            credit_device_session(self.store, other["plan_id"], proof,
                                  now=NOW+timedelta(days=1, minutes=4))

    def test_persistence_across_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "shadow.sqlite3")
            first = SQLiteStore(path, "scope")
            try:
                plan = new_water_plan(first, source_dashboard(), SITE, DEVICE, now=NOW)
                credit_device_session(first, plan["plan_id"], completed_water_session(),
                                      now=NOW+timedelta(minutes=4))
            finally:
                first.close()
            reopened = SQLiteStore(path, "scope")
            try:
                summary = present_carryover(reopened.read(), now=NOW+timedelta(days=1))
                self.assertEqual(summary["credited_session_count"], 1)
                self.assertAlmostEqual(summary["remaining_for_reassessment_l"], 174.15)
            finally:
                reopened.close()

    def test_empty_state_is_not_a_water_plan(self):
        summary = present_carryover({}, now=NOW)
        self.assertEqual(summary["status"], "NO_PLAN")
        self.assertIsNone(summary["remaining_for_reassessment_l"])
        self.assertFalse(summary["can_dispatch"])


if __name__ == "__main__":
    unittest.main()
