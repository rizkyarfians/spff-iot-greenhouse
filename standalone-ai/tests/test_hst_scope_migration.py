"""Migration is additive and preserves the old JSONB and existing HST progress."""
import copy
import unittest
from unittest.mock import patch
import psycopg

from app.migrate_hst_scope import migrate
from app.settings import Settings


class FakeResult:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return self.value


class StateDatabase:
    def __init__(self, workflow):
        self.legacy = copy.deepcopy(workflow)
        self.hst = None
        self.statements = []
        self.inserted = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, statement, parameters=None):
        self.statements.append(statement)
        if statement.startswith("SET LOCAL"):
            return FakeResult(None)
        if statement.startswith("SELECT payload->"):
            scope = parameters[0]
            if scope.endswith("/hst-v1"):
                return FakeResult((copy.deepcopy(self.hst),) if self.hst is not None else None)
            return FakeResult((copy.deepcopy(self.legacy),))
        if statement.startswith("INSERT INTO spff_ai.engine_state"):
            if self.hst is not None:
                return FakeResult(None)
            scope, data = parameters
            assert scope.endswith("/hst-v1")
            self.hst = copy.deepcopy(data.obj["hst_workflow"])
            return FakeResult((scope,))
        raise AssertionError("unexpected SQL statement")


class HstScopeMigrationTests(unittest.TestCase):
    def test_copy_hst_only_and_never_touch_legacy_even_when_repeated(self):
        old = {
            "obligations": {"duty-1": {"delivered_g": 500}},
            "proposals": {"duty-1": {"status": "WAITING_APPROVAL"}},
            "approvals": {"acc-1": {"status": "SHADOW_REVIEW_BLOCKED"}},
        }
        fake = StateDatabase(old)
        settings = Settings(state_dsn="test-state-dsn", mode="SHADOW_MODE")
        with patch("app.migrate_hst_scope.Settings.load", return_value=settings):
            with patch.object(psycopg, "connect", return_value=fake):
                migrate()
                self.assertEqual(fake.hst, old)
                fake.hst["approvals"]["acc-2"] = {"status": "SHADOW_REVIEW_BLOCKED"}
                migrate()
        self.assertEqual(fake.legacy, old)
        self.assertIn("acc-2", fake.hst["approvals"])
        self.assertFalse(any(q.lstrip().upper().startswith(("UPDATE", "DELETE", "TRUNCATE"))
                             for q in fake.statements))

    def test_malformed_legacy_hst_section_fails_closed(self):
        fake = StateDatabase({"approvals": ["bad"]})
        settings = Settings(state_dsn="test-state-dsn", mode="SHADOW_MODE")
        with patch("app.migrate_hst_scope.Settings.load", return_value=settings):
            with patch.object(psycopg, "connect", return_value=fake):
                with self.assertRaisesRegex(ValueError, "malformed"):
                    migrate()
        self.assertIsNone(fake.hst)


if __name__ == "__main__":
    unittest.main()
