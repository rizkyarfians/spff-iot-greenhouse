"""Read-only, fail-closed evaluation of ESP32 1.5.03 adaptive IDLE output reports.

The I2C output-expander readback is controller-reported output state, not
independent electrical contact feedback or proof of hydraulic delivery.
This module never authorizes pump dispatch or credits a fertilizer dose.
"""
from datetime import datetime, timezone
import re

BOOT_ID = re.compile(r"^[0-9a-f]{16}$")
EXPECTED_FIRMWARE = "1.5.03-SHT20-TELEMETRY-SYNC"
MAX_ADAPTIVE_AGE_SECONDS = 25
MAX_STATUS_AGE_SECONDS = 30
MAX_CLOCK_SKEW_SECONDS = 5


def _as_utc(value):
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)


def _is_fresh(value, now, seconds):
    dt = _as_utc(value)
    return dt is not None and -MAX_CLOCK_SKEW_SECONDS <= (now - dt).total_seconds() <= seconds


def assess_adaptive_feedback(frame, device, now):
    """Return conservative diagnostics; `reported_off` is NOT relay-contact proof.

    Both adaptive and status evidence must be contemporaneous, matched to the
    same boot, and explicitly known/OFF. Terminal session states are NOT a
    substitute for a safe-shutdown ACK or per-session measured volume.
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    now = now.astimezone(timezone.utc)
    frame = frame if isinstance(frame, dict) else {}
    device = device if isinstance(device, dict) else {}
    payload = frame.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    reasons = []

    if not frame:
        reasons.append("execution_feedback_unavailable")
    elif payload.get("kind") != "adaptive_fert_telemetry":
        reasons.append("execution_feedback_kind_invalid")

    if not _is_fresh(frame.get("received_at"), now, MAX_ADAPTIVE_AGE_SECONDS) or not _is_fresh(
        payload.get("timestamp"), now, MAX_ADAPTIVE_AGE_SECONDS
    ):
        reasons.append("execution_feedback_stale")
    received, emitted = _as_utc(frame.get("received_at")), _as_utc(payload.get("timestamp"))
    if received is not None and emitted is not None and (emitted - received).total_seconds() > MAX_CLOCK_SKEW_SECONDS:
        reasons.append("execution_feedback_clock_conflict")

    if device.get("online") is not True or not _is_fresh(device.get("recorded_at"), now, MAX_STATUS_AGE_SECONDS) or not _is_fresh(
        device.get("received_at"), now, MAX_STATUS_AGE_SECONDS
    ):
        reasons.append("execution_feedback_device_status_unavailable")

    adaptive_boot = payload.get("bootId")
    status_boot = device.get("pulse_boot_id")
    boot_known = (isinstance(adaptive_boot, str) and isinstance(status_boot, str)
                  and BOOT_ID.fullmatch(adaptive_boot) is not None
                  and BOOT_ID.fullmatch(status_boot) is not None)
    if not boot_known:
        reasons.append("execution_feedback_boot_unavailable")
    elif adaptive_boot != status_boot:
        reasons.append("execution_feedback_boot_mismatch")

    if payload.get("firmwareVersion") != EXPECTED_FIRMWARE:
        reasons.append("execution_feedback_firmware_unverified")
    if payload.get("state") != "IDLE":
        reasons.append("device_busy_faulted_or_pumps_not_verified_off")
    output_known = payload.get("waterPumpKnown") is True and payload.get("fertPumpKnown") is True
    if not output_known:
        reasons.append("execution_feedback_output_unknown")
    reported_off = payload.get("waterPump") is False and payload.get("fertPump") is False
    if not reported_off:
        reasons.append("device_busy_faulted_or_pumps_not_verified_off")

    reasons = sorted(set(reasons))
    return {
        "source": "spff.adaptive_fert_events",
        "status": "REPORTED_OFF_FRESH" if not reasons else "UNVERIFIED",
        "reported_off": not reasons,
        "output_readback_known": output_known,
        "boot_matches": boot_known and adaptive_boot == status_boot,
        "controller_state": payload.get("state") if isinstance(payload.get("state"), str) else None,
        "water_pump": payload.get("waterPump") if type(payload.get("waterPump")) is bool else None,
        "fert_pump": payload.get("fertPump") if type(payload.get("fertPump")) is bool else None,
        "received_at": received.isoformat() if received else None,
        "reported_at": emitted.isoformat() if emitted else None,
        "hold_reasons": reasons,
        "physical_relay_contact_verified": False,
        "safe_shutdown_verified": False,
        "session_volume_verified": False,
        "can_dispatch": False,
    }
