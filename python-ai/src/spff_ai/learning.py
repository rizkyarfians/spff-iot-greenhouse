"""Counter-backed EMA, with persisted watermark, audit trace and reset latch."""
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from .core import EMA, fresh, number, sensor_ok


@dataclass(frozen=True)
class FlowState:
    value: float | None = None
    last_at: datetime | None = None
    count: int = 0
    seen_at: datetime | None = None
    total_l: float | None = None
    counter_high_water: float | None = None
    baseline_at: datetime | None = None
    baseline_valid: bool = False
    reset_pending: bool = False
    profile_revision: str = "default-v1"

    def json(self):
        return {k: v.isoformat() if isinstance(v, datetime) else v for k, v in asdict(self).items()}

    @classmethod
    def load(cls, value):
        value = dict(value)
        for key in ("last_at", "seen_at", "baseline_at"):
            if isinstance(value.get(key), str):
                value[key] = datetime.fromisoformat(value[key])
        return cls(**value)


def learn_feedback(state, row, key, now, *, alpha=.2, min_seconds=5, max_age=120,
                   status_age=90, outlier_factor=3, profile_revision="default-v1"):
    if not number(alpha) or not 0 < alpha <= 1:
        raise ValueError("Invalid alpha")
    if not number(min_seconds) or min_seconds <= 0 or not number(outlier_factor) or outlier_factor <= 1:
        raise ValueError("Invalid flow learning limits")
    trace = {"accepted": False, "reason": "", "alpha": alpha, "actual_lpm": None,
             "previous_lpm": state.value, "profile_revision": profile_revision}

    def reject(reason, new_state=state):
        return new_state, {**trace, "reason": reason, "sample_count": new_state.count}

    at = row.get("recorded_at")
    if not fresh(at, now, max_age):
        return reject("timestamp_invalid_or_stale")
    if state.seen_at and at <= state.seen_at:
        return reject("duplicate_or_out_of_order")
    if state.profile_revision != profile_revision:
        # A reviewed revision change starts a new model and counter baseline,
        # retaining the watermark so historic feedback is not relearned.
        state = FlowState(seen_at=state.seen_at, profile_revision=profile_revision)
    total_key = key.replace("_lpm", "_total_l")
    valid = (sensor_ok(row, key, now, max_age) and sensor_ok(row, total_key, now, max_age)
             and row.get("pump_state") == "active" and row.get("pump_active") is True
             and fresh(row.get("pump_at"), at, status_age))
    total = row.get(total_key) if sensor_ok(row, total_key, now, max_age) else None
    next_state = replace(state, seen_at=at, total_l=total, baseline_at=at, baseline_valid=valid)
    high_water = state.counter_high_water if state.counter_high_water is not None else state.total_l
    next_state = replace(next_state, counter_high_water=high_water)
    if total is not None:
        next_state = replace(next_state, counter_high_water=max(total, high_water or 0))
    if state.reset_pending:
        return reject("counter_reset_requires_review", next_state)
    if total is not None and high_water is not None and total < high_water:
        return reject("counter_reset_requires_review", replace(next_state, reset_pending=True))
    if not valid or not row.get(key) or row[key] <= 0:
        return reject("flow_or_pump_not_valid", next_state)
    if state.baseline_at is None or state.total_l is None or not state.baseline_valid:
        return reject("waiting_counter_baseline", next_state)
    seconds = (at-state.baseline_at).total_seconds()
    if seconds < min_seconds:
        return reject("interval_too_short", replace(state, seen_at=at))
    if seconds > max_age or row["pump_at"] > state.baseline_at:
        return reject("interval_not_covered_by_pump_feedback", next_state)
    actual = (total-state.total_l)*60/seconds
    trace["actual_lpm"] = actual
    if not number(actual) or not 0 < actual <= 10000:
        return reject("counter_delta_invalid", next_state)
    if max(actual/row[key], row[key]/actual) > outlier_factor:
        return reject("counter_and_instantaneous_disagree", next_state)
    if state.value and max(actual/state.value, state.value/actual) > outlier_factor:
        return reject("flow_outlier", next_state)
    learned = EMA(state.value, state.last_at).observe(actual, at, alpha)
    next_state = replace(next_state, value=learned.value, last_at=at, count=state.count+1)
    return next_state, {**trace, "accepted": True, "reason": "counter_backed_actual",
                        "new_lpm": learned.value, "interval_seconds": seconds,
                        "sample_count": next_state.count}
