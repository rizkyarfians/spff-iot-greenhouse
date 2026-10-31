"""Opt-in integration against an EMPTY, DISPOSABLE database; never auto-target SPFF."""
import os
import unittest
from pathlib import Path
from uuid import uuid4

from app.store import PostgresStore


@unittest.skipUnless(os.getenv("AI_TEST_DATABASE_DSN"), "disposable PostgreSQL test DSN not configured")
class PostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.dsn = dsn = os.environ["AI_TEST_DATABASE_DSN"]
        with psycopg.connect(dsn) as connection:
            # Explicitly refuse an operational SPFF DB, even if a DSN was supplied accidentally.
            existing = connection.execute("SELECT to_regnamespace('spff')").fetchone()[0]
            if existing is not None:
                raise RuntimeError("integration tests require a disposable database without schema spff")
            connection.execute((Path(__file__).resolve().parents[1] / "migrations/001_ai_state.sql").read_text())

    def test_migration_transaction_persistence_and_rollback(self):
        scope = "test/" + str(uuid4())
        store = PostgresStore(self.dsn, scope)
        with store.transaction() as state:
            state["test"] = 1
        self.assertEqual(store.read()["test"], 1)
        with self.assertRaises(RuntimeError):
            with store.transaction() as state:
                state["test"] = 2
                raise RuntimeError("rollback")
        self.assertEqual(store.read()["test"], 1)

    def test_engine_recovers_and_deduplicates_feedback(self):
        from datetime import datetime, timedelta, timezone
        from app.engine import Engine
        from app.models import Config
        from app.scenarios import sample, program, final_feedback
        now = datetime(2026, 10, 11, 1, tzinfo=timezone.utc)
        scope = "test/" + str(uuid4())
        store = PostgresStore(self.dsn, scope)
        engine = Engine(store, Config(), simulator=True)
        decision = engine.evaluate(sample(now), [program()], now)
        session = engine.start_mock(decision["decision_id"], now)
        # New engine/store acts as another process after restart.
        recovered = Engine(PostgresStore(self.dsn, scope), Config(), simulator=True)
        self.assertEqual(recovered.evaluate(sample(now), [program()], now)["type"], "HOLD")
        feedback = final_feedback(session, now + timedelta(minutes=30), reason="water_low", fraction=0.5)
        recovered.feedback_mock(feedback)
        before = store.read()
        recovered.feedback_mock(feedback)
        self.assertEqual(store.read(), before)
        self.assertEqual(len(before["obligations"]), 1)
        self.assertEqual(len(before["ema_history"]), 2)

    def test_source_missing_schema_fails_closed(self):
        from app.source import SPFFSource
        source = SPFFSource(self.dsn, "test", "test", "soil-1")
        audit = source.inspect()
        self.assertFalse(audit["schema_compatible"])
        self.assertFalse(audit["can_dispatch"])
