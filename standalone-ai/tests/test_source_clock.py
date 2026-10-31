"""Regression for the 2085 poisoned recorded_at source selection.

This unit test verifies the SQL contract; real PostgreSQL integration remains
required to verify clock, indexes and query behavior on Orange Pi.
"""
import unittest
from unittest.mock import patch

from app.source import REQUIRED, SPFFSource


class QueryRows:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class FakeSourceConnection:
    def __init__(self):
        self.telemetry_sql = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, args=None):
        if sql.startswith("SELECT table_name,column_name"):
            return QueryRows([
                {"table_name": table, "column_name": column}
                for table, columns in REQUIRED.items() for column in columns
            ])
        if sql.startswith("SELECT * FROM spff.telemetry_samples"):
            self.telemetry_sql = sql
            assert "recorded_at <= received_at + INTERVAL '5 seconds'" in sql
            assert "received_at <= NOW() + INTERVAL '5 seconds'" in sql
            assert "recorded_at <= NOW() + INTERVAL '5 seconds'" in sql
            assert args == ("greenhouse-01", "esp32-s3-01")
            return QueryRows([{
                "telemetry_id": 140817, "recorded_at": "2026-10-31T17:05:06+00:00",
                "received_at": "2026-10-31T17:05:07+00:00",
                "soil_1_moisture": 58.3,
            }])
        if sql.startswith("SELECT * FROM spff.device_status_events"):
            return QueryRows([])
        if sql.startswith("SELECT * FROM spff.device_automatic_control_configs"):
            return QueryRows([])
        if sql.startswith("SELECT r.* FROM spff.fertigation_recipes"):
            return QueryRows([])
        if sql.startswith("SELECT session_id,status,pumps_off"):
            return QueryRows([])
        if sql.startswith("SELECT to_regclass"):
            return QueryRows([{"relation": None}])
        return QueryRows([])


class SourceClockTests(unittest.TestCase):
    def test_source_selects_only_plausible_clock_rows(self):
        connection = FakeSourceConnection()
        with patch("psycopg.connect", return_value=connection):
            with patch("app.source.read_guide_programs",
                       return_value={"status": "READ_ONLY_PREVIEW", "programs": []}):
                audit = SPFFSource("fake", "greenhouse-01", "esp32-s3-01", "soil-1").inspect()
        self.assertIsNotNone(connection.telemetry_sql)
        self.assertEqual(audit["telemetry"]["telemetry_id"], 140817)
        self.assertFalse(audit["can_dispatch"])


if __name__ == "__main__":
    unittest.main()
