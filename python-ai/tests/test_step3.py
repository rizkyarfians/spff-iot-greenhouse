import copy
from datetime import timedelta
import math
import unittest

from spff_ai.adapters import ExistingFinalSessionAdapter, ExplicitStatusSafetyAdapter
from spff_ai.core import EMA, JAKARTA, decide, due, fertilizer_dose, mass_balance, sensor_ok
from spff_ai.fuzzy import FuzzyProfile, fuzzy_water
from spff_ai.learning import FlowState, learn_feedback
from spff_ai.repository import select_parameters
from test_engine import NOW, DAY, snapshot, obligation, recipe
from test_repository import LedgerCursor, snapshot as ledger_snapshot
from spff_ai.config import Settings
from spff_ai.repository import PostgresRepository


def flow_row(at, total, rate=6, active=True):
    values = {"flow_water_lpm": rate, "flow_water_total_l": total}
    return {**values, "message_id": at.isoformat(), "recorded_at": at,
            "sensor_valid": False, "sensor_health": {k: {"valid": True} for k in values},
            "pump_state": "active" if active else "inactive", "pump_active": active,
            "pump_at": NOW-timedelta(seconds=60)}


class LearningTests(unittest.TestCase):
    def initial(self):
        return FlowState(value=7, last_at=NOW-timedelta(seconds=10), count=1,
                         seen_at=NOW-timedelta(seconds=10), baseline_at=NOW-timedelta(seconds=10),
                         total_l=99, baseline_valid=True)

    def test_required_numeric_example(self):
        self.assertAlmostEqual(EMA(7, NOW-timedelta(seconds=10)).observe(6, NOW, .3).value, 6.7)
        state, trace = learn_feedback(self.initial(), flow_row(NOW,100), "flow_water_lpm", NOW, alpha=.3)
        self.assertTrue(trace["accepted"])
        self.assertAlmostEqual(state.value, 6.7)
        self.assertAlmostEqual(100/state.value, 14.92537313432836)
        self.assertEqual(state.count,2)

    def test_replay_and_serialized_restart(self):
        first, _ = learn_feedback(self.initial(), flow_row(NOW,100), "flow_water_lpm", NOW)
        loaded = FlowState.load(first.json())
        again, trace = learn_feedback(loaded,flow_row(NOW,100),"flow_water_lpm",NOW)
        self.assertEqual(first, again)
        self.assertEqual(trace["reason"],"duplicate_or_out_of_order")

    def test_reset_latches_until_profile_review(self):
        reset, trace = learn_feedback(self.initial(),flow_row(NOW,1),"flow_water_lpm",NOW)
        self.assertTrue(reset.reset_pending)
        later = NOW+timedelta(seconds=10)
        still, trace = learn_feedback(reset,flow_row(later,2),"flow_water_lpm",later)
        self.assertFalse(trace["accepted"])
        self.assertTrue(still.reset_pending)
        reviewed, trace = learn_feedback(still,flow_row(later+timedelta(seconds=10),3),"flow_water_lpm",
                                         later+timedelta(seconds=10), profile_revision="reviewed-v2")
        self.assertFalse(reviewed.reset_pending)
        self.assertIsNone(reviewed.value)
        self.assertEqual(trace["reason"],"waiting_counter_baseline")

    def test_off_zero_is_ignored_not_a_pump_fault(self):
        state, trace = learn_feedback(self.initial(),flow_row(NOW,99,rate=0,active=False),"flow_water_lpm",NOW)
        self.assertFalse(trace["accepted"])
        self.assertEqual(state.value,7)
        self.assertEqual(state.count,1)

    def test_high_rate_stream_accumulates_sufficient_interval(self):
        state = self.initial()
        for seconds in range(1,6):
            at = NOW-timedelta(seconds=10-seconds)
            state, trace = learn_feedback(state,flow_row(at,99+seconds*.1),"flow_water_lpm",NOW)
        self.assertTrue(trace["accepted"])
        self.assertAlmostEqual(trace["actual_lpm"],6)

    def test_outlier_and_invalid_counter_health(self):
        row = flow_row(NOW,199, rate=600)
        state, trace = learn_feedback(self.initial(),row,"flow_water_lpm",NOW)
        self.assertEqual(trace["reason"],"flow_outlier")
        self.assertEqual(state.value,7)
        row = flow_row(NOW,100)
        row["sensor_health"]["flow_water_total_l"]["valid"] = False
        self.assertFalse(learn_feedback(self.initial(),row,"flow_water_lpm",NOW)[1]["accepted"])

    def test_future_stale_and_pump_interval(self):
        for at in (NOW+timedelta(seconds=1),NOW-timedelta(seconds=121)):
            self.assertFalse(learn_feedback(self.initial(),flow_row(at,100),"flow_water_lpm",NOW)[1]["accepted"])
        row=flow_row(NOW,100)
        row["pump_at"] = NOW-timedelta(seconds=1)
        self.assertFalse(learn_feedback(self.initial(),row,"flow_water_lpm",NOW)[1]["accepted"])

    def test_invalid_sample_cannot_hide_counter_reset(self):
        bad=flow_row(NOW,100)
        bad['sensor_health']['flow_water_total_l']['valid']=False
        state,_=learn_feedback(self.initial(),bad,'flow_water_lpm',NOW)
        later=NOW+timedelta(seconds=10)
        state,trace=learn_feedback(state,flow_row(later,1),'flow_water_lpm',later)
        self.assertTrue(state.reset_pending)
        self.assertFalse(trace['accepted'])


class TelemetryTests(unittest.TestCase):
    def test_individual_health_over_global_and_sensor_choice(self):
        row={"recorded_at":NOW,"sensor_valid":False,"soil_1_moisture":20,"soil_2_moisture":80,
             "sensor_health":{"soil_1_moisture":{"valid":False},"soil_2_moisture":{"valid":True}}}
        selected=select_parameters([row],NOW,120)
        self.assertNotIn("soil_1_moisture",selected)
        self.assertEqual(selected["soil_2_moisture"],80)

    def test_latest_healthy_has_original_time_and_no_stale_resurrection(self):
        good={"recorded_at":NOW-timedelta(seconds=30),"message_id":"good","soil_1_moisture":30,
              "sensor_health":{"soil_1_moisture":{"valid":True}}}
        bad={**good,"recorded_at":NOW,"message_id":"bad","soil_1_moisture":None}
        selected=select_parameters([bad,good],NOW,120)
        self.assertEqual(selected["parameter_message_id"]["soil_1_moisture"],"good")
        self.assertEqual(selected["parameter_recorded_at"]["soil_1_moisture"],good["recorded_at"])
        self.assertFalse(sensor_ok(selected,"soil_1_moisture",NOW+timedelta(seconds=91),120))

    def test_all_invalid_never_infers_health(self):
        for value in (None,math.nan,math.inf,-1,101):
            row={"recorded_at":NOW,"soil_1_moisture":value,"sensor_health":{"soil_1_moisture":{"valid":True}}}
            self.assertNotIn("soil_1_moisture",select_parameters([row],NOW,120))


class ScenarioTests(unittest.TestCase):
    def test_hst1_and_hst2_uncalibrated_and_off(self):
        s=snapshot()
        s["telemetry"].pop("air_temp")
        self.assertEqual(decide(s,[],NOW)["action"],"NOT_CALIBRATED")
        s["telemetry"]["soil_1_moisture"]=95
        self.assertEqual(decide(s,[],NOW)["action"],"NO_WATER_NEEDED")

    def test_calibrated_zone_volume_no_plant_multiplier(self):
        profile=FuzzyProfile(full_scale_zone_l=1000,max_zone_l=1200,calibration_reference="test zone")
        d=decide(snapshot(),[],NOW,fuzzy_profile=profile)
        self.assertEqual(d["action"],"IRRIGATE")
        self.assertAlmostEqual(d["fuzzy"]["target_water_zone_l"],800)
        self.assertNotIn("suggested_water_l",d["fuzzy"])

    def test_membership_threshold_configuration_changes_inference(self):
        altered=FuzzyProfile(moisture={"LOW":["left",10,30],"MEDIUM":["triangle",15,35,55],"HIGH":["right",40,60]})
        self.assertNotEqual(fuzzy_water(30)["demand_percent"],fuzzy_water(30,profile=altered)["demand_percent"])

    def test_selected_soil2_can_be_valid_while_soil1_fails(self):
        s=snapshot()
        s['moisture_sensor_key']='soil_2_moisture'
        s['telemetry']['soil_1_moisture']=None
        s['telemetry']['soil_2_moisture']=95
        s['telemetry']['sensor_health']['soil_2_moisture']={'valid':True}
        self.assertEqual(decide(s,[],NOW)['action'],'NO_WATER_NEEDED')

    def test_no_rule_decision_holds_and_does_not_invent_volume(self):
        decision=decide(snapshot(),[],NOW,fuzzy_profile=FuzzyProfile(rules={}))
        self.assertEqual(decision['action'],'HOLD')
        self.assertIsNone(decision['fuzzy']['target_water_zone_l'])

    def test_delivery_final_event_must_match_materialized_totals(self):
        repo=PostgresRepository(Settings('unused','site','device',evidence_complete=True))
        cursor=LedgerCursor()
        s=ledger_snapshot()
        s['sessions'][0]['_final_event']['payload']['actualStockL']=99
        balance=repo.obligations(cursor,s,NOW)[0]
        self.assertEqual(balance['calculation_status'],'REQUIRES_REVIEW')
        self.assertEqual(cursor.evidence,{})

    def test_next_day_same_debt_and_completion_no_moisture_gate(self):
        s=snapshot()
        s["telemetry"]["soil_1_moisture"]=None
        o=obligation(.5,DAY-timedelta(days=1))
        d=decide(s,[o],NOW)
        self.assertEqual(d["action"],"RESUME_FERTIGATION")
        self.assertEqual(d["obligation"]["obligation_id"],"o1")
        o.update(mass_balance(2,100,[("s1",2)]))
        self.assertEqual(decide(s,[o],NOW)["action"],"COMPLETED")

    def test_midnight_wib_hst(self):
        r=recipe()
        at=NOW.replace(hour=17,minute=0)
        self.assertEqual(at.astimezone(JAKARTA).date(),DAY+timedelta(days=1))
        self.assertFalse(due(r,at.astimezone(JAKARTA).date()))
        self.assertTrue(due(r,(at-timedelta(microseconds=1)).astimezone(JAKARTA).date()))

    def test_mass_dose_example(self):
        dose=fertilizer_dose(2000,2.5,5000,200)
        self.assertEqual(dose["total_fertilizer_g"],5000)
        self.assertEqual(dose["stock_concentration_g_per_l"],25)
        b=mass_balance(dose["required_stock_l"],25,[("physical",100),("physical",100)])
        self.assertEqual(b["delivered_fertilizer_g"],2500)
        self.assertEqual(b["remaining_fertilizer_g"],2500)

    def test_explicit_safety_fields_all_required(self):
        adapter=ExplicitStatusSafetyAdapter()
        self.assertTrue(adapter.reasons({"raw_payload":{"adaptiveAiSafety":{"safe":True}}}))
        safe={"safe":True,"emergencyStop":False,"otaActive":False,"shutdownFault":False,
              "operatorStop":False,"relayOwnerActive":False,"selectorMode":"automatic","activeExecutionId":None}
        self.assertFalse(adapter.reasons({"raw_payload":{"adaptiveAiSafety":safe}}))
        safe["emergencyStop"]=True
        self.assertTrue(adapter.reasons({"raw_payload":{"adaptiveAiSafety":safe}}))

    def test_cross_day_multiple_sessions_same_obligation(self):
        repo=PostgresRepository(Settings("unused","site","device",evidence_complete=True))
        cursor=LedgerCursor()
        initial=ledger_snapshot()
        first=repo.obligations(cursor,initial,NOW)[0]
        later=copy.deepcopy(initial)
        later["sessions"].append({**later["sessions"][0],"session_id":"s2","started_at":NOW+timedelta(days=1),
                                  "last_recorded_at":NOW+timedelta(days=1),"actual_stock_l":1.5,
                                  "_final_event":{"status":"aborted","recorded_at":NOW+timedelta(days=1),
                                                  "payload":{"actualStockL":1.5,"actualWaterL":5,"pumpsOff":True}}})
        second=repo.obligations(cursor,later,NOW+timedelta(days=1))[0]
        self.assertEqual(first["obligation_id"],second["obligation_id"])
        self.assertEqual(second["remaining_stock_l"],0)
        self.assertEqual(second["calculation_status"],"COMPLETED")
        self.assertEqual(len(cursor.obligations),1)

    def test_concentration_change_requires_review_without_rewrite(self):
        repo=PostgresRepository(Settings("unused","site","device",evidence_complete=True))
        cursor=LedgerCursor()
        repo.obligations(cursor,ledger_snapshot(),NOW)
        changed=ledger_snapshot()
        changed["sessions"][0]["_link"]["stock_concentration_g_per_l"]=200
        b=repo.obligations(cursor,changed,NOW)[0]
        self.assertEqual(b["calculation_status"],"REQUIRES_REVIEW")
        self.assertEqual(b["delivered_fertilizer_g"],50)
