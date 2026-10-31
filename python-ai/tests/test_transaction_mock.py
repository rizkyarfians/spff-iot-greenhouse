"""Run the actual repository SQL orchestration against a strict DB-API mock.

Rollback and retry behavior here are simulations, not proof of PostgreSQL locks.
"""
import copy
import json
import sys
import types
import unittest
from unittest.mock import patch

from test_engine import NOW, snapshot
from test_repository import LedgerCursor, snapshot as ledger_snapshot
from spff_ai.config import Settings
from spff_ai.repository import PostgresRepository


class SerializationFailure(Exception):
    pass


class DeadlockDetected(Exception):
    pass


class Store(LedgerCursor):
    def __init__(self):
        super().__init__()
        self.flow, self.feedback, self.decisions, self.ema = {}, {}, {}, {}
        self.calculations = {}
        self.fail_final = False
        self.now = NOW
        self.s = snapshot()
        self.s['telemetry'].update(message_id='t1',telemetry_id=1)
        self.recipes = [ledger_snapshot()['recipes'][0]]
        self.flow_rows = {}

    def execute(self,sql,args=None):
        sql=' '.join(sql.split())
        self.results=[]
        if sql.startswith(('SET ','SELECT pg_advisory')):
            return
        if sql.startswith('SELECT transaction_timestamp'):
            self.results=[{'now':self.now}]
        elif sql.startswith('SELECT * FROM spff.devices'):
            self.results=[{'enabled':True,'site_id':'site','device_id':'device'}]
        elif sql.startswith('SELECT * FROM spff.telemetry_samples'):
            self.results=[self.s['telemetry']]
        elif sql.startswith('SELECT * FROM spff.device_status_events'):
            self.results=[self.s['status']]
        elif sql.startswith('SELECT * FROM spff.device_automatic_control_configs'):
            self.results=[self.s['config']]
        elif sql.startswith('SELECT * FROM spff.site_crop_selections'):
            self.results=[{'crop_id':'crop'}]
        elif sql.startswith('SELECT * FROM spff.fertigation_recipes'):
            self.results=self.recipes
        elif sql.startswith(('SELECT * FROM spff.fertigation_sessions','SELECT l.* FROM spff.adaptive_ai_session_links',
                             'SELECT * FROM spff.actuator_schedules','SELECT session_id,status,application_day',
                             'SELECT DISTINCT ON(session_id)')):
            pass
        elif sql.startswith('SELECT * FROM spff.device_water_interlock_configs'):
            self.results=[dict(enabled=True,applied_enabled=True,acknowledgement_status='applied',revision=1,acknowledged_revision=1)]
        elif sql.startswith('SELECT DISTINCT ON (actuator_key)'):
            self.results=[dict(actuator_key=k,state='inactive',is_active=False,recorded_at=NOW) for k in ('pump_water','pump_fert')]
        elif sql.startswith('SELECT state FROM spff.adaptive_ai_flow_state'):
            self.results=[{'state':self.flow[args[2]]}] if args[2] in self.flow else []
        elif sql.startswith('SELECT t.*,s.state AS pump_state'):
            self.results=self.flow_rows.get(args[0],[])
        elif sql.startswith('SELECT 1 FROM spff.adaptive_ai_ema_feedback'):
            self.results=[{'exists':1}] if (args[2],args[3]) in self.feedback else []
        elif sql.startswith('INSERT INTO spff.adaptive_ai_ema_feedback'):
            self.feedback.setdefault((args[2],args[3]),json.loads(args[-1]))
        elif sql.startswith('INSERT INTO spff.adaptive_ai_ema '):
            self.ema[args[2]]=dict(value=args[3],count=args[5],profile_revision=args[6])
        elif sql.startswith('INSERT INTO spff.adaptive_ai_flow_state'):
            self.flow[args[2]]=json.loads(args[3])
        elif sql.startswith('UPDATE spff.adaptive_ai_obligations'):
            self.calculations[args[2]]=(args[0],json.loads(args[1]))
        elif sql.startswith('INSERT INTO spff.adaptive_ai_decisions'):
            if self.fail_final:
                raise RuntimeError('simulated persistence failure')
            self.decisions.setdefault(args[-1],json.loads(args[-3]))
        elif sql.startswith('SELECT result FROM spff.adaptive_ai_decisions'):
            self.results=[{'result':self.decisions[args[2]]}]
        else:
            super().execute(sql,args)


class Connection:
    def __init__(self,store):
        self.store=store

    def __enter__(self):
        self.before=copy.deepcopy(self.store.__dict__)
        return self

    def __exit__(self,kind,value,tb):
        if kind:
            self.store.__dict__.clear()
            self.store.__dict__.update(self.before)

    def cursor(self):
        return CursorContext(self.store)


class CursorContext:
    def __init__(self,cursor): self.cursor=cursor
    def __enter__(self): return self.cursor
    def __exit__(self,*args): pass


class TransactionMockTests(unittest.TestCase):
    def setUp(self):
        self.store=Store()
        self.repo=PostgresRepository(Settings('mock-only','site','device',evidence_complete=True))
        module=types.ModuleType('psycopg')
        module.connect=lambda *a,**kw: Connection(self.store)
        module.errors=types.SimpleNamespace(SerializationFailure=SerializationFailure,DeadlockDetected=DeadlockDetected)
        rows=types.ModuleType('psycopg.rows'); rows.dict_row=object()
        self.patch=patch.dict(sys.modules,{'psycopg':module,'psycopg.rows':rows})
        self.patch.start(); self.addCleanup(self.patch.stop)

    def test_full_read_write_and_read_back_shadow(self):
        result=self.repo.run_once()
        self.assertFalse(result['can_dispatch'])
        self.assertEqual(result['execution_mode'],'SHADOW_MODE')
        self.assertEqual(len(self.store.obligations),1)
        self.assertEqual(len(self.store.decisions),1)
        self.assertEqual(len(self.store.flow),2)
        self.assertEqual(next(iter(self.store.calculations.values()))[0],'OUTSTANDING')

    def test_restart_identical_input_deduplicates_decision_and_obligation(self):
        first=self.repo.run_once()
        restarted=PostgresRepository(self.repo.settings)
        second=restarted.run_once()
        self.assertEqual(first,second)
        self.assertEqual(len(self.store.decisions),1)
        self.assertEqual(len(self.store.obligations),1)

    def test_final_failure_rolls_back_ledger_state_and_decision(self):
        self.store.fail_final=True
        with self.assertRaises(RuntimeError): self.repo.run_once()
        self.assertEqual(self.store.obligations,{})
        self.assertEqual(self.store.flow,{})
        self.assertEqual(self.store.decisions,{})

    def test_serialization_retry_restarts_whole_transaction(self):
        original=self.repo._run_once
        calls=[]
        def competing():
            calls.append(1)
            if len(calls)==1: raise SerializationFailure('simulated competing snapshot')
            return original()
        with patch.object(self.repo,'_run_once',side_effect=competing): self.repo.run_once()
        self.assertEqual(len(calls),2)
        self.assertEqual(len(self.store.obligations),1)

    def test_deadlock_retry_bounded(self):
        with patch.object(self.repo,'_run_once',side_effect=DeadlockDetected('mock')) as call:
            with self.assertRaises(DeadlockDetected): self.repo.run_once()
            self.assertEqual(call.call_count,3)

    def test_repository_updates_two_emas_and_deduplicates_feedback(self):
        from test_step3 import flow_row
        from datetime import timedelta
        self.store.flow_rows['pump_water']=[flow_row(NOW-timedelta(seconds=10),100),flow_row(NOW,101)]
        self.store.flow_rows['pump_fert']=[
            {k.replace('flow_water','flow_fert'):v for k,v in row.items()}
            for row in (flow_row(NOW-timedelta(seconds=30),10,rate=2),flow_row(NOW,11,rate=2))]
        for row in self.store.flow_rows['pump_fert']:
            row['sensor_health']={k.replace('flow_water','flow_fert'):v for k,v in row['sensor_health'].items()}
        first=self.repo.run_once()
        self.assertEqual(first['ema']['flow_water_lpm'],6)
        self.assertEqual(first['ema']['flow_fert_lpm'],2)
        self.assertEqual(len(self.store.feedback),4)
        second=self.repo.run_once()
        self.assertEqual(len(self.store.feedback),4)
        self.assertEqual(self.store.ema['flow_water_lpm']['count'],1)
        self.assertEqual(first,second)
