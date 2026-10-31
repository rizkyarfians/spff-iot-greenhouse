from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from .calculations import fuzzy_volume, occurrences, plan_fertigation, tank_liters
from .models import Config, Feedback, Program, Snapshot


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, allow_nan=False).encode()).hexdigest()


def timestamp(value):
    return datetime.fromisoformat(value)


class Engine:
    def __init__(self, store, config: Config, *, mode="SHADOW_MODE", simulator=False):
        if mode not in ("SHADOW_MODE", "DRY_RUN", "ACTIVE"):
            raise ValueError("unknown AI mode")
        if mode == "ACTIVE":
            raise ValueError("ACTIVE unavailable: existing set_pump contract lacks volume sessions and relay ownership arbitration")
        self.store, self.config, self.mode, self.simulator = store, config, mode, simulator

    def evaluate(self, snapshot: Snapshot, programs: list[Program], now=None):
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            raise ValueError("evaluation time must include timezone")
        if self.mode == "DRY_RUN":
            # A private copy ensures DRY_RUN cannot reserve obligations or mutate EMA.
            from .store import SQLiteStore
            scratch = SQLiteStore()
            try:
                with scratch.transaction() as state:
                    state.update(self.store.read())
                return Engine(scratch, self.config, mode="DRY_RUN", simulator=False)._evaluate(snapshot, programs, now)
            finally:
                scratch.close()
        return self._evaluate(snapshot, programs, now)

    def _evaluate(self, s, programs, now):
        c = self.config
        today = now.astimezone(ZoneInfo(c.timezone)).date()
        with self.store.transaction() as state:
            # Persisted evidence is scoped to device, config and mode by the caller.
            flows = state["ema"].get(c.version, {"water": c.water_flow_lpm, "fertilizer": c.fertilizer_flow_lpm})
            def decision(kind, reason, **values):
                identity = digest({"sample": s.model_dump(mode="json"), "kind": kind, "reason": reason,
                                   "values": values, "config": c.model_dump(), "mode": self.mode})
                if identity in state["decisions"]:
                    state["current_decision_id"] = state["decisions"][identity]["decision_id"]
                    return state["decisions"][identity]
                result = {"decision_id": str(uuid4()), "type": kind, "reason": reason,
                          "at": now.isoformat(), "mode": self.mode, "simulation": self.simulator,
                          "configuration_version": c.version, "ema_used": dict(flows),
                          "input_snapshot": s.model_dump(mode="json"), "dispatch_status": "NOT_DISPATCHED",
                          "can_dispatch": False, **values}
                state["decisions"][identity] = result
                state["current_decision_id"] = result["decision_id"]
                return result

            age = (now - s.recorded_at).total_seconds()
            last = state["last_sample"]
            if age < -5 or age > c.sensor_data_max_age:
                state["stable_since"] = None
                return decision("HOLD", "stale_or_future_sensor_data")
            if last and s.recorded_at < timestamp(last["at"]):
                state["stable_since"] = None
                return decision("HOLD", "out_of_order_sensor_data")
            if last and s.message_id == last["id"] and digest(s.model_dump(mode="json")) != last["digest"]:
                state["stable_since"] = None
                return decision("HOLD", "conflicting_sensor_replay")
            fresh_sample = not last or s.message_id != last["id"]
            if fresh_sample:
                if last and (s.recorded_at - timestamp(last["at"])).total_seconds() > c.sensor_data_max_age:
                    state["stable_since"] = None
                state["last_sample"] = {"id": s.message_id, "at": s.recorded_at.isoformat(), "digest": digest(s.model_dump(mode="json"))}
            active = [o for o in state["obligations"].values() if o["status"] != "COMPLETED"]
            safety = ("manual_mode" if s.mode != "automatic" else
                      "emergency_stop" if s.emergency_stop else
                      "critical_fault" if s.critical_fault else
                      "execution_unreconciled" if not s.execution_known else
                      "interlock_active" if s.interlock else None)
            if safety:
                state["stable_since"] = None
                # Manual/E-stop/fault revoke unattended resumption persistently.
                if safety != "interlock_active":
                    for obligation in active:
                        obligation["status"] = "REQUIRES_REVIEW"
                        obligation["review_reason"] = safety
                return decision("HOLD", safety)
            if not s.water_valid or not s.water_flow_valid:
                state["stable_since"] = None
                return decision("HOLD", "invalid_water_sensor_or_flow")
            if s.water_percent >= c.water_level_start_threshold:
                if state["stable_since"] is None:
                    state["stable_since"] = s.recorded_at.isoformat()
            else:
                state["stable_since"] = None

            # Calendar obligations are created once, with immutable dose/concentration snapshots.
            for program in programs:
                for day in occurrences(program, today):
                    key = digest([program.program_id, str(program.planting_date), str(day)])
                    existing = state["obligations"].get(key)
                    recipe_hash = digest(program.model_dump(mode="json"))
                    if existing:
                        if existing["program_hash"] != recipe_hash and existing["status"] != "COMPLETED":
                            existing["status"] = "REQUIRES_REVIEW"
                            existing["review_reason"] = "program_changed_with_outstanding_dose"
                        continue
                    state["obligations"][key] = {
                        "obligation_id": key, "program_id": program.program_id, "program_hash": recipe_hash,
                        "program_revision": program.revision, "due_date": str(day), "planting_date": str(program.planting_date),
                        "concentration_g_l": program.concentration_g_l,
                        "target_g": program.target_stock_l * program.concentration_g_l,
                        "delivered_g": 0.0, "status": "PENDING", "created_at": now.isoformat()}
            active = sorted((o for o in state["obligations"].values() if o["status"] != "COMPLETED"),
                            key=lambda o: (o["due_date"], o["obligation_id"]))
            if any(x["status"] == "REQUIRES_REVIEW" for x in active):
                return decision("HOLD", "outstanding_obligation_requires_review")
            if any(x["status"] == "REQUIRES_REVIEW" for x in state["sessions"].values()):
                return decision("HOLD", "session_requires_review")
            if any(x["status"] == "RUNNING" for x in state["sessions"].values()) or not s.pumps_off:
                return decision("HOLD", "session_running_or_pumps_not_confirmed_off")
            if state["last_start"] and (now - timestamp(state["last_start"])).total_seconds() < c.minimum_restart_interval:
                return decision("HOLD", "minimum_restart_interval")
            # An approved sensor-triggered fertilizer rule is not silently converted to a mandatory daily dose.
            if any(p.approved and p.application_mode == "sensor" and
                   p.hst_from <= (today - p.planting_date).days <= p.hst_to for p in programs):
                return decision("HOLD", "sensor_schedule_needs_explicit_calendar_policy")
            if active:
                o = active[0]
                conflict = [x["obligation_id"] for x in active[1:]]
                metadata = {"obligation_id": o["obligation_id"], "schedule_id": o["due_date"],
                            "program_id": o["program_id"], "hst": (today - timestamp(o["planting_date"] + "T00:00:00").date()).days,
                            "conflict_policy": "oldest_due_first_no_merge", "queued_obligations": conflict,
                            "remaining_g": max(0, o["target_g"] - o["delivered_g"])}
                if not s.fertilizer_valid or not s.fertilizer_flow_valid:
                    return decision("HOLD", "invalid_fertilizer_sensor_or_flow", **metadata)
                if s.water_percent < c.water_level_start_threshold:
                    o["status"] = "WAITING_FOR_WATER"
                    return decision("HOLD", "waiting_for_water", **metadata)
                if o["status"] == "WAITING_FOR_WATER":
                    elapsed = (s.recorded_at - timestamp(state["stable_since"])).total_seconds()
                    if elapsed < c.water_level_stable_duration:
                        return decision("HOLD", "waiting_for_stable_refill", **metadata)
                plan = plan_fertigation(metadata["remaining_g"], o["concentration_g_l"], s.water_percent,
                                       s.fertilizer_percent, flows, c)
                if "hold" in plan:
                    return decision("HOLD", plan["hold"], **metadata)
                return decision("FERTIGATE", "scheduled_obligation", plan=plan, **metadata)
            if not s.moisture_valid:
                return decision("HOLD", "invalid_soil_moisture")
            if state["last_irrigation_sample"] == s.message_id:
                return decision("HOLD", "await_new_soil_sample_after_irrigation")
            fuzzy = fuzzy_volume(s.moisture, c)
            if fuzzy["water_l"] == 0:
                return decision("OFF", "fuzzy_no_water_needed", fuzzy=fuzzy)
            available = tank_liters(s.water_percent, c.water_curve) - tank_liters(c.water_level_stop_threshold, c.water_curve)
            target = min(fuzzy["water_l"], c.max_session_water_l, max(0, available - c.minimum_flush_reserve),
                         flows["water"] * c.max_session_seconds / 60)
            if s.water_percent < c.water_level_start_threshold or target <= 0:
                return decision("HOLD", "insufficient_irrigation_water")
            return decision("IRRIGATE", "fuzzy_mamdani", fuzzy=fuzzy,
                            plan={"water_l": target, "stock_l": 0.0, "mass_g": 0.0,
                                  "duration_seconds": target / flows["water"] * 60})

    def start_mock(self, decision_id, now=None):
        if not self.simulator or self.mode == "DRY_RUN":
            raise ValueError("mock sessions are available only in the isolated simulator")
        now = now or datetime.now(timezone.utc)
        with self.store.transaction() as state:
            d = next((d for d in state["decisions"].values() if d["decision_id"] == decision_id), None)
            if not d or d["type"] not in ("FERTIGATE", "IRRIGATE"):
                raise ValueError("decision does not permit a mock session")
            for session in state["sessions"].values():
                if session["decision_id"] == decision_id:
                    return session
            if any(s["status"] == "RUNNING" for s in state["sessions"].values()):
                raise ValueError("another session already owns the simulated pumps")
            # Never dispatch an older plan after a newer evaluation has invalidated it.
            if state.get("current_decision_id") != decision_id:
                raise ValueError("decision superseded; evaluate current telemetry")
            if (now - timestamp(d["input_snapshot"]["recorded_at"])).total_seconds() > self.config.sensor_data_max_age:
                raise ValueError("decision sensor snapshot expired")
            obligation = state["obligations"].get(d.get("obligation_id"))
            if obligation and obligation["status"] not in ("PENDING", "PARTIAL", "WAITING_FOR_WATER"):
                raise ValueError("obligation is not ready")
            session = {"session_id": str(uuid4()), "decision_id": decision_id, "status": "RUNNING",
                       "obligation_id": d.get("obligation_id"), "started_at": now.isoformat(),
                       "config_version": self.config.version, "plan": d["plan"],
                       "stages": ["PRIMING", "WATER_FLOW_VERIFIED", "INJECTING"] if d["type"] == "FERTIGATE" else ["WATER_ONLY"]}
            state["sessions"][session["session_id"]] = session
            state["last_start"] = now.isoformat()
            if d["type"] == "IRRIGATE":
                state["last_irrigation_sample"] = d["input_snapshot"]["message_id"]
            if obligation:
                obligation["status"] = "RUNNING"
            d["dispatch_status"] = "SIMULATED"
            return session

    def feedback_mock(self, feedback: Feedback):
        if not self.simulator:
            raise ValueError("untrusted HTTP feedback cannot change real SPFF dose or EMA")
        f, c = feedback, self.config
        with self.store.transaction() as state:
            session = state["sessions"].get(f.session_id)
            if not session:
                raise ValueError("unknown session")
            payload = f.model_dump(mode="json")
            previous = state["feedback"].get(f.session_id)
            if any(item["payload"]["event_id"] == f.event_id and sid != f.session_id
                   for sid, item in state["feedback"].items()):
                raise ValueError("feedback event ID was already used for a different session")
            if previous:
                if previous["payload"] != payload:
                    raise ValueError("conflicting final feedback for session")
                return previous["result"]
            if f.recorded_at < timestamp(session["started_at"]):
                raise ValueError("feedback precedes session start")
            o = state["obligations"].get(session["obligation_id"])
            plan = session["plan"]
            elapsed = (f.recorded_at - timestamp(session["started_at"])).total_seconds()
            trustworthy = (f.measurement_valid and f.pumps_off and f.safe_shutdown_complete
                           and f.actual_stock_l <= plan["stock_l"] + c.dose_tolerance_g / (o["concentration_g_l"] if o else 1)
                           and f.actual_water_l <= plan["water_l"] * 1.05
                           and f.water_on_seconds <= elapsed + 1 and f.fertilizer_on_seconds <= elapsed + 1
                           and (f.actual_water_l == 0 or f.water_on_seconds > 0)
                           and (f.actual_stock_l == 0 or f.fertilizer_on_seconds > 0)
                           and f.fertilizer_on_seconds <= f.water_on_seconds
                           and (f.actual_stock_l == 0 or f.actual_water_l >= c.priming_water_l + c.minimum_flush_reserve))
            revoked = f.reason in ("emergency_stop", "critical_fault", "manual", "restart", "stock_low")
            session["status"] = "COMPLETED" if trustworthy and not revoked else "REQUIRES_REVIEW"
            session["finished_at"] = f.recorded_at.isoformat()
            session["reason"] = f.reason
            session["actual_water_l"], session["actual_stock_l"] = f.actual_water_l, f.actual_stock_l
            session["stages"].extend(["SAFE_SHUTDOWN", "PUMPS_OFF"] if f.safe_shutdown_complete and f.pumps_off else ["UNVERIFIED_STOP"])
            if o:
                if trustworthy:
                    o["delivered_g"] += f.actual_stock_l * o["concentration_g_l"]
                if not trustworthy or revoked or o["status"] == "REQUIRES_REVIEW":
                    o["status"] = "REQUIRES_REVIEW"
                elif o["target_g"] - o["delivered_g"] <= c.dose_tolerance_g:
                    o["status"] = "COMPLETED"
                elif f.reason == "water_low":
                    o["status"] = "WAITING_FOR_WATER"
                    state["stable_since"] = None
                else:
                    o["status"] = "PARTIAL"
            if trustworthy and not revoked:
                model = state["ema"].setdefault(c.version, {"water": c.water_flow_lpm, "fertilizer": c.fertilizer_flow_lpm})
                for name, volume, seconds in (("water", f.actual_water_l, f.water_on_seconds),
                                              ("fertilizer", f.actual_stock_l, f.fertilizer_on_seconds)):
                    if seconds > 0 and volume > 0:
                        actual = volume / seconds * 60
                        previous_ema = model[name]
                        model[name] = c.alpha * actual + (1 - c.alpha) * previous_ema
                        state["ema_history"].append({"session_id": f.session_id, "pump": name,
                                                     "old": previous_ema, "actual": actual, "new": model[name],
                                                     "at": f.recorded_at.isoformat(), "config_version": c.version})
            result = {"session": session, "obligation": o, "measurement_accepted": trustworthy}
            state["feedback"][f.session_id] = {"payload": payload, "result": result}
            return result
