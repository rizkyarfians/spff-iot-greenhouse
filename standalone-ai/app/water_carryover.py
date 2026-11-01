"""Explicit SHADOW carry-over ledger: only bound, completed device water sessions count.

No flow counter inference, no command dispatch, no fertilizer sessions, no
writes to the operational SPFF database. Uncalibrated device-reported volumes
remain explicitly labelled as such, never certified physical delivery.
"""
import argparse
import json
from datetime import datetime, timedelta, timezone
from math import isfinite
from uuid import uuid4, UUID
from zoneinfo import ZoneInfo

JAKARTA = ZoneInfo("Asia/Jakarta")


def utc(value):
    if isinstance(value, datetime):
        v = value
    elif isinstance(value, str):
        try:
            v = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return v.astimezone(timezone.utc) if v.tzinfo else None


def measured(value):
    try:
        v = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return v if not isinstance(value, bool) and isfinite(v) and 0 <= v <= 100000 else None


def new_water_plan(store, dashboard, site_id, device_id, *, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("time must include timezone")
    day = now.astimezone(JAKARTA).date().isoformat()
    if not isinstance(site_id, str) or not site_id or not isinstance(device_id, str) or not device_id:
        raise ValueError("device scope required")
    if not isinstance(dashboard, dict) or dashboard.get("planning_source") != "POSTGRES_READ_ONLY" or dashboard.get("planning_status") != "CURRENT":
        raise ValueError("fresh real SPFF source required")
    if dashboard.get("can_dispatch") is not False:
        raise ValueError("shadow-only water plans")
    fuzzy = dashboard.get("fuzzy_preview")
    if not isinstance(fuzzy, dict) or fuzzy.get("basis") != "SIMULATION_PROFILE":
        raise ValueError("valid Fuzzy simulation is required")
    target = measured(fuzzy.get("illustrative_water_l"))
    sampled_at = utc(fuzzy.get("recorded_at"))
    if (target is None or target <= 0 or sampled_at is None
            or not -5 <= (now - sampled_at).total_seconds() <= 120):
        raise ValueError("Fuzzy target or sample freshness invalid")
    with store.transaction() as state:
        plans = state.setdefault("shadow_water_plans", {})
        if day in plans:
            existing = plans[day]
            if existing.get("site_id") != site_id or existing.get("device_id") != device_id:
                raise ValueError("daily plan device scope conflict")
            return existing
        entry = {
            "plan_id": str(uuid4()), "site_id": site_id,
            "device_id": device_id, "planning_date": day,
            "created_at": now.astimezone(timezone.utc).isoformat(),
            "fuzzy_sample_at": sampled_at.isoformat(),
            "fuzzy_config_version": str(fuzzy.get("config_version") or "")[:100],
            "target_l": target, "credits": {},
            "authority": "SHADOW_ONLY", "can_dispatch": False,
        }
        plans[day] = entry
        return entry


def credit_device_session(store, plan_id, proof, *, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("time must include timezone")
    try:
        UUID(str(plan_id))
        session_id = str(UUID(str(proof.get("session_id"))))
    except (ValueError, AttributeError, TypeError):
        raise ValueError("invalid plan or session UUID") from None
    if not isinstance(proof, dict) or proof.get("source") != "SPFF_COMPLETED_SESSION_EVENT":
        raise ValueError("source-backed terminal device session required")
    volume = measured(proof.get("actual_water_l"))
    event = utc(proof.get("event_recorded_at"))
    started = utc(proof.get("started_at"))
    finished = utc(proof.get("finished_at"))
    received = utc(proof.get("event_received_at"))
    if (proof.get("status") != "completed" or proof.get("pumps_off") is not True
            or measured(proof.get("target_stock_l")) != 0
            or measured(proof.get("actual_stock_l")) != 0
            or volume is None or volume <= 0
            or not isinstance(proof.get("message_id"), str)
            or not proof["message_id"] or type(proof.get("sequence")) is not int
            or proof["sequence"] < 0
            or None in (event, started, finished, received)
            or not started < finished or event != finished
            or received < event - timedelta(seconds=5)
            or finished > now.astimezone(timezone.utc) + timedelta(seconds=5)):
        raise ValueError("session is not eligible as water-only completed device evidence")
    with store.transaction() as state:
        plans = state.setdefault("shadow_water_plans", {})
        plan = next((p for p in plans.values() if p.get("plan_id") == str(plan_id)), None)
        if not plan:
            raise ValueError("water plan not found")
        if (plan.get("site_id") != proof.get("site_id")
                or plan.get("device_id") != proof.get("device_id")):
            raise ValueError("session belongs to a different site/device")
        created = utc(plan.get("created_at"))
        if created is None or started < created or started.astimezone(JAKARTA).date().isoformat() != plan.get("planning_date"):
            raise ValueError("session must begin after plan creation on its local planning day")
        used = state.setdefault("shadow_water_session_credits", {})
        if session_id in used:
            if used[session_id] == plan_id and session_id in plan.get("credits", {}):
                # Repeat of an idempotent operator link; never debit again.
                return plan
            raise ValueError("session already linked to another plan or inconsistent ledger")
        plan.setdefault("credits", {})[session_id] = {
            "session_id": session_id, "device_reported_l": volume,
            "message_id": proof["message_id"],
            "sequence": proof["sequence"],
            "finished_at": finished.isoformat(),
            "evidence_source": "DEVICE_SESSION_UNCALIBRATED",
        }
        used[session_id] = plan_id
        return plan


def present_carryover(state, *, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("time must include timezone")
    today = now.astimezone(JAKARTA).date()
    base = {
        "status": "NO_PLAN", "plan_id": None,
        "planning_date": None, "next_review_date": None,
        "frozen_fuzzy_target_l": None,
        "device_reported_delivered_l": None,
        "remaining_for_reassessment_l": None,
        "credited_session_count": 0,
        "last_device_session_at": None,
        "evidence_basis": "DEVICE_SESSION_UNCALIBRATED",
        "requires_fresh_reassessment": True,
        "can_dispatch": False,
    }
    plans = state.get("shadow_water_plans", {}) if isinstance(state, dict) else {}
    valid = [p for p in plans.values() if isinstance(p, dict)
             and isinstance(p.get("planning_date"), str)
             and p["planning_date"] <= today.isoformat()]
    if not valid:
        return base
    plan = max(valid, key=lambda p: p.get("planning_date", ""))
    target = measured(plan.get("target_l"))
    credits = plan.get("credits", {})
    if target is None or target <= 0 or not isinstance(credits, dict):
        return base
    rows = [v for v in credits.values() if isinstance(v, dict)
            and measured(v.get("device_reported_l")) is not None]
    credited = sum(measured(row["device_reported_l"]) for row in rows)
    remaining = max(0.0, target - credited)
    age = (today - datetime.fromisoformat(plan["planning_date"]).date()).days
    status = ("REVIEW_REQUIRED" if age >= 2
              else "COMPLETE_REPORTED" if remaining <= 0
              else "CARRY_OVER_REVIEW" if age >= 1
              else "ACTIVE")
    return {
        **base,
        "status": status,
        "plan_id": plan.get("plan_id"),
        "planning_date": plan["planning_date"],
        "next_review_date": (datetime.fromisoformat(plan["planning_date"]).date()
                             + timedelta(days=1)).isoformat(),
        "frozen_fuzzy_target_l": target,
        "device_reported_delivered_l": credited,
        "remaining_for_reassessment_l": remaining,
        "credited_session_count": len(rows),
        "last_device_session_at": max((v["finished_at"] for v in rows), default=None),
    }


def main():
    from .settings import ROOT, Settings, load_config
    from .source import SPFFSource
    from .store import PostgresStore, SQLiteStore
    from .dashboard_summary import present_shadow_dashboard
    parser = argparse.ArgumentParser(description="Explicit operator-reviewed SHADOW water carry-over")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("show")
    sub.add_parser("plan")
    credit = sub.add_parser("credit")
    credit.add_argument("--plan-id", required=True)
    credit.add_argument("--session-id", required=True)
    args = parser.parse_args()
    settings = Settings.load()
    # Require explicit storage identity. Default local simulation sqlite may
    # differ from the running service and must not be silently credited.
    import os
    if settings.mode != "SHADOW_MODE":
        parser.error("water carry-over is SHADOW only")
    if not settings.state_dsn and not os.getenv("AI_STATE_PATH"):
        parser.error("explicit AI_STATE_DSN or AI_STATE_PATH required")
    scope = f"{settings.site_id}/{settings.device_id}/{settings.zone_id}/source-shadow"
    store = (PostgresStore(settings.state_dsn, scope) if settings.state_dsn
             else SQLiteStore(str(ROOT / settings.state_path), scope))
    try:
        if args.action == "show":
            print(json.dumps(present_carryover(store.read()), indent=2))
            return
        if not settings.source_dsn:
            parser.error("AI_SOURCE_DSN required for source-backed water evidence")
        source = SPFFSource(settings.source_dsn, settings.site_id, settings.device_id, settings.zone_id,
                            fertilizer_delivery_route=settings.fertilizer_delivery_route)
        if args.action == "plan":
            snapshot = source.inspect()
            dashboard = present_shadow_dashboard(
                store.read().get("decisions", {}).values(),
                simulation_config=load_config(),
                planning_observation=snapshot,
                tank_capacity_l=settings.tank_capacity_l,
                tank_height_cm=settings.tank_height_cm,
            )
            print(json.dumps(new_water_plan(store, dashboard, settings.site_id, settings.device_id), indent=2))
        else:
            proof = source.inspect_water_session_evidence(args.session_id)
            print(json.dumps(credit_device_session(store, args.plan_id, proof), indent=2))
    finally:
        store.close()


if __name__ == "__main__":
    main()
