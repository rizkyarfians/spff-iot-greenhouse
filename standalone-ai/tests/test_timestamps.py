import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.engine import timestamp
from app.models import Snapshot
from app.scenarios import sample


class TimestampTests(unittest.TestCase):
    def test_utc_z_matches_explicit_offset(self):
        self.assertEqual(timestamp("2026-10-11T01:00:00Z"),
                         timestamp("2026-10-11T01:00:00+00:00"))

    def test_non_utc_offset_is_preserved(self):
        parsed = timestamp("2026-10-11T08:00:00+07:00")
        self.assertEqual(parsed.utcoffset(), timedelta(hours=7))
        self.assertEqual(parsed, timestamp("2026-10-11T01:00:00Z"))

    def test_normalizes_z_before_calling_legacy_parser(self):
        def legacy_parser(value):
            if value.endswith("Z"):
                raise ValueError("Python 3.10 rejects trailing Z")
            return datetime.fromisoformat(value)

        with patch("app.engine.datetime") as clock:
            clock.fromisoformat.side_effect = legacy_parser
            result = timestamp("2026-10-11T01:00:00Z")
            clock.fromisoformat.assert_called_once_with("2026-10-11T01:00:00+00:00")
            self.assertEqual(result.tzinfo, timezone.utc)

    def test_pydantic_snapshot_timestamp_roundtrip(self):
        source = sample(datetime(2026, 10, 11, 1, tzinfo=timezone.utc))
        serialized = source.model_dump(mode="json")
        self.assertEqual(timestamp(serialized["recorded_at"]), source.recorded_at)
        self.assertEqual(Snapshot.model_validate(serialized), source)
