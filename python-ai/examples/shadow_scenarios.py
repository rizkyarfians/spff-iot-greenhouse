"""Synthetic scenario report: no database, MQTT, serial or device connection."""
import copy
import json
from datetime import date, datetime, timedelta, timezone
from spff_ai.core import JAKARTA, decide, due, fertilizer_dose, mass_balance, obligation_id
from spff_ai.repository import json_default

now = datetime(2026, 10, 31, 3, tzinfo=timezone.utc)
day = now.astimezone(JAKARTA).date()
recipe = {"recipe_id": "demo", "approval_status": "approved", "planting_date": date(2026,10,21),
          "hst_from":10,"hst_to":40,"application_mode":"interval","application_interval_days":5}
assert due(recipe,day)

def snapshot(at,moisture=30,water=80):
    values={"soil_1_moisture":moisture,"tank_water_level_pct":water,"tank_fert_level_pct":70,
            "flow_water_lpm":0,"flow_fert_lpm":0}
    return {"telemetry":{**values,"recorded_at":at,"sensor_health":{k:{"valid":True} for k in values}},
            "status":{"recorded_at":at,"mode":"automatic","online":True},
            "config":{"desired_mode":"automatic","applied_mode":"automatic","revision":1,
                      "acknowledged_revision":1,"acknowledgement_status":"applied"},"evidence_complete":True}

dose=fertilizer_dose(2000,2.5,5000,200)
obligation={**mass_balance(200,25,[]),"obligation_id":obligation_id("demo","device","recipe",day),
            "application_day":day,"evidence_known":True,"min_water_tank_percent":30,"min_stock_tank_percent":25}
partial={**obligation,**mass_balance(200,25,[("session-1",100)])}
complete={**obligation,**mass_balance(200,25,[("session-1",100),("session-2",100)])}
examples={
    "HST1_dry":decide(snapshot(now-timedelta(days=9)),[],now-timedelta(days=9)),
    "HST2_wet":decide(snapshot(now-timedelta(days=8),95),[],now-timedelta(days=8)),
    "HST10_wet_fertilizer":decide(snapshot(now,95),[obligation],now),
    "HST10_water_low":decide(snapshot(now,95,10),[partial],now),
    "HST10_refilled":decide(snapshot(now,95),[partial],now),
    "HST11_remaining":decide(snapshot(now+timedelta(days=1),95),[partial],now+timedelta(days=1)),
    "HST11_complete":decide(snapshot(now+timedelta(days=1),95),[complete],now+timedelta(days=1)),
}
# Keep console concise; complete 101-point aggregation remains in actual decisions.
for result in examples.values():
    if result.get("fuzzy"):
        result["fuzzy"]["trace"].pop("aggregate")
print(json.dumps({"synthetic":True,"dose":dose,"examples":examples},default=json_default,indent=2))
