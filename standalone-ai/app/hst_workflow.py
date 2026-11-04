"""HST-triggered proposal ledger. Planning never dispatches a pump.

Scheduled Guide fertilizer obligations are persisted once per program/planting/
activity/product identity. Routine scans only read the Guide: no telemetry,
fuzzy evaluation or per-poll decision snapshots. Approval review is a distinct,
operator-authenticated, SHADOW-only event requiring new sensor evidence.
"""
from __future__ import annotations

import copy
import math
from datetime import datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from .calculations import plan_fertigation
from .engine import digest
from .live_engine import empty_live, fresh, sync_obligations, valid_sensor

JAKARTA = ZoneInfo("Asia/Jakarta")


class HstWorkflowConflict(ValueError):
    """A stale proposal, conflicting replay, or unavailable obligation."""


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _remaining(obligation):
    target = _number(obligation.get("snapshot", {}).get("target_g"))
    delivered = _number(obligation.get("delivered_g"))
    if target is None or target <= 0 or delivered is None or delivered < 0:
        return None
    return max(0.0, target - delivered)


def _summarize(proposal, obligation, approvals):
    remaining = _remaining(obligation)
    delivered = _number(obligation.get("delivered_g"))
    reviews = list(obligation.get("review_reasons") or [])
    if remaining == 0 or obligation.get("status") == "COMPLETED":
        status = "COMPLETED"
    elif reviews or obligation.get("status") == "REQUIRES_REVIEW":
        status = "REQUIRES_REVIEW"
    elif delivered and delivered > 0:
        status = "PARTIAL_WAITING_APPROVAL"
    else:
        status = "WAITING_APPROVAL"
    return {
        **proposal,
        "target_g": _number(obligation.get("snapshot", {}).get("target_g")),
        "delivered_g": delivered,
        "remaining_g": remaining,
        "status": status,
        "review_reasons": reviews,
        "approval_count": sum(a["obligation_id"] == proposal["obligation_id"] for a in approvals.values()),
        "can_dispatch": False,
    }


class HstWorkflow:
    def __init__(self, store, site_id, device_id, zone_id):
        self.store = store
        self.site_id = site_id
        self.device_id = device_id
        self.zone_id = zone_id

    def proposals(self):
        state = self.store.read()
        live = state.get("live", {})
        workflow = state.get("hst_workflow", {})
        obligations = live.get("obligations", {})
        approvals = workflow.get("approvals", {})
        result = [
            _summarize(p, obligations[p["obligation_id"]], approvals)
            for p in workflow.get("proposals", {}).values()
            if p.get("obligation_id") in obligations
        ]
        result.sort(key=lambda p: (p["due_date"], p["obligation_id"]))
        return {"status": "READY" if result else "NO_SCHEDULE",
                "proposals": result, "can_dispatch": False}

    def scan(self, guides, *, now=None):
        """Idempotent HST scan. Never fetches telemetry or creates a decision."""
        if guides.get("status") != "READ_ONLY_PREVIEW":
            raise HstWorkflowConflict("guide_program_source_not_ready")
        now = now or datetime.now(timezone.utc)
        with self.store.transaction() as state:
            live = state.get("live") or {}
            previous = live.get("obligations", {})
            selected_programs = []
            for program in guides.get("programs", []):
                if program.get("status") != "PREVIEW_ONLY":
                    continue
                if any(reason in (program.get("hold_reasons") or [])
                       for reason in ("device_binding_not_verified", "crop_binding_not_verified")):
                    continue
                activities = []
                for activity in program.get("activities", []):
                    selected_products = []
                    for product in activity.get("products", []):
                        if product.get("is_fertilizer") is not True:
                            continue
                        identity = [program.get("program_id"),
                                    program.get("config", {}).get("plantingDate"),
                                    activity.get("activity_id"), product.get("source_row")]
                        obligation_id = digest(identity)
                        # First import never silently assumes an old HST was not
                        # physically treated. Only today's new schedule is created;
                        # previously tracked unfinished duties remain visible.
                        if (activity.get("calendar_status") == "DUE_TODAY"
                                or (obligation_id in previous
                                    and previous[obligation_id].get("status") != "COMPLETED")):
                            selected_products.append(product)
                    if selected_products:
                        activities.append({**activity, "products": selected_products})
                if activities:
                    selected_programs.append({**program, "activities": activities})

            if not selected_programs and not any(
                o.get("status") != "COMPLETED" for o in previous.values()
            ):
                return {"status": "NO_SCHEDULE", "created": 0, "can_dispatch": False}

            # Reuse the existing obligation identity/progress/validation rules.
            # It will never credit doses based on a manual Guide checkbox.
            live = state.setdefault("live", empty_live())
            sync_obligations(live, {"guide_programs": {
                "status": "READ_ONLY_PREVIEW", "programs": selected_programs,
            }}, None)
            workflow = state.setdefault("hst_workflow", {"proposals": {}, "approvals": {}})
            proposals = workflow.setdefault("proposals", {})
            workflow.setdefault("approvals", {})
            created = 0
            for obligation_id, obligation in live["obligations"].items():
                if obligation.get("status") == "COMPLETED" or obligation_id in proposals:
                    continue
                snapshot = obligation.get("snapshot", {})
                proposals[obligation_id] = {
                    "obligation_id": obligation_id,
                    "program_id": obligation["program_id"],
                    "activity_id": obligation["activity_id"],
                    "source_row": snapshot.get("source_row"),
                    "hst": obligation.get("hst"),
                    "due_date": snapshot.get("due_date"),
                    "product": snapshot.get("product"),
                    "created_at": now.isoformat(),
                    "proposed_action": "FERTIGATE",
                    "mode": "SHADOW_MODE",
                }
                created += 1
            return {"status": "READY" if proposals else "NO_SCHEDULE",
                    "created": created, "can_dispatch": False}

    def review_approval(self, *, obligation_id, approval_id, actor,
                        expected_remaining_g, observation, profile=None, now=None):
        """Record one operator review + bounded sensor preflight, never dispatch.

        The caller must authenticate the operator and the service-to-service
        bridge before calling. Each attempt has its own idempotency UUID.
        """
        now = now or datetime.now(timezone.utc)
        approval_id = str(UUID(str(approval_id)))
        if not isinstance(actor, str) or not 1 <= len(actor.strip()) <= 128:
            raise HstWorkflowConflict("authenticated_operator_required")
        expected = _number(expected_remaining_g)
        if expected is None or expected <= 0:
            raise HstWorkflowConflict("invalid_expected_remaining")
        with self.store.transaction() as state:
            live = state.get("live", {})
            workflow = state.get("hst_workflow", {})
            proposal = workflow.get("proposals", {}).get(obligation_id)
            obligation = live.get("obligations", {}).get(obligation_id)
            if not proposal or not obligation:
                raise HstWorkflowConflict("unknown_hst_obligation")
            approvals = workflow.setdefault("approvals", {})
            existing = approvals.get(approval_id)
            if existing:
                if (existing["obligation_id"] != obligation_id
                        or existing["operator_id"] != actor
                        or not math.isclose(existing["expected_remaining_g"], expected, abs_tol=0.01)):
                    raise HstWorkflowConflict("approval_id_conflicts_with_existing_review")
                return copy.deepcopy(existing)
            remaining = _remaining(obligation)
            if (remaining is None or remaining <= 0
                    or not math.isclose(remaining, expected, rel_tol=0, abs_tol=0.01)):
                raise HstWorkflowConflict("obligation_progress_changed_reapprove_required")

            telemetry = observation.get("telemetry") or {}
            device = observation.get("device_status") or {}
            control = observation.get("automatic_control") or {}
            reasons = list(obligation.get("review_reasons") or [])
            if observation.get("schema_compatible") is not True:
                reasons.append("source_schema_incompatible")
            config = profile.planning if profile else None
            max_age = config.sensor_data_max_age if config else 120
            if not fresh(telemetry.get("recorded_at"), now, max_age):
                reasons.append("sensor_data_stale_or_missing")
            if not fresh(device.get("recorded_at"), now, 90) or device.get("online") is not True:
                reasons.append("device_status_stale_or_offline")
            if (device.get("mode") != "automatic"
                    or control.get("desired_mode") != "automatic"
                    or control.get("applied_mode") != "automatic"):
                reasons.append("manual_mode_blocks_automatic_start")
            if (control.get("acknowledgement_status") != "applied"
                    or control.get("revision") != control.get("acknowledged_revision")):
                reasons.append("control_mode_not_acknowledged")
            if any(s.get("status") in ("started", "running")
                   for s in observation.get("recent_sessions", [])):
                reasons.append("existing_device_session_active")
            water_valid = valid_sensor(telemetry, "tank_water_level_pct")
            stock_valid = valid_sensor(telemetry, "tank_fert_level_pct")
            soil2_valid = (valid_sensor(telemetry, "soil_2_moisture")
                           and telemetry.get("sensor_health", {}).get("soil_2_moisture", {}).get("controlValid") is True)
            if not water_valid:
                reasons.append("invalid_water_level_sensor")
            if not stock_valid:
                reasons.append("invalid_fertilizer_level_sensor")
            if not soil2_valid:
                reasons.append("soil_2_control_evidence_invalid")
            if config is None:
                reasons.append("validated_planning_configuration_missing")
            elif config.simulation_only or config.version != profile.version:
                reasons.append("planning_configuration_not_validated")
            binding = next((s for s in (profile.stocks if profile else [])
                            if s.program_id == obligation["program_id"]
                            and s.activity_id == obligation["activity_id"]
                            and s.source_row == obligation["snapshot"]["source_row"]
                            and s.verified), None)
            if binding is None:
                reasons.append("verified_stock_concentration_missing")
            plan = None
            if (config and not config.simulation_only and config.version == profile.version
                    and binding and water_valid and stock_valid and soil2_valid):
                flows = live.get("ema", {}).get(
                    profile.version, {"water": config.water_flow_lpm,
                                      "fertilizer": config.fertilizer_flow_lpm})
                try:
                    plan = plan_fertigation(
                        remaining, binding.concentration_g_l,
                        telemetry["tank_water_level_pct"],
                        telemetry["tank_fert_level_pct"], flows, config)
                    if plan and "hold" in plan:
                        reasons.append(str(plan["hold"]))
                        plan = None
                except (TypeError, ValueError, ZeroDivisionError, OverflowError):
                    reasons.append("session_plan_unavailable")
                    plan = None

            # Approval is a review of one proposed session, not hardware
            # authorization. Firmware/session contract is not validated.
            reasons.extend(["shadow_mode_no_fertigation_dispatch",
                            "firmware_external_volume_only_authority_not_implemented"])
            evidence = {
                "message_id": telemetry.get("message_id"),
                "recorded_at": telemetry.get("recorded_at"),
                "water_tank_pct": _number(telemetry.get("tank_water_level_pct")),
                "fertilizer_tank_pct": _number(telemetry.get("tank_fert_level_pct")),
                "soil_2_moisture_pct": _number(telemetry.get("soil_2_moisture")),
                "water_valid": water_valid,
                "fertilizer_valid": stock_valid,
                "soil_2_valid": soil2_valid,
                "device_mode": device.get("mode"),
                "device_recorded_at": device.get("recorded_at"),
            }
            result = {
                "approval_id": approval_id,
                "obligation_id": obligation_id,
                "operator_id": actor,
                "approved_at": now.isoformat(),
                "approval_date": now.astimezone(JAKARTA).date().isoformat(),
                "expected_remaining_g": remaining,
                "status": "SHADOW_REVIEW_BLOCKED",
                "can_dispatch": False,
                "command_created": False,
                "dispatch_status": "NOT_DISPATCHED",
                "hold_reasons": sorted(set(reasons)),
                "sensor_evidence": evidence,
                "plan": plan,
            }
            approvals[approval_id] = result
            return copy.deepcopy(result)
