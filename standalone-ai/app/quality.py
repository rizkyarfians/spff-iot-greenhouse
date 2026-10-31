"""Fail-closed soil moisture quality for source-backed SHADOW Fuzzy.

Do not count repeated MQTT telemetry snapshots of the same cached Modbus
reading as independent measurements. Limits are provisional, not field-certified.
"""
from datetime import datetime, timedelta, timezone
from math import isfinite

MAX_JUMP_PERCENT_POINTS = 15.0  # provisional, requires soil/sensor calibration
MAX_CONFIRMATION_SPREAD = 3.0
REQUIRED_DISTINCT_CONFIRMATIONS = 3
MAX_CONFIRMATION_GAP_SECONDS = 120.0
MAX_RAW_AGE_MS = 60000  # observed firmware freshness, not AI source TTL


def _utc(value):
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return moment.astimezone(timezone.utc) if moment.tzinfo else None
    except (TypeError, ValueError, OverflowError):
        return None


def check_soil_control_quality(state, sample, sensor_key):
    """Return (accepted, reason) after validating distinct *sensor* samples.

    Requires audited per-register diagnostic metadata from raw_payload's
    sensorHealth, copied by the source adapter. Missing proof means HOLD.
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

    if health.get("controlValid") is False:
        return False, "soil_moisture_read_not_control_valid"
    age = health.get("rawAgeMs")
    boot_id = health.get("pollBootId")
    raw = health.get("raw")
    if (health.get("rawFresh") is not True
            or health.get("lastPollOk") is not True
            or not isinstance(age, int) or isinstance(age, bool)
            or not 0 <= age <= MAX_RAW_AGE_MS
            or not isinstance(raw, int) or isinstance(raw, bool)
            or not 0 <= raw <= 1000 or abs(raw / 10.0 - value) > 0.11
            or not isinstance(boot_id, str) or not boot_id):
        return False, "soil_moisture_diagnostics_missing_or_failed"

    sampled_at = observed - timedelta(milliseconds=age)
    entry = state.setdefault("moisture_quality", {}).setdefault(sensor_key, {})
    if entry.get("boot_id") != boot_id:
        entry.clear()
        entry["boot_id"] = boot_id

    previous = entry.get("last_observation")
    if previous and previous.get("id") == message_id:
        if previous.get("at") != observed.isoformat() or previous.get("value") != value:
            return False, "soil_moisture_conflicting_message_id"
        return previous["accepted"], previous.get("reason")
    if previous:
        prev_at = _utc(previous.get("at"))
        if prev_at and observed <= prev_at:
            return False, "soil_moisture_out_of_order"
        prev_sampled = _utc(previous.get("sampled_at"))
        if prev_sampled and (sampled_at - prev_sampled).total_seconds() <= 1.0:
            entry["last_observation"] = {
                "id": message_id, "at": observed.isoformat(),
                "sampled_at": sampled_at.isoformat(), "value": value,
                "accepted": False, "reason": "soil_moisture_cached_measurement"
            }
            return False, "soil_moisture_cached_measurement"

    accepted = entry.get("accepted")
    reference = float(accepted["value"]) if accepted else None
    candidate = entry.get("candidate")
    suspicious = (reference is None and value == 0) or (
        reference is not None and abs(value - reference) > MAX_JUMP_PERCENT_POINTS
    )
    trusted = False
    reason = None
    if not suspicious:
        trusted = True
        entry.pop("candidate", None)
    else:
        candidate_at = _utc(candidate.get("sampled_at")) if candidate else None
        same = (candidate and candidate_at
                and abs(value - candidate["value"]) <= MAX_CONFIRMATION_SPREAD
                and 0 < (sampled_at - candidate_at).total_seconds() <= MAX_CONFIRMATION_GAP_SECONDS)
        count = candidate["count"] + 1 if same else 1
        entry["candidate"] = {
            "value": value, "count": count, "sampled_at": sampled_at.isoformat()
        }
        if count >= REQUIRED_DISTINCT_CONFIRMATIONS:
            trusted = True
            entry.pop("candidate", None)
        else:
            reason = "soil_moisture_suspect_change"

    if trusted:
        entry["accepted"] = {"value": value, "at": observed.isoformat(),
                             "sampled_at": sampled_at.isoformat(), "id": message_id}
    entry["last_observation"] = {
        "id": message_id, "at": observed.isoformat(),
        "sampled_at": sampled_at.isoformat(), "value": value,
        "accepted": trusted, "reason": reason
    }
    return trusted, reason
