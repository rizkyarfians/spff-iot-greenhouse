"""Explicit stock binding checks: never infer fertilizer concentration from text alone."""
import copy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import datetime, timezone

from app.stock_bindings import (
    mapping_key, resolve_binding, save_binding, validate_binding_candidate,
)
from app.store import SQLiteStore
from app.dashboard_summary import present_shadow_dashboard
from test_dashboard_summary import NOW, decision


def fixture():
    program = {
        "program_id": "prog-1", "revision": 2, "source_sha256": "a" * 64,
        "hold_reasons": ["volume_session_and_safety_contract_not_verified"],
        "activities": [{
            "activity_id": "row-11", "title": "Pemupukan ke-1", "hst": 10,
            "application_date": "2026-11-01", "calendar_status": "DUE_TODAY",
            "method": "Tabur", "reference_water_l": None,
            "manual_completion_records": [],
            "products": [{
                "source_row": 11, "product": "Fertiphos", "is_fertilizer": True,
                "product_mass_g": 50000, "review_reasons": [],
            }],
        }],
    }
    return {
        "schema_compatible": True,
        "guide_programs": {"programs": [program]},
        "approved_programs": [{
            "recipe_id": "fertiphos-stock-1", "revision": 3,
            "approval_status": "approved", "hst_from": 8, "hst_to": 15,
            "fertilizer_name": "Fertiphos",
            "stock_concentration_g_per_l": 100,
        }],
    }


class StockBindingsTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(scope="test-shadow")
        self.observation = fixture()

    def tearDown(self):
        self.store.close()

    def bind(self):
        return save_binding(self.store, self.observation, "prog-1", "row-11", 11, "fertiphos-stock-1")

    def resolve(self, obs=None):
        o = obs or self.observation
        return resolve_binding(
            o, self.store.read().get("guide_stock_bindings", {}),
            o["guide_programs"]["programs"][0],
            o["guide_programs"]["programs"][0]["activities"][0],
            {"source_row": 11},
        )

    def test_explicit_binding_reads_current_approved_concentration(self):
        self.assertEqual(self.resolve(), (None, "UNBOUND", None))
        record = self.bind()
        self.assertEqual(record["recipe_revision"], 3)
        self.assertAlmostEqual(record["stock_concentration_g_l"], 100)
        self.assertEqual(self.resolve(), (100, "BOUND", "fertiphos-stock-1"))
        self.assertEqual(len(self.store.read()["guide_stock_bindings"]), 1)

    def test_one_time_binding_survives_shadow_sqlite_restart(self):
        with TemporaryDirectory() as folder:
            path = str(Path(folder) / "isolated-shadow.sqlite3")
            first = SQLiteStore(path, scope="site/dev/zone/source-shadow")
            save_binding(first, self.observation, "prog-1", "row-11", 11, "fertiphos-stock-1")
            first.close()
            second = SQLiteStore(path, scope="site/dev/zone/source-shadow")
            try:
                bindings = second.read().get("guide_stock_bindings", {})
                program = self.observation["guide_programs"]["programs"][0]
                activity = program["activities"][0]
                self.assertEqual(
                    resolve_binding(self.observation, bindings, program, activity,
                                    {"source_row": 11}),
                    (100, "BOUND", "fertiphos-stock-1")
                )
            finally:
                second.close()

    def test_recipe_revision_concentration_name_and_approval_fail_closed(self):
        self.bind()
        for change in (
            {"revision": 4},
            {"stock_concentration_g_per_l": 120},
            {"fertilizer_name": "Other fertilizer"},
            {"approval_status": "draft"},
        ):
            bad = copy.deepcopy(self.observation)
            bad["approved_programs"][0].update(change)
            self.assertEqual(self.resolve(bad)[1], "STALE")

    def test_recipe_hst_must_cover_guide_activity(self):
        bad = copy.deepcopy(self.observation)
        bad["approved_programs"][0]["hst_from"] = 11
        with self.assertRaisesRegex(ValueError, "HST"):
            validate_binding_candidate(bad, "prog-1", "row-11", 11, "fertiphos-stock-1")

    def test_guide_revision_hash_and_review_fail_closed(self):
        self.bind()
        for change in (
            {"revision": 3},
            {"source_sha256": "b" * 64},
            {"hold_reasons": ["guide_edits_changed_since_program_was_saved"]},
        ):
            bad = copy.deepcopy(self.observation)
            bad["guide_programs"]["programs"][0].update(change)
            self.assertEqual(self.resolve(bad)[1], "STALE")

    def test_ambiguous_or_mismatched_recipe_rejected_before_write(self):
        bad = copy.deepcopy(self.observation)
        bad["approved_programs"][0]["fertilizer_name"] = "NPK"
        with self.assertRaisesRegex(ValueError, "differs"):
            validate_binding_candidate(bad, "prog-1", "row-11", 11, "fertiphos-stock-1")
        with self.assertRaisesRegex(ValueError, "not found"):
            validate_binding_candidate(self.observation, "prog-1", "row-11", 11, "unknown")
        self.assertEqual(self.store.read().get("guide_stock_bindings"), None)

    def test_scope_key_guards_invalid_ids(self):
        with self.assertRaises(ValueError):
            mapping_key("prog-1", "not-a-row", 11)
        with self.assertRaises(ValueError):
            mapping_key("prog-1", "row-11", True)

    def test_dashboard_calculates_only_explicit_stock_not_pump_operation(self):
        self.bind()
        observation = fixture()
        row = decision()
        observation.update({
            "telemetry": {
                "recorded_at": NOW.isoformat(),
                "received_at": NOW.isoformat(),
            },
            "historical_flow_reference": {
                "basis": "UNVERIFIED_HISTORICAL_COUNTER_DELTAS",
                "water_lpm": 194.39,
                "stock_lpm": 8.79,
                "water_delta_l": 508.667,
                "stock_delta_l": 23.009,
                "duration_seconds": 157,
                "interval_count": 5,
                "started_at": "2026-11-01T06:14:41+00:00",
                "ended_at": "2026-11-01T06:17:18+00:00",
            },
        })
        result = present_shadow_dashboard(
            [row], now=NOW, planning_observation=observation,
            stock_bindings=self.store.read()["guide_stock_bindings"],
        )
        option = result["programs"][0]["activities"][0]["planning_preview"]["product_options"][0]
        self.assertEqual(option["binding_status"], "BOUND")
        self.assertEqual(option["stock_recipe_id"], "fertiphos-stock-1")
        self.assertEqual(option["mass_g"], 50000)
        self.assertEqual(option["stock_l"], 500)
        self.assertAlmostEqual(option["stock_duration_minutes"], 500 / 8.79)
        self.assertEqual(result["decision"]["type"], "HOLD")
        self.assertFalse(result["can_dispatch"])
        self.assertEqual(self.store.read()["decisions"], {})

        observation["approved_programs"][0]["revision"] += 1
        stale = present_shadow_dashboard(
            [row], now=NOW, planning_observation=observation,
            stock_bindings=self.store.read()["guide_stock_bindings"],
        )
        option = stale["programs"][0]["activities"][0]["planning_preview"]["product_options"][0]
        self.assertEqual(option["binding_status"], "STALE")
        self.assertIsNone(option["stock_l"])


if __name__ == "__main__":
    unittest.main()
