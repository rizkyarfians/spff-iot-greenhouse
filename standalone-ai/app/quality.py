"""Conservative source-side quality gate for SHADOW irrigation planning.

Transport-valid Modbus is not necessarily a credible soil measurement.
Do not synthesize replacement values or let repeated background polls count as
independent confirmations of the same telemetry message.
Thresholds are initial simulation-only safeguards, not field calibration.
"""
from datetime import datetime, timezone
from math import isfinite

# Conservative provisional values; field trials must calibrate these.
MAX_JUMP_PERCENT_POINTS = 15.0
MAX_CONFIRMATION_SPREAD = 3.0
REQUIRED_DISTINCT_CONFIRMATIONS = 3
MAX_CONFIRMATION_GAP_SECONDS = 120.0


def _utc(value):
    try:
        time = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return time.astimezone(timezone.utc) if time.tzinfo else None
    except (TypeError, ValueError, OverflowError):
        return None


def check_soil_control_quality(state, sample, sensor_key):
    """Return (accepted, hold_reason); persist independently per sensor.

    Only actual, distinct, time-ordered telemetry messages are confirmations.
    A cached/failed Modbus read is never interpreted as a new observation.
    """
    health = (sample.get("sensor_health") or {}).get(sensor_key) or {}
    value = sample.get(sensor_key)
    observed = _utc(sample.get("recorded_at"))
    message_id = sample.get("message_id")
    if (not isinstance(value, (int, float)) or isinstance(value, bool)
            or not isfinite(value) or not 0 <= value <= 100
            or health.get("valid") is not True or observed is None
            or not isinstance(message_id, str) or not message_id):
        return False, "soil_moisture_untrusted_or_missing"
    if (health.get("controlValid") is False or health.get("rawFresh") is False
            or health.get("lastPollOk") is False):
        return False, "soil_moisture_read_not_control_valid"

    entry = state.setdefault("moisture_quality", {}).setdefault(sensor_key, {})
    previous = entry.get("last_observation")
    if previous and previous.get("id") == message_id:
        if previous.get("at") != observed.isoformat() or previous.get("value") != value:
            return False, "soil_moisture_conflicting_message_id"
        return previous["accepted"], previous.get("reason")
    if previous and (prior_at := _utc(previous.get("at"))) and observed <= prior_at:
        return False, "soil_moisture_out_of_order"

    accepted = entry.get("accepted")
    reference = float(accepted["value"]) if accepted else None
    candidate = entry.get("candidate")
    reason = None
    trustworthy = False

    # A first-ever raw zero cannot establish a trusted dry-soil baseline.
    # Large jumps require multiple independent, consistent valid frames.
    suspicious = (reference is None and value == 0) or (
        reference is not None and abs(value - reference) > MAX_JUMP_PERCENT_POINTS
    )
    if not suspicious:
        trustworthy = True
        entry.pop("candidate", None)
    else:
        same_candidate = (
            candidate is not None
            and abs(value - candidate["value"]) <= MAX_CONFIRMATION_SPREAD
            and (candidate_at := _utc(candidate.get("at"))) is not None
            and 0 < (observed - candidate_at).total_seconds() <= MAX_CONFIRMATION_GAP_SECONDS
        )
        count = candidate["count"] + 1 if same_candidate else 1
        entry["candidate"] = {"value": value, "count": count, "at": observed.isoformat()}
        if count >= REQUIRED_DISTINCT_CONFIRMATIONS:
            trustworthy = True
            entry.pop("candidate", None)
        else:
            reason = "soil_moisture_suspect_change"

    if trustworthy:
        entry["accepted"] = {"value": value, "at": observed.isoformat(), "id": message_id}
    entry["last_observation"] = {
        "value": value, "at": observed.isoformat(), "id": message_id,
        "accepted": trustworthy, "reason": reason
    }
    return trustworthy, reason
