"""Deterministic synthetic fixtures, never device observations."""
from datetime import date, datetime, timedelta, timezone
from .engine import Engine
from .models import Config, Feedback, Program, Snapshot
from .store import SQLiteStore


def sample(now, **changes):
    return Snapshot.model_validate({"message_id": now.isoformat(), "recorded_at": now,
        "mode": "automatic", "emergency_stop": False, "critical_fault": False, "interlock": False,
        "execution_known": True, "pumps_off": True, "moisture": 20, "moisture_valid": True,
        "water_percent": 100, "water_valid": True, "fertilizer_percent": 100, "fertilizer_valid": True,
        "water_flow_valid": True, "fertilizer_flow_valid": True, **changes})


def program():
    return Program(program_id="demo-hst-10", planting_date=date(2026, 10, 1), application_date=date(2026, 10, 11),
                   target_stock_l=200, concentration_g_l=25, approved=True)


def final_feedback(session, end, *, reason="target_reached", fraction=1):
    plan = session["plan"]
    # Same nominal flows, separate per-pump active durations. Water includes priming/flushing.
    water = plan["water_l"] * fraction
    stock = plan["stock_l"] * fraction
    return Feedback(session_id=session["session_id"], event_id="final-" + session["session_id"], recorded_at=end,
                    actual_water_l=water, actual_stock_l=stock, water_on_seconds=water / 220 * 60,
                    fertilizer_on_seconds=stock / 7 * 60, measurement_valid=True, pumps_off=True,
                    safe_shutdown_complete=True, reason=reason)


def run_scenario(name, config=None):
    c = config or Config()
    store = SQLiteStore()
    engine = Engine(store, c, simulator=True)
    now = datetime(2026, 10, 11, 1, tzinfo=timezone.utc)
    p = program()
    events = []
    try:
        if name in ("dry-soil", "wet-soil"):
            events.append(engine.evaluate(sample(now, moisture=20 if name == "dry-soil" else 95), [], now))
        elif name in ("refill-same-day", "refill-next-day", "no-refill", "emergency-stop", "manual", "invalid-flow", "duplicate-feedback", "schedule-conflict", "complete"):
            events.append(engine.evaluate(sample(now, rain=True), [p], now))
            session = engine.start_mock(events[-1]["decision_id"], now)
            events.append(session)
            end = now + timedelta(minutes=20)
            f = final_feedback(session, end, reason="water_low", fraction=0.5)
            if name == "invalid-flow":
                f = f.model_copy(update={"measurement_valid": False})
            events.append(engine.feedback_mock(f))
            if name == "duplicate-feedback":
                events.append(engine.feedback_mock(f))
            elif name in ("emergency-stop", "manual"):
                events.append(engine.evaluate(sample(end + timedelta(seconds=60), **({"emergency_stop": True} if name == "emergency-stop" else {"mode": "manual"})), [p], end + timedelta(seconds=60)))
                events.append(engine.evaluate(sample(end + timedelta(seconds=120)), [p], end + timedelta(seconds=120)))
            elif name == "no-refill":
                events.append(engine.evaluate(sample(end, water_percent=4), [p], end))
            elif name in ("refill-same-day", "refill-next-day", "complete", "schedule-conflict"):
                when = end + (timedelta(days=1) if name == "refill-next-day" else timedelta(seconds=60))
                programs = [p]
                if name == "schedule-conflict":
                    programs.append(p.model_copy(update={"program_id": "second-schedule"}))
                events.append(engine.evaluate(sample(when), programs, when))
                when += timedelta(seconds=c.water_level_stable_duration + 1)
                events.append(engine.evaluate(sample(when), programs, when))
                if name == "complete":
                    # Several water fills may be required; always use measured session totals.
                    for _ in range(10):
                        d = events[-1]
                        if d["type"] != "FERTIGATE":
                            break
                        session = engine.start_mock(d["decision_id"], when)
                        when += timedelta(minutes=30)
                        result = engine.feedback_mock(final_feedback(session, when))
                        events.append(result)
                        if result["obligation"]["status"] == "COMPLETED":
                            events.append(engine.evaluate(sample(when + timedelta(days=1), moisture=95), programs, when + timedelta(days=1)))
                            break
                        when += timedelta(seconds=c.minimum_restart_interval + 1)
                        events.append(engine.evaluate(sample(when), programs, when))
        else:
            raise ValueError("unknown scenario")
        return {"scenario": name, "simulation": True, "hardware_commands": 0, "events": events, "state": store.read()}
    finally:
        store.close()


SCENARIOS = ["dry-soil", "wet-soil", "refill-same-day", "refill-next-day", "no-refill", "emergency-stop",
             "manual", "invalid-flow", "duplicate-feedback", "schedule-conflict", "complete"]
