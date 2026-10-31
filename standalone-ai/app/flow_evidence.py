"""Counter-backed flow learning for explicitly bound SHADOW sessions.

Borrowed safety principles from python-ai's FlowState: persisted high-water mark,
reset latch, independent pump models, and no learning from estimated flow.
This adapter does NOT infer a baseline from the latest telemetry. A future
validated dispatcher must explicitly bind cumulative counters to the session.
"""
from math import isfinite

PUMPS = {
    "water": ("waterFlowTotalL", "waterVolumeL", "waterOnSeconds"),
    "fertilizer": ("fertFlowTotalL", "fertVolumeL", "fertilizerOnSeconds"),
}
MIN_PUMP_SECONDS = 5
MAX_FLOW_LPM = 10000
OUTLIER_FACTOR = 3.0
COUNTER_TOLERANCE_RATIO = 0.05
COUNTER_TOLERANCE_L = 0.05


def number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and isfinite(value)


def counter_evidence(state, session, payload):
    """Return (status, reason, per-pump proof).

    MISSING allows historical validated session-volume bookkeeping but NEVER EMA.
    INVALID blocks both dosing and learning when contradictory evidence was
    supplied. MATCHED proves delta against explicitly bound start counters.
    """
    baseline = session.get("flow_counter_baseline")
    present = any(key in payload for key, _, _ in PUMPS.values())
    if baseline is None and not present:
        return "MISSING", "no_bound_counter_baseline", {}
    if not isinstance(baseline, dict) or not present:
        return "INVALID", "incomplete_counter_evidence", {}
    if session.get("boot_id") != payload.get("bootId"):
        return "INVALID", "counter_boot_mismatch", {}

    progress = state.setdefault("flow_counter_state", {})
    evidence = {}
    for pump, (total_key, volume_key, _) in PUMPS.items():
        start, end, delivered = baseline.get(pump), payload.get(total_key), payload.get(volume_key)
        if not all(number(x) and x >= 0 for x in (start, end, delivered)):
            return "INVALID", "invalid_counter_or_delivery", {}
        last = progress.get(pump) or {}
        if last.get("reset_pending"):
            return "INVALID", "counter_reset_requires_review", {}
        if last.get("boot_id") and last["boot_id"] != payload["bootId"]:
            last["reset_pending"] = True
            progress[pump] = last
            return "INVALID", "counter_boot_change_requires_review", {}
        previous_high = last.get("high_water_l")
        if (end < start or (number(previous_high) and
                            (start < previous_high or end < previous_high))):
            last["reset_pending"] = True
            progress[pump] = last
            return "INVALID", "counter_reset_requires_review", {}
        delta = end - start
        if abs(delta - delivered) > max(COUNTER_TOLERANCE_L, delivered * COUNTER_TOLERANCE_RATIO):
            return "INVALID", "counter_session_volume_conflict", {}
        evidence[pump] = {"start_l": start, "end_l": end, "delta_l": delta}
    return "MATCHED", None, evidence


def learn_counter_ema(state, session, payload, event_id, proof):
    """Update water/fertilizer EMA once a safe terminal delivery is committed.

    Counter state persists even if durations are missing or rate is an outlier,
    preventing previously seen counters from being learned a second time.
    """
    version = session["configuration_version"]
    alpha = session["alpha"]
    model = state.setdefault("ema", {}).setdefault(version, dict(session["ema_used"]))
    previous = state.setdefault("flow_counter_state", {})
    rejected = state.setdefault("ema_rejections", [])
    from .engine import timestamp
    elapsed = (timestamp(payload["timestamp"]) - timestamp(session["started_at"])).total_seconds()

    for pump, (_, _, duration_key) in PUMPS.items():
        data = proof[pump]
        previous[pump] = {
            "boot_id": payload["bootId"], "high_water_l": data["end_l"],
            "last_event_id": event_id, "reset_pending": False
        }
        seconds = payload.get(duration_key)
        reason = None
        if not number(seconds) or seconds < MIN_PUMP_SECONDS or seconds > elapsed + 1:
            reason = "pump_active_duration_missing_or_invalid"
        elif not number(alpha) or not 0 < alpha <= 1:
            reason = "invalid_ema_alpha"
        elif data["delta_l"] == 0:
            reason = "zero_flow_no_learning"
        else:
            actual = data["delta_l"] / seconds * 60
            old = model.get(pump)
            if not 0 < actual <= MAX_FLOW_LPM:
                reason = "invalid_counter_flow_rate"
            elif not number(old) or old <= 0:
                reason = "invalid_model_baseline"
            elif max(actual / old, old / actual) > OUTLIER_FACTOR:
                reason = "counter_flow_outlier"
            else:
                updated = alpha * actual + (1 - alpha) * old
                model[pump] = updated
                state["ema_history"].append({
                    "session_id": payload["sessionId"], "pump": pump,
                    "old": old, "actual": actual, "new": updated,
                    "event_id": event_id, "counter_backed": True,
                    "counter_start_l": data["start_l"], "counter_end_l": data["end_l"]
                })
        if reason:
            rejected.append({"session_id": payload["sessionId"], "pump": pump,
                             "event_id": event_id, "reason": reason})
    # Avoid uncontrolled JSONB state growth from rejected records.
    del rejected[:-256]
