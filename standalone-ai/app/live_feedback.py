"""Commit authoritative per-session delivery evidence to the shadow ledger.

Only a future validated dispatcher can bind a session. No HTTP feedback intake,
no old-session guessing, and no actuator dispatch. Counter checks are independent
proof for flow EMA; a contradiction makes the dose require reconciliation.
"""
from .engine import digest, timestamp
from .flow_evidence import counter_evidence, learn_counter_ema, number
from .live_engine import empty_live, fresh
from .mass_evidence import accept_delivery


TERMINAL = {"COMPLETED", "FAULT", "WAITING_FOR_WATER", "PARTIAL"}
CLOSED = {"COMPLETED", "PARTIAL", "WAITING_FOR_WATER", "REQUIRES_REVIEW"}


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
        obligation = state["obligations"][session["obligation_id"]]
        if previous:
            if previous["fingerprint"] != fingerprint:
                session["status"] = obligation["status"] = "REQUIRES_REVIEW"
                if "conflicting_delivery_replay" not in obligation["review_reasons"]:
                    obligation["review_reasons"].append("conflicting_delivery_replay")
                return {"status": "CONFLICTING_REPLAY", "dose_changed": False}
            return previous["result"]

        elapsed_valid = fresh(payload.get("timestamp"), now, 120)
        elapsed_valid = elapsed_valid and timestamp(payload["timestamp"]) >= timestamp(session["started_at"])
        flow_age = payload.get("flowAgeMs")
        valid = (session["status"] not in CLOSED
                 and payload.get("bootId") == session["boot_id"]
                 and payload.get("flowValid") is True
                 and payload.get("volumeEstimated") is False
                 and number(flow_age) and 0 <= flow_age <= 25000
                 and payload.get("waterPumpKnown") is True
                 and payload.get("fertPumpKnown") is True
                 and elapsed_valid)
        water, stock = payload.get("waterVolumeL"), payload.get("fertVolumeL")
        concentration = session.get("concentration_g_l")
        target = obligation.get("snapshot", {}).get("target_g")
        tolerance = session.get("tolerance_g")
        previous_stock = session.get("stock_l", 0)
        previous_water = session.get("water_l", 0)
        valid = valid and all(number(x) for x in (
            water, stock, concentration, target, tolerance,
            previous_stock, previous_water, obligation.get("delivered_g")
        ))
        if valid:
            valid = (water >= previous_water >= 0 and stock >= previous_stock >= 0
                     and concentration > 0 and tolerance >= 0 and target >= 0
                     and stock <= session["target_stock_l"] + tolerance / concentration
                     and obligation["delivered_g"] + (stock - previous_stock) * concentration
                     <= target + tolerance)
        terminal = payload.get("state") in TERMINAL
        safe_terminal = (terminal and payload.get("state") != "FAULT"
                         and payload.get("safeShutdownComplete") is True
                         and payload.get("waterPump") is False
                         and payload.get("fertPump") is False)
        counter_status, counter_reason, proof = (
            counter_evidence(state, session, payload) if terminal and valid
            else ("NOT_EVALUATED", None, {})
        )
        review_reason = (counter_reason if counter_status == "INVALID"
                         else "execution_feedback_requires_reconciliation")
        if valid and safe_terminal and counter_status != "INVALID":
            # Confirm the cumulative ledger BEFORE updating delivered_g.
            # The ledger identifies measured terminal session deliveries; it
            # never retroactively attributes legacy/manual volume by date.
            delta_stock = stock - previous_stock
            mass_g = delta_stock * concentration
            review_reason = accept_delivery(
                state, session["obligation_id"], payload["sessionId"], event_id,
                obligation, stock_l=delta_stock, mass_g=mass_g,
                concentration_g_l=concentration, counter_status=counter_status,
                tolerance_g=tolerance
            )
        if not valid or not safe_terminal or counter_status == "INVALID" or review_reason:
            session["status"] = obligation["status"] = "REQUIRES_REVIEW"
            reasons = obligation.setdefault("review_reasons", [])
            if review_reason not in reasons:
                reasons.append(review_reason)
            result = {"status": "REQUIRES_REVIEW", "dose_changed": False,
                      "delivered_g": obligation["delivered_g"],
                      "counter_evidence": counter_status}
        else:
            # All evidence committed atomically with the persistent ledger.
            obligation["delivered_g"] += mass_g
            session.update(water_l=water, stock_l=stock)
            if target - obligation["delivered_g"] <= tolerance:
                session["status"] = obligation["status"] = "COMPLETED"
            elif payload["state"] == "WAITING_FOR_WATER" and payload.get("stopReason") == "water_low":
                session["status"] = obligation["status"] = "WAITING_FOR_WATER"
                state["stable_since"] = None
            else:
                session["status"] = obligation["status"] = "PARTIAL"
            if counter_status == "MATCHED":
                learn_counter_ema(state, session, payload, event_id, proof)
            result = {"status": session["status"], "dose_changed": mass_g > 0,
                      "delivered_g": obligation["delivered_g"],
                      "counter_evidence": counter_status}

        state["feedback"][event_id] = {"fingerprint": fingerprint, "result": result}
        return result
