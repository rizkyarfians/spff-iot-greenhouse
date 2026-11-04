"""Atomic per-scope state and append-only audit. SQLite is for isolated local simulation.

PostgreSQL uses a different schema and a transaction-scoped advisory lock. The
SPFF operational tables are never written by this repository.
"""
import copy
import hashlib
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


def initial_state():
    return {"obligations": {}, "sessions": {}, "decisions": {}, "feedback": {},
            "ema": {}, "ema_history": [], "stable_since": None, "last_sample": None,
            "last_start": None, "last_irrigation_sample": None}


class SQLiteStore:
    def __init__(self, path=":memory:", scope="simulation"):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.scope = scope
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(path, check_same_thread=False, timeout=10)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS engine_state(scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY, scope TEXT NOT NULL,
                recorded_at TEXT DEFAULT CURRENT_TIMESTAMP, payload TEXT NOT NULL);
        """)
        self.connection.commit()

    @contextmanager
    def transaction(self):
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                row = self.connection.execute("SELECT payload FROM engine_state WHERE scope=?", (self.scope,)).fetchone()
                state = json.loads(row[0]) if row else initial_state()
                before = copy.deepcopy(state)
                yield state
                if state != before:
                    payload = json.dumps(state, allow_nan=False)
                    self.connection.execute("INSERT INTO engine_state VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload", (self.scope, payload))
                    self.connection.execute("INSERT INTO audit_events(scope,payload) VALUES (?,?)", (self.scope, payload))
                self.connection.commit()
            except BaseException:
                self.connection.rollback()
                raise

    def read(self):
        with self.transaction() as state:
            return copy.deepcopy(state)

    def close(self):
        self.connection.close()


class PostgresStore:
    def __init__(self, dsn, scope):
        self.dsn, self.scope = dsn, scope

    @contextmanager
    def transaction(self):
        import psycopg
        from psycopg.types.json import Jsonb
        with psycopg.connect(self.dsn, connect_timeout=5) as connection:
            connection.execute("SET LOCAL lock_timeout = '5s'")
            connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ("spff_ai:" + self.scope,))
            row = connection.execute("SELECT payload FROM spff_ai.engine_state WHERE scope=%s FOR UPDATE", (self.scope,)).fetchone()
            state = row[0] if row else initial_state()
            before = copy.deepcopy(state)
            yield state
            if state != before:
                # Keep the authoritative state atomic, but do not append another
                # complete (potentially multi-megabyte) snapshot to every audit
                # event. Historic audit snapshots remain untouched.
                canonical = json.dumps(state, sort_keys=True, separators=(",", ":"),
                                       ensure_ascii=False, allow_nan=False).encode("utf-8")
                audit = {
                    "kind": "state_checkpoint_v1",
                    "state_sha256": hashlib.sha256(canonical).hexdigest(),
                    "state_bytes": len(canonical),
                    "changed_sections": sorted(
                        key for key in (state.keys() | before.keys())
                        if state.get(key) != before.get(key)
                    ),
                }
                connection.execute("INSERT INTO spff_ai.engine_state(scope,payload) VALUES (%s,%s) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload, updated_at=now()", (self.scope, Jsonb(state)))
                connection.execute("INSERT INTO spff_ai.audit_events(scope,payload) VALUES (%s,%s)", (self.scope, Jsonb(audit)))

    def read(self):
        # PostgreSQL MVCC already provides an atomic committed snapshot.
        # Read-only requests must not acquire the writer's advisory lock or
        # SELECT FOR UPDATE: a slow writer must not block /ready or /status.
        import psycopg
        with psycopg.connect(self.dsn, connect_timeout=5) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            connection.execute("SET LOCAL statement_timeout = '5s'")
            row = connection.execute(
                "SELECT payload FROM spff_ai.engine_state WHERE scope=%s", (self.scope,)
            ).fetchone()
            return row[0] if row else initial_state()

    def close(self):
        pass

    def read_summary(self):
        """Read only the small source-shadow dashboard sections.

        Legacy 4k development decisions can exceed 55 MB. Never deserialize
        them for an HST view or dashboard planning preview.
        PostgreSQL JSONB extracts exactly the requested object keys.
        """
        import psycopg
        with psycopg.connect(self.dsn, connect_timeout=5) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            connection.execute("SET LOCAL statement_timeout = '5s'")
            row = connection.execute(
                "SELECT payload->'guide_stock_bindings', payload->'shadow_water_plans' "
                "FROM spff_ai.engine_state WHERE scope=%s", (self.scope,)
            ).fetchone()
            return {
                "guide_stock_bindings": (row[0] or {}) if row else {},
                "shadow_water_plans": (row[1] or {}) if row else {},
            }

    def runtime_profile(self):
        import psycopg
        with psycopg.connect(self.dsn, connect_timeout=5) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            row = connection.execute("SELECT to_regclass('spff_ai.runtime_profiles')").fetchone()
            if row[0] is None:
                return None
            row = connection.execute("SELECT profile FROM spff_ai.runtime_profiles WHERE scope=%s", (self.scope,)).fetchone()
            return row[0] if row else None
