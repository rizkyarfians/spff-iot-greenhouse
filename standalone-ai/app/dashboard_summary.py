"""Bounded presentation of REAL SHADOW decisions for the local SPFF dashboard.

No calculations are recreated in the browser, and no synthetic scenario is
promoted to a plant recommendation. A missing or stale decision stays explicit.
"""
from datetime import datetime, timezone
from math import isfinite


def _iso(value):
    try:
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, str):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            return None
        return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None
    except (OverflowError, ValueError, TypeError):
        return None


def _number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value) and value >= 0 else None


def _fresh(value, now, maximum_age):
    normalized = _iso(value)
    return normalized is not None and -5 <= (now - datetime.fromisoformat(normalized)).total_seconds() <= maximum_age


def _text(value):
    return value[:200] if isinstance(value, str) else None


def _str_list(values, cap=40):
    return [_text(v) for v in values[:cap] if isinstance(v, str)] if isinstance(values, list) else []


def present_shadow_dashboard(decisions, now=None):
    """Return one schema for Node validation and mobile-first React presentation.

    A shadow ledger 'delivered_g' means credited by AI only, not external/manual
    delivery. Future program requirements have no credited proof and MUST show
    null delivery/remaining. Manual completions require reconciliation.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    now = now.astimezone(timezone.utc)
    eligible = []
    for value in decisions:
        if not isinstance(value, dict) or value.get("mode") != "SHADOW_MODE" or value.get("simulation") is not False:
            continue
        at = _iso(value.get("at"))
        if not at:
            continue
        age = (now - datetime.fromisoformat(at)).total_seconds()
        if age < -5:
            continue
        eligible.append((age, value, at))
    eligible.sort(key=lambda v: v[0])
    selected = eligible[0] if eligible else None
    current = bool(selected and selected[0] <= 30)
    decision = selected[1] if selected else {}
    snapshot = decision.get("input_snapshot")
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    telemetry = snapshot.get("telemetry")
    telemetry = telemetry if isinstance(telemetry, dict) else {}
    device = snapshot.get("device_status")
    device = device if isinstance(device, dict) else {}
    guide = snapshot.get("guide_programs")
    guide = guide if isinstance(guide, dict) else {}
    report = decision.get("pump_feedback")
    report = report if isinstance(report, dict) else {}
    feedback_fresh = (current and _fresh(report.get("reported_at"), now, 25)
                      and _fresh(report.get("received_at"), now, 25))
    ledger = decision.get("obligations")
    ledger = ledger if isinstance(ledger, list) else []
    # In the current LiveEngine the current obligation list covers all known
    # pending/reviewed obligations, but completed ones are deliberately omitted.
    indexed = {
        (o.get("program_id"), o.get("activity_id"), o.get("source_row")): o
        for o in ledger if isinstance(o, dict)
    }

    programs = []
    for program in (guide.get("programs") if isinstance(guide.get("programs"), list) else [])[:30]:
        if not isinstance(program, dict):
            continue
        activities = []
        for activity in (program.get("activities") if isinstance(program.get("activities"), list) else [])[:120]:
            if not isinstance(activity, dict):
                continue
            products = []
            manually_completed = bool(activity.get("manual_completion_records"))
            for product in (activity.get("products") if isinstance(activity.get("products"), list) else [])[:30]:
                if not isinstance(product, dict):
                    continue
                obligation = indexed.get((program.get("program_id"), activity.get("activity_id"), product.get("source_row")))
                tracked = obligation if isinstance(obligation, dict) else None
                review = manually_completed or bool(product.get("review_reasons")) or (
                    tracked is not None and tracked.get("status") == "REQUIRES_REVIEW"
                )
                # Do not assert that no delivery occurred merely because no AI-bound
                # session was tracked. Manual completed activities are never '0g done'.
                has_proof = (tracked is not None
                             and type(tracked.get("verified_session_count")) is int
                             and tracked["verified_session_count"] > 0)
                delivered = _number(tracked.get("delivered_g")) if has_proof and not review else None
                remaining = _number(tracked.get("remaining_g")) if has_proof and not review else None
                products.append({
                    "product": _text(product.get("product")) or "Produk tidak diketahui",
                    "source_row": product.get("source_row") if type(product.get("source_row")) is int else None,
                    "is_fertilizer": product.get("is_fertilizer") is True,
                    "amount": _number(product.get("amount")),
                    "unit": _text(product.get("unit")),
                    "target_mass_g": _number(product.get("product_mass_g")),
                    "credited_mass_g": delivered,
                    "remaining_mass_g": remaining,
                    "ledger_status": _text(tracked.get("status")) if tracked else None,
                    "requires_review": review,
                    "review_reasons": _str_list(product.get("review_reasons")) + (
                        ["manual_completion_requires_reconciliation"] if manually_completed else []
                    ),
                })
            activities.append({
                "activity_id": _text(activity.get("activity_id")) or "",
                "title": _text(activity.get("title")) or "Kegiatan",
                "hst": activity.get("hst") if type(activity.get("hst")) is int else None,
                "application_date": _text(activity.get("application_date")),
                "calendar_status": _text(activity.get("calendar_status")) or "UNKNOWN",
                "method": _text(activity.get("method")),
                "reference_water_l": _number(activity.get("reference_water_l")),
                "manually_completed": manually_completed,
                "products": products,
            })
        config = program.get("config")
        config = config if isinstance(config, dict) else {}
        programs.append({
            "program_id": _text(program.get("program_id")) or "",
            "crop_name": _text(program.get("crop_name")) or "Tanaman",
            "current_hst": program.get("current_hst") if type(program.get("current_hst")) is int else None,
            "plant_count": _number(program.get("plant_count")),
            "planting_date": _text(config.get("plantingDate")),
            "status": _text(program.get("status")) or "UNKNOWN",
            "hold_reasons": _str_list(program.get("hold_reasons")),
            "activities": activities,
        })

    plan = decision.get("plan")
    plan = plan if isinstance(plan, dict) and "hold" not in plan else {}
    fuzzy = decision.get("fuzzy")
    fuzzy = fuzzy if isinstance(fuzzy, dict) else {}
    return {
        "schemaVersion": 1,
        "mode": "SHADOW_MODE",
        "can_dispatch": False,
        "status": "CURRENT" if current else "STALE" if selected else "NO_DECISION",
        "evaluated_at": selected[2] if selected else None,
        "decision": {
            "type": _text(decision.get("type")) if selected else None,
            "proposed_action": _text(decision.get("proposed_action")) if selected else None,
            "hold_reasons": _str_list(decision.get("hold_reasons")),
            "configuration_version": _text(decision.get("configuration_version")),
        },
        "feedback": {
            "status": _text(report.get("status")) or "UNAVAILABLE",
            "reported_off": report.get("reported_off") is True and feedback_fresh,
            "boot_matches": report.get("boot_matches") is True and feedback_fresh,
            "water_pump": report.get("water_pump") if type(report.get("water_pump")) is bool and feedback_fresh else None,
            "fert_pump": report.get("fert_pump") if type(report.get("fert_pump")) is bool and feedback_fresh else None,
            "reported_at": _iso(report.get("reported_at")),
        },
        "sensors": {
            "recorded_at": _iso(telemetry.get("recorded_at")),
            "soil_moisture_pct": _number(telemetry.get("soil_1_moisture")),
            "water_tank_pct": _number(telemetry.get("tank_water_level_pct")),
            "stock_tank_pct": _number(telemetry.get("tank_fert_level_pct")),
            "device_mode": _text(device.get("mode")),
        },
        "calculation": {
            "water_l": _number(plan.get("water_l")),
            "stock_l": _number(plan.get("stock_l")),
            "fertilizer_mass_g": _number(plan.get("mass_g")),
            "duration_seconds": _number(plan.get("duration_seconds")),
            "fuzzy_score": _number(fuzzy.get("score")),
        },
        "programs": programs,
        "note": "Rencana SHADOW; kebutuhan panduan bukan bukti aplikasi fisik.",
    }
