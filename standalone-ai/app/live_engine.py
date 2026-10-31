"""Persistent real-source SHADOW planning. No EC target or actuator dispatch.

Source plans own dates/product quantities. This ledger owns obligations. Session
results may change a dose only through an explicit session-to-obligation binding;
historical manual/legacy sessions are never guessed to belong to a new obligation.
"""
import copy
import math
from typing import Literal
from datetime import datetime, timezone
from uuid import uuid4

from .calculations import fuzzy_volume, plan_fertigation, tank_liters
from .quality import check_soil_control_quality
from .engine import digest, timestamp
from .models import Config, Model
from pydantic import Field, model_validator


class StockBinding(Model):
    program_id: str
    activity_id: str
    source_row: int = Field(gt=0)
    batch_id: str = Field(min_length=1)
    concentration_g_l: float = Field(gt=0)
    verified: bool = False


class LiveProfile(Model):
    version: str = Field(min_length=1)
    planning: Config
    stocks: list[StockBinding] = Field(default_factory=list)
    # Restart/late-install must not silently re-apply an old field treatment.
    missed_schedule_policy: Literal["review"] = "review"

    @model_validator(mode="after")
    def unique_stock_bindings(self):
        identities = [(s.program_id, s.activity_id, s.source_row) for s in self.stocks]
        if len(identities) != len(set(identities)):
            raise ValueError("Each program/activity/product row requires one unambiguous stock binding")
        return self


def empty_live():
    return {"obligations": {}, "decisions": {}, "sessions": {}, "feedback": {},
            "ema": {}, "ema_history": [], "last_sample": None, "stable_since": None,
            "last_start": None, "last_config": None}


def fresh(at, now, limit):
    try:
        age = (now - timestamp(str(at))).total_seconds()
        return -5 <= age <= limit
    except (TypeError, ValueError):
        return False


def valid_sensor(sample, key, low=0, high=100):
    value = sample.get(key)
    return (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            and low <= value <= high and sample.get("sensor_health", {}).get(key, {}).get("valid") is True)


def sync_obligations(state, observation, profile):
    guide = observation.get("guide_programs", {})
    if guide.get("status") != "READ_ONLY_PREVIEW":
        return ["guide_program_source_not_ready"]
    issues = []
    seen = set()
    for program in guide.get("programs", []):
        if program.get("status") != "PREVIEW_ONLY":
            issues.append("guide_program_requires_review")
            continue
        blockers = program.get("hold_reasons", [])
        if any(reason in blockers for reason in ("device_binding_not_verified", "crop_binding_not_verified")):
            issues.append("guide_program_binding_not_verified")
            continue
        for activity in program["activities"]:
            if activity.get("calendar_status") not in ("DUE_TODAY", "PAST_DUE"):
                continue
            for product in activity["products"]:
                if not product.get("is_fertilizer"):
                    continue
                identity = [program["program_id"], program["config"]["plantingDate"], activity["activity_id"], product["source_row"]]
                key = digest(identity)
                seen.add(key)
                dose = product.get("product_mass_g")
                snapshot = {"product": product["product"], "target_g": dose, "due_date": activity["application_date"],
                            "source_row": product["source_row"], "source_method": activity["method"],
                            "program_revision": program["revision"], "source_sha256": program["source_sha256"],
                            "guide_revision": program["guide_revision"], "dose_unit": product["dose_unit"],
                            "dose": product["dose"], "amount": product["amount"], "unit": product["unit"],
                            "plant_count": program["plant_count"]}
                fingerprint = digest(snapshot)
                o = state["obligations"].get(key)
                if o is None:
                    o = {"obligation_id": key, "program_id": program["program_id"], "activity_id": activity["activity_id"],
                         "planting_date": program["config"]["plantingDate"], "hst": activity["hst"],
                         "snapshot": snapshot, "fingerprint": fingerprint, "delivered_g": 0.0,
                         "status": "PENDING", "review_reasons": []}
                    state["obligations"][key] = o
                    # On a first import, past date alone cannot establish unpaid dose.
                    if activity["calendar_status"] == "PAST_DUE":
                        o["status"] = "REQUIRES_REVIEW"
                        o["review_reasons"].append("past_schedule_at_first_import")
                if o["status"] == "COMPLETED":
                    continue
                if o["fingerprint"] != fingerprint:
                    o["status"] = "REQUIRES_REVIEW"
                    if "program_changed_after_obligation_created" not in o["review_reasons"]:
                        o["review_reasons"].append("program_changed_after_obligation_created")
                if dose is None or not math.isfinite(dose) or dose <= 0 or product.get("review_reasons"):
                    o["status"] = "REQUIRES_REVIEW"
                    if "dose_or_units_require_review" not in o["review_reasons"]:
                        o["review_reasons"].append("dose_or_units_require_review")
                if activity.get("manual_completion_records"):
                    o["status"] = "REQUIRES_REVIEW"
                    if "manual_completion_needs_dose_reconciliation" not in o["review_reasons"]:
                        o["review_reasons"].append("manual_completion_needs_dose_reconciliation")
                if program.get("guide_edits_changed"):
                    o["status"] = "REQUIRES_REVIEW"
                    if "guide_revision_changed" not in o["review_reasons"]:
                        o["review_reasons"].append("guide_revision_changed")
    for key, o in state["obligations"].items():
        if key not in seen and o["status"] != "COMPLETED":
            o["status"] = "REQUIRES_REVIEW"
            if "source_obligation_missing_or_unbound" not in o["review_reasons"]:
                o["review_reasons"].append("source_obligation_missing_or_unbound")
    return issues


class LiveEngine:
    def __init__(self, store, site_id, device_id, zone_id):
        self.store, self.site_id, self.device_id, self.zone_id = store, site_id, device_id, zone_id

    def evaluate(self, observation, profile=None, now=None, dry_run=False):
        now = now or datetime.now(timezone.utc)
        if dry_run:
            state = copy.deepcopy(self.store.read().get("live", empty_live()))
            return self._evaluate(state, observation, profile, now, "DRY_RUN")
        with self.store.transaction() as container:
            state = container.setdefault("live", empty_live())
            result = self._evaluate(state, observation, profile, now, "SHADOW_MODE")
            # Expose the same real decision feed used by the standalone API.
            container["decisions"][result["decision_id"]] = copy.deepcopy(result)
            container["current_decision_id"] = result["decision_id"]
            return result

    def _evaluate(self, state, observation, profile, now, mode):
        reasons = sync_obligations(state, observation, profile)
        active = sorted((o for o in state["obligations"].values() if o["status"] != "COMPLETED"),
                        key=lambda o: (o["snapshot"]["due_date"], o["obligation_id"]))
        sample = observation.get("telemetry") or {}
        device = observation.get("device_status") or {}
        control = observation.get("automatic_control") or {}
        config = profile.planning if profile else None
        max_age = config.sensor_data_max_age if config else 120
        evidence = observation.get("execution_evidence") or {}
        proposal = None
        plan = None
        fuzzy = None
        if not observation.get("schema_compatible"):
            reasons.append("source_schema_incompatible")
        if any(x.get("status") in ("started", "running") for x in observation.get("recent_sessions", [])):
            reasons.append("existing_device_session_active")
        if not fresh(sample.get("recorded_at"), now, max_age):
            reasons.append("sensor_data_stale_or_missing")
            state["stable_since"] = None
        if not fresh(device.get("recorded_at"), now, 90) or device.get("online") is not True:
            reasons.append("device_status_stale_or_offline")
        manual = device.get("mode") != "automatic" or control.get("desired_mode") != "automatic" or control.get("applied_mode") != "automatic"
        if manual:
            reasons.append("manual_mode_blocks_automatic_start")
            state["stable_since"] = None
            for o in active:
                if o["status"] in ("RUNNING", "WAITING_FOR_WATER", "PARTIAL"):
                    o["status"] = "REQUIRES_REVIEW"
                    if "manual_mode_revoked_resume" not in o["review_reasons"]:
                        o["review_reasons"].append("manual_mode_revoked_resume")
        if control.get("acknowledgement_status") != "applied" or control.get("revision") != control.get("acknowledged_revision"):
            reasons.append("control_mode_not_acknowledged")
        if any(s["status"] in ("RUNNING", "REQUIRES_REVIEW") for s in state["sessions"].values()):
            reasons.append("previous_session_needs_completion_or_reconciliation")
        frame = evidence.get("latest_adaptive")
        if not frame:
            reasons.append("execution_feedback_unavailable")
        else:
            payload = frame.get("payload", {})
            if not fresh(payload.get("timestamp"), now, 25) or not fresh(frame.get("received_at"), now, 25):
                reasons.append("execution_feedback_stale")
            if payload.get("state") not in ("IDLE", "COMPLETED") or payload.get("waterPumpKnown") is not True or payload.get("fertPumpKnown") is not True or payload.get("waterPump") is not False or payload.get("fertPump") is not False:
                reasons.append("device_busy_faulted_or_pumps_not_verified_off")
        # Current MCU protocol retains its own EC controller and uses legacy
        # Manual for external sessions. Never silently bypass the prompt's Manual gate.
        reasons.append("firmware_external_volume_only_authority_not_implemented")
        if config is None:
            reasons.append("validated_planning_configuration_missing")
        elif config.simulation_only:
            reasons.append("planning_configuration_is_simulation_only")
        elif config.version != profile.version:
            reasons.append("configuration_versions_do_not_match")
        ckey = control.get("water_sensor_key")
        if ckey not in ("soil_1_moisture", "soil_2_moisture"):
            ckey = None
        water_ok = valid_sensor(sample, "tank_water_level_pct")
        if not water_ok:
            reasons.append("invalid_water_level_sensor")
        if config and water_ok and fresh(sample.get("recorded_at"), now, max_age) and not manual:
            last = state["last_sample"]
            recorded = str(sample["recorded_at"])
            if last and (timestamp(recorded) < timestamp(last["at"]) or (last["id"] == sample.get("message_id") and last["at"] != recorded)):
                reasons.append("out_of_order_or_conflicting_sensor_sample")
            if last and (timestamp(recorded) < timestamp(last["at"]) or (timestamp(recorded)-timestamp(last["at"])).total_seconds() > max_age):
                state["stable_since"] = None
            if sample["tank_water_level_pct"] >= config.water_level_start_threshold:
                state["stable_since"] = state["stable_since"] or recorded
            else:
                state["stable_since"] = None
            state["last_sample"] = {"id": sample.get("message_id"), "at": recorded}
        if active:
            o = active[0]
            proposal = "FERTIGATE"
            if any(item["status"] == "REQUIRES_REVIEW" for item in active):
                reasons.append("outstanding_obligation_requires_review")
            if config and water_ok and not manual and sample["tank_water_level_pct"] < config.water_level_start_threshold and o["status"] != "REQUIRES_REVIEW":
                o["status"] = "WAITING_FOR_WATER"
                reasons.append("waiting_for_water")
            if config and o["status"] == "WAITING_FOR_WATER" and state["stable_since"]:
                stable = (timestamp(str(sample["recorded_at"])) - timestamp(state["stable_since"])).total_seconds()
                if stable < config.water_level_stable_duration:
                    reasons.append("waiting_for_stable_water_level")
                elif not manual:
                    o["status"] = "READY"
            binding = next((s for s in (profile.stocks if profile else [])
                            if s.program_id == o["program_id"] and s.activity_id == o["activity_id"] and s.source_row == o["snapshot"]["source_row"]), None)
            if not binding or not binding.verified:
                reasons.append("verified_stock_concentration_missing")
            if config and binding and binding.verified and water_ok and valid_sensor(sample, "tank_fert_level_pct"):
                flows = state["ema"].get(profile.version, {"water": config.water_flow_lpm, "fertilizer": config.fertilizer_flow_lpm})
                plan = plan_fertigation(max(0, o["snapshot"]["target_g"]-o["delivered_g"]), binding.concentration_g_l,
                                       sample["tank_water_level_pct"], sample["tank_fert_level_pct"], flows, config) if o["snapshot"]["target_g"] else None
                if plan and "hold" in plan:
                    reasons.append(plan["hold"])
            elif not valid_sensor(sample, "tank_fert_level_pct"):
                reasons.append("invalid_fertilizer_level_sensor")
        else:
            proposal = "IRRIGATE"
            if config and ckey and valid_sensor(sample, ckey):
                quality_ok, quality_reason = check_soil_control_quality(state, sample, ckey)
                if not quality_ok:
                    reasons.append(quality_reason or "soil_moisture_not_control_valid")
                else:
                    fuzzy = fuzzy_volume(sample[ckey], config)
                    proposal = "IRRIGATE" if fuzzy["water_l"] else "OFF"
                # An OFF recommendation is not a zero-volume irrigation plan.
                # Only a trusted positive demand may produce a water plan.
                if quality_ok and water_ok and proposal == "IRRIGATE":
                    budget = max(0, tank_liters(sample["tank_water_level_pct"], config.water_curve)-tank_liters(config.water_level_stop_threshold, config.water_curve)-config.minimum_flush_reserve)
                    volume = min(fuzzy["water_l"], budget, config.max_session_water_l, config.water_flow_lpm*config.max_session_seconds/60)
                    plan = {"water_l": volume, "stock_l": 0, "mass_g": 0, "duration_seconds": volume/config.water_flow_lpm*60}
                    if proposal == "IRRIGATE" and (volume <= 0 or sample["tank_water_level_pct"] < config.water_level_start_threshold):
                        reasons.append("insufficient_irrigation_water")
            else:
                reasons.append("validated_soil_moisture_or_fuzzy_configuration_missing")
        if state["last_start"] and config and (now-timestamp(state["last_start"])).total_seconds() < config.minimum_restart_interval:
            reasons.append("minimum_restart_interval")
        reasons = sorted(set(reasons))
        summary = [{"obligation_id": o["obligation_id"], "program_id": o["program_id"], "activity_id": o["activity_id"],
                    "product": o["snapshot"]["product"], "due_date": o["snapshot"]["due_date"], "target_g": o["snapshot"]["target_g"],
                    "delivered_g": o["delivered_g"], "remaining_g": max(0, (o["snapshot"]["target_g"] or 0)-o["delivered_g"]),
                    "status": o["status"], "review_reasons": o["review_reasons"]} for o in active]
        core = {"site_id": self.site_id, "device_id": self.device_id, "zone_id": self.zone_id,
                "type": "HOLD" if reasons else proposal, "proposed_action": proposal,
                "mode": mode, "simulation": False, "can_dispatch": False, "dispatch_status": "NOT_DISPATCHED",
                "hold_reasons": reasons, "conflict_policy": "oldest_due_first_products_separate_no_merge",
                "priority_obligation_id": active[0]["obligation_id"] if active else None,
                "obligations": summary, "plan": plan, "fuzzy": fuzzy,
                "configuration_version": profile.version if profile else None,
                "input_snapshot": observation, "ec_target_required_for_scheduling": False}
        key = digest(core)
        if key in state["decisions"]:
            return state["decisions"][key]
        result = {"decision_id": str(uuid4()), "at": now.isoformat(), **core}
        state["decisions"][key] = result
        return result
