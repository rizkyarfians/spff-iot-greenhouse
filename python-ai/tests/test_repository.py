"""Repository orchestration tests with an in-memory SQL-boundary fake.

These are not PostgreSQL integration tests or migration validation.
"""
import copy
import json
import unittest
from datetime import datetime, timezone, date

from spff_ai.adapters import ExplicitStatusSafetyAdapter
from spff_ai.config import Settings
from spff_ai.core import obligation_id
from spff_ai.repository import PostgresRepository

NOW = datetime(2026, 10, 31, 3, tzinfo=timezone.utc)


class LedgerCursor:
    def __init__(self):
        self.obligations, self.evidence, self.results = {}, {}, []

    def execute(self, sql, args):
        sql = ' '.join(sql.split())
        if sql.startswith('INSERT INTO spff.adaptive_ai_obligations'):
            oid, site, device, recipe, day, revision, payload = args
            self.obligations.setdefault(oid, dict(obligation_id=oid, site_id=site, device_id=device,
                recipe_id=recipe, application_day=day, recipe_revision=revision, recipe_snapshot=json.loads(payload)))
            self.results = []
        elif sql.startswith('SELECT * FROM spff.adaptive_ai_obligations'):
            self.results = list(self.obligations.values())
        elif sql.startswith('INSERT INTO spff.adaptive_ai_delivery_evidence'):
            sid, oid, liters, at = args
            self.evidence.setdefault(sid, dict(source_session_id=sid, obligation_id=oid, actual_stock_l=liters))
            self.results = []
        elif sql.startswith('SELECT * FROM spff.adaptive_ai_delivery_evidence'):
            self.results = [self.evidence[args[0]]]
        elif sql.startswith('SELECT source_session_id,actual_stock_l'):
            self.results = [e for e in self.evidence.values() if e['obligation_id'] == args[0]]
        else:
            raise AssertionError(f'Unexpected SQL: {sql}')

    def fetchall(self):
        return copy.deepcopy(self.results)

    def fetchone(self):
        return copy.deepcopy(self.results[0]) if self.results else None


def snapshot():
    recipe = dict(recipe_id='r1', revision=1, approval_status='approved', planting_date=date(2026, 10, 1),
                  hst_from=10, hst_to=40, application_mode='interval', application_interval_days=5,
                  target_stock_l=2, target_water_l=20, stock_concentration_g_per_l=100,
                  min_water_tank_percent=30, min_stock_tank_percent=25)
    session = dict(session_id='s1', recipe_id='r1', started_at=NOW, last_recorded_at=NOW,
                   target_stock_l=2, target_water_l=20, actual_stock_l=.5, actual_water_l=5,
                   status='aborted', pumps_off=True, site_id='site', device_id='device',
                   _final_event=dict(status='aborted',recorded_at=NOW,
                                     payload=dict(actualStockL=.5,actualWaterL=5,pumpsOff=True)),
                   _link=dict(obligation_id=obligation_id('site','device','r1',NOW.date()),
                              recipe_revision=1,stock_concentration_g_per_l=100,
                              counter_reconciled=True,review_reference='fixture',reviewed_by='test'))
    return dict(recipes=[recipe], sessions=[session], blockers=[], safety_reasons=[])


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repo = PostgresRepository(Settings('unused', 'site', 'device', evidence_complete=True))
        self.cursor = LedgerCursor()

    def test_polling_replay_never_reduces_twice(self):
        first = self.repo.obligations(self.cursor, snapshot(), NOW)
        second = self.repo.obligations(self.cursor, snapshot(), NOW)
        self.assertEqual(first, second)
        self.assertEqual(second[0]['remaining_stock_l'], 1.5)
        self.assertEqual(len(self.cursor.obligations), 1)
        self.assertEqual(len(self.cursor.evidence), 1)

    def test_recipe_revision_does_not_recreate_dose(self):
        self.repo.obligations(self.cursor, snapshot(), NOW)
        changed = snapshot()
        changed['recipes'][0].update(revision=2, target_stock_l=3)
        balance = self.repo.obligations(self.cursor, changed, NOW)
        self.assertEqual(len(self.cursor.obligations), 1)
        self.assertEqual(balance[0]['target_stock_l'], 2)
        self.assertIn('obligation_recipe_changed_or_revoked', changed['blockers'])

    def test_conflicting_final_volume_rejected(self):
        self.repo.obligations(self.cursor, snapshot(), NOW)
        changed = snapshot()
        changed['sessions'][0]['actual_stock_l'] = .7
        changed['sessions'][0]['_final_event']['payload']['actualStockL'] = .7
        balances = self.repo.obligations(self.cursor, changed, NOW)
        self.assertEqual(balances[0]['calculation_status'], 'REQUIRES_REVIEW')
        self.assertEqual(balances[0]['actual_stock_l'], .5)

    def test_ambiguous_calendar_does_not_create_two_doses(self):
        s = snapshot()
        s['sessions'] = []
        s['recipes'].append({**s['recipes'][0], 'recipe_id': 'r2'})
        self.assertEqual(self.repo.obligations(self.cursor, s, NOW), [])
        self.assertIn('ambiguous_due_fertilizer_programs', s['blockers'])

    def test_default_safety_adapter_fails_closed(self):
        self.assertTrue(ExplicitStatusSafetyAdapter().reasons({'raw_payload': {}}))


if __name__ == '__main__':
    unittest.main()
