import copy
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.hst_workflow import HstWorkflow, HstWorkflowConflict
from app.store import SQLiteStore
from test_live_engine import real_observation


class HstWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore()
        self.workflow = HstWorkflow(self.store, "greenhouse-01", "esp32-s3-01", "soil-1")
        self.now = datetime(2026, 10, 28, 1, tzinfo=timezone.utc)
        self.observation = real_observation(self.now)
        self.guide = self.observation["guide_programs"]

    def tearDown(self):
        self.store.close()

    def test_no_schedule_makes_no_write_and_no_decision(self):
        initial = copy.deepcopy(self.store.read())
        guide = {"status": "READ_ONLY_PREVIEW", "programs": []}
        self.assertEqual(self.workflow.scan(guide, now=self.now)["status"], "NO_SCHEDULE")
        self.assertEqual(self.store.read(), initial)
        self.assertEqual(self.workflow.proposals()["proposals"], [])

    def test_missed_hst_on_first_import_not_assumed_unpaid(self):
        self.guide["programs"][0]["activities"][0]["calendar_status"] = "PAST_DUE"
        self.workflow.scan(self.guide, now=self.now)
        self.assertEqual(self.workflow.proposals()["proposals"], [])
        self.assertNotIn("hst_workflow", self.store.read())

    def test_one_hst_proposal_not_repeated_per_sensor_sample(self):
        a = self.workflow.scan(self.guide, now=self.now)
        self.assertEqual(a["created"], 1)
        before = copy.deepcopy(self.store.read())
        self.observation["telemetry"]["message_id"] = "new-frame"
        b = self.workflow.scan(self.guide, now=self.now+timedelta(minutes=5))
        self.assertEqual(b["created"], 0)
        self.assertEqual(before, self.store.read())
        proposals = self.workflow.proposals()["proposals"]
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["target_g"], 50000)
        self.assertEqual(proposals[0]["delivered_g"], 0)
        self.assertEqual(proposals[0]["remaining_g"], 50000)
        self.assertEqual(proposals[0]["status"], "WAITING_APPROVAL")
        self.assertEqual(self.store.read()["decisions"], {})
        self.assertNotIn("live", self.store.read())

    def test_one_approval_is_shadow_only_and_replayed_idempotently(self):
        self.workflow.scan(self.guide, now=self.now)
        proposal = self.workflow.proposals()["proposals"][0]
        approval_id = str(uuid4())
        args = dict(obligation_id=proposal["obligation_id"],
                    approval_id=approval_id, actor="field-operator",
                    expected_remaining_g=50000, observation=self.observation, now=self.now)
        first = self.workflow.review_approval(**args)
        self.assertEqual(first["status"], "SHADOW_REVIEW_BLOCKED")
        self.assertFalse(first["can_dispatch"])
        self.assertFalse(first["command_created"])
        self.assertIsNone(first["plan"])
        self.assertIn("soil_2_control_evidence_invalid", first["hold_reasons"])
        self.assertEqual(self.workflow.review_approval(**args), first)
        self.assertEqual(self.workflow.proposals()["proposals"][0]["approval_count"], 1)
        self.assertEqual(self.store.read()["decisions"], {})

    def test_next_day_requires_distinct_approval_and_keeps_remaining(self):
        self.workflow.scan(self.guide, now=self.now)
        proposal = self.workflow.proposals()["proposals"][0]
        oid = proposal["obligation_id"]
        first = self.workflow.review_approval(
            obligation_id=oid, approval_id=str(uuid4()), actor="operator",
            expected_remaining_g=50000, observation=self.observation, now=self.now)
        # A reported session is NOT credited by operator review. Only verified
        # bound feedback may change delivered_g.
        self.assertEqual(self.workflow.proposals()["proposals"][0]["remaining_g"], 50000)
        tomorrow = self.now + timedelta(days=1)
        later = real_observation(tomorrow, due_today=False)
        self.workflow.scan(later["guide_programs"], now=tomorrow)
        second = self.workflow.review_approval(
            obligation_id=oid, approval_id=str(uuid4()), actor="operator",
            expected_remaining_g=50000, observation=later, now=tomorrow)
        self.assertNotEqual(first["approval_id"], second["approval_id"])
        self.assertNotEqual(first["approval_date"], second["approval_date"])
        self.assertEqual(self.workflow.proposals()["proposals"][0]["approval_count"], 2)

    def test_partial_verified_progress_is_carried_to_next_day(self):
        self.workflow.scan(self.guide, now=self.now)
        oid = self.workflow.proposals()["proposals"][0]["obligation_id"]
        # Future verified-device-feedback adapter alone will update this
        # authoritative V2 progress; approval never does so.
        with self.store.transaction() as state:
            state["hst_workflow"]["obligations"][oid]["delivered_g"] = 20000
            state["hst_workflow"]["obligations"][oid]["status"] = "PARTIAL"
        tomorrow = self.now + timedelta(days=1)
        later = real_observation(tomorrow, due_today=False)
        self.workflow.scan(later["guide_programs"], now=tomorrow)
        proposal = self.workflow.proposals()["proposals"][0]
        self.assertEqual(proposal["status"], "PARTIAL_WAITING_APPROVAL")
        self.assertEqual(proposal["target_g"], 50000)
        self.assertEqual(proposal["delivered_g"], 20000)
        self.assertEqual(proposal["remaining_g"], 30000)
        self.assertEqual(proposal["approval_count"], 0)

    def test_stale_approval_amount_rejected(self):
        self.workflow.scan(self.guide, now=self.now)
        oid = self.workflow.proposals()["proposals"][0]["obligation_id"]
        with self.assertRaisesRegex(HstWorkflowConflict, "progress_changed"):
            self.workflow.review_approval(
                obligation_id=oid, approval_id=str(uuid4()), actor="operator",
                expected_remaining_g=25000, observation=self.observation, now=self.now)
        self.assertEqual(self.workflow.proposals()["proposals"][0]["approval_count"], 0)

    def test_changed_program_blocks_without_replacing_existing_target(self):
        self.workflow.scan(self.guide, now=self.now)
        self.guide["programs"][0]["activities"][0]["products"][0]["product_mass_g"] = 60000
        self.workflow.scan(self.guide, now=self.now + timedelta(minutes=5))
        p = self.workflow.proposals()["proposals"][0]
        self.assertEqual(p["target_g"], 50000)
        self.assertEqual(p["status"], "REQUIRES_REVIEW")
        self.assertIn("program_changed_after_obligation_created", p["review_reasons"])
