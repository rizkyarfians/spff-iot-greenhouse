"""Process database-origin feedback for explicitly bound sessions only.

No HTTP feedback endpoint or session auto-matching is provided. Bindings must be
created by the future validated dispatcher; existing manual/legacy executions
cannot be retroactively assigned by matching dates, product names or EC.
"""
from .engine import digest, timestamp
from .live_engine import empty_live, fresh


def process_feedback(store, event, now):
    payload = event["payload"]
    with store.transaction() as container:
        state = container.setdefault("live", empty_live())
        session = state["sessions"].get(payload.get("sessionId"))
        if not session:
            return {"status": "UNBOUND", "dose_changed": False}
        event_id = event["message_id"]
        fingerprint = digest(event)
        previous = state["feedback"].get(event_id)
        if previous:
            if previous["fingerprint"] != fingerprint:
                session["status"] = "REQUIRES_REVIEW"
                state["obligations"][session["obligation_id"]]["status"] = "REQUIRES_REVIEW"
                return {"status": "CONFLICTING_REPLAY", "dose_changed": False}
            return previous["result"]
        o = state["obligations"][session["obligation_id"]]
        terminal = payload.get("state") in ("COMPLETED", "FAULT", "WAITING_FOR_WATER", "PARTIAL")
        valid = (payload.get("bootId") == session["boot_id"] and payload.get("flowValid") is True
                 and payload.get("volumeEstimated") is False and payload.get("flowAgeMs", 1e9) <= 25000
                 and payload.get("waterPumpKnown") is True and payload.get("fertPumpKnown") is True
                 and fresh(payload.get("timestamp"), now, 120)
                 and timestamp(payload["timestamp"]) >= timestamp(session["started_at"]))
        try:
            water, stock = float(payload["waterVolumeL"]), float(payload["fertVolumeL"])
            import math
            valid = valid and math.isfinite(water) and math.isfinite(stock) and water >= session.get("water_l", 0) and stock >= session.get("stock_l", 0)
            valid = valid and stock <= session["target_stock_l"] + session["tolerance_g"]/session["concentration_g_l"]
            valid = valid and o["delivered_g"] + (stock-session.get("stock_l", 0))*session["concentration_g_l"] <= o["snapshot"]["target_g"]+session["tolerance_g"]
        except (KeyError, TypeError, ValueError):
            valid, water, stock = False, 0, 0
        if terminal and (payload.get("waterPump") is not False or payload.get("fertPump") is not False):
            valid = False
        if session["status"] in ("COMPLETED", "PARTIAL", "WAITING_FOR_WATER", "REQUIRES_REVIEW"):
            valid = False
        changed = False
        if valid:
            delta = stock-session.get("stock_l", 0)
            o["delivered_g"] += delta*session["concentration_g_l"]
            session.update(water_l=water, stock_l=stock)
            changed = delta > 0
        safe_end = (terminal and valid and payload.get("safeShutdownComplete") is True)
        if not valid or (terminal and not safe_end) or payload.get("state") == "FAULT":
            session["status"] = o["status"] = "REQUIRES_REVIEW"
            if "execution_feedback_requires_reconciliation" not in o["review_reasons"]:
                o["review_reasons"].append("execution_feedback_requires_reconciliation")
        elif safe_end:
            if o["snapshot"]["target_g"]-o["delivered_g"] <= session["tolerance_g"]:
                session["status"] = o["status"] = "COMPLETED"
            elif payload["state"] == "WAITING_FOR_WATER" and payload.get("stopReason") == "water_low":
                session["status"] = o["status"] = "WAITING_FOR_WATER"
                state["stable_since"] = None
            else:
                session["status"] = o["status"] = "PARTIAL"
            # The firmware must report per-pump active duration, not elapsed wall
            # time that includes priming, pauses, mixing and flushing for both.
            for pump, volume, field in (("water", water, "waterOnSeconds"), ("fertilizer", stock, "fertilizerOnSeconds")):
                seconds = payload.get(field)
                elapsed = (timestamp(payload["timestamp"])-timestamp(session["started_at"])).total_seconds()
                if isinstance(seconds, (int, float)) and 0 < seconds <= elapsed+1 and volume > 0:
                    model = state["ema"].setdefault(session["configuration_version"], dict(session["ema_used"]))
                    old, actual = model[pump], volume/seconds*60
                    model[pump] = session["alpha"]*actual+(1-session["alpha"])*old
                    state["ema_history"].append({"session_id": payload["sessionId"], "pump": pump, "old": old,
                                                 "actual": actual, "new": model[pump], "event_id": event_id})
        result = {"status": session["status"], "dose_changed": changed, "delivered_g": o["delivered_g"]}
        state["feedback"][event_id] = {"fingerprint": fingerprint, "result": result}
        return result
