"""Read-only historical counter-window estimator for NON-OPERATIONAL previews.

This is not physical calibration. In particular, it must never update runtime
profiles, dosing ledgers, or dispatch state. Gaps, rollovers, stale or invalid
samples break the series; never sum counters across resets/reboots.
"""
from datetime import datetime, timezone
from math import isfinite


def _utc(value):
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _value(value):
    if (isinstance(value, (int, float)) and not isinstance(value, bool)
            and isfinite(value) and value >= 0):
        return float(value)
    return None


def _good(row, key):
    health = row.get("sensor_health")
    return (isinstance(health, dict)
            and isinstance(health.get(key), dict)
            and health[key].get("valid") is True)


def observed_flow_reference(rows, minimum_intervals=3):
    """Most recent contiguous positive *dual-flow* counter window.

    No claim is made about pump actuation, stock formulation, meter accuracy,
    or delivery to the plants. Results are historical observations only.
    """
    ordered = sorted(
        (r for r in rows if isinstance(r, dict) and _utc(r.get("recorded_at"))),
        key=lambda r: _utc(r["recorded_at"]),
    )
    segments = []
    active = []

    def finish():
        nonlocal active
        if len(active) >= minimum_intervals:
            duration = sum(p[0] for p in active)
            if duration >= 60:
                dw = sum(p[1] for p in active)
                df = sum(p[2] for p in active)
                segments.append({
                    "basis": "UNVERIFIED_HISTORICAL_COUNTER_DELTAS",
                    "water_lpm": dw * 60 / duration,
                    "stock_lpm": df * 60 / duration,
                    "water_delta_l": dw,
                    "stock_delta_l": df,
                    "duration_seconds": duration,
                    "interval_count": len(active),
                    "started_at": active[0][3].isoformat(),
                    "ended_at": active[-1][4].isoformat(),
                })
        active = []

    for before, after in zip(ordered, ordered[1:]):
        start = _utc(before["recorded_at"])
        end = _utc(after["recorded_at"])
        seconds = (end - start).total_seconds()
        good = all((
            _good(before, "flow_water_total_l"),
            _good(before, "flow_fert_total_l"),
            _good(after, "flow_water_total_l"),
            _good(after, "flow_fert_total_l"),
        ))
        bw = _value(before.get("flow_water_total_l"))
        aw = _value(after.get("flow_water_total_l"))
        bf = _value(before.get("flow_fert_total_l"))
        af = _value(after.get("flow_fert_total_l"))
        if good and 1 <= seconds <= 45 and None not in (bw, aw, bf, af):
            dw = aw - bw
            df = af - bf
            if 0 < dw < 10000 and 0 < df < 10000:
                active.append((seconds, dw, df, start, end))
                continue
        finish()
    finish()
    return max(segments, key=lambda v: v["ended_at"]) if segments else None
