"""Bounded presentation of REAL SHADOW decisions for the local SPFF dashboard.

No calculations are recreated in the browser, and no synthetic scenario is
promoted to a plant recommendation. A missing or stale decision stays explicit.
"""
from datetime import datetime, timezone
from math import isfinite
from decimal import Decimal

from .calculations import fuzzy_volume
from .planning_preview import activity_planning_preview
from .stock_bindings import resolve_binding
from .tank_preview import estimate_water_tank, estimate_fertilizer_tank
from .irrigation_schedule_preview import illustrate_two_day_irrigation
from .water_carryover import present_carryover
from .production_profile import resolve_guide_irrigation, production_fuzzy_result


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
    return float(value) if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool) and isfinite(value) and 0 <= value <= 1e12 else None


def _fresh(value, now, maximum_age):
    normalized = _iso(value)
    return normalized is not None and -5 <= (now - datetime.fromisoformat(normalized)).total_seconds() <= maximum_age


def _text(value):
    return value[:200] if isinstance(value, str) else None


def _str_list(values, cap=40):
    return [_text(v) for v in values[:cap] if isinstance(v, str)] if isinstance(values, list) else []


def present_shadow_dashboard(decisions, now=None, simulation_config=None, stock_concentration_g_l=None,
                             planned_water_l=None, selected_program_id=None, selected_activity_id=None,
                             planning_observation=None, stock_bindings=None,
                             tank_capacity_l=5000.0, tank_height_cm=180.0,
                             water_carryover_state=None,
                             fert_tank_capacity_l=500.0, fert_tank_height_cm=90.0,
                             operational_profile=None):
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
    # A fresh *read-only* SPFF snapshot may update ONLY the planning preview.
    # Historical decision, HOLD, feedback, and ledger retain their own identity.
    stored_snapshot = decision.get("input_snapshot")
    stored_snapshot = stored_snapshot if isinstance(stored_snapshot, dict) else {}
    live_source = isinstance(planning_observation, dict) and planning_observation.get("schema_compatible") is True
    snapshot = planning_observation if live_source else stored_snapshot
    telemetry = snapshot.get("telemetry")
    telemetry = telemetry if isinstance(telemetry, dict) else {}
    device = snapshot.get("device_status")
    device = device if isinstance(device, dict) else {}
    guide = snapshot.get("guide_programs")
    guide = guide if isinstance(guide, dict) else {}
    control = snapshot.get("automatic_control")
    control = control if isinstance(control, dict) else {}
    flow_reference = snapshot.get("historical_flow_reference")
    flow_reference = flow_reference if isinstance(flow_reference, dict) else None
    # Saved generic recipes are NOT explicitly bound to Guide source_row.
    # Never infer fertilizer concentration from matching names or crop/HST.
    health = telemetry.get("sensor_health")
    health = health if isinstance(health, dict) else {}
    planning_fresh = (
        _fresh(telemetry.get("recorded_at"), now, 120)
        and (not live_source or _fresh(telemetry.get("received_at"), now, 120))
    )
    planning_status = "CURRENT" if planning_fresh else "STALE" if telemetry else "UNAVAILABLE"

    def sensor_valid(key):
        diagnostic = health.get(key)
        if not isinstance(diagnostic, dict):
            return None
        return diagnostic.get("valid") if type(diagnostic.get("valid")) is bool else None

    soil_1_valid = sensor_valid("soil_1_moisture")
    soil_2_valid = sensor_valid("soil_2_moisture")
    selected_soil = control.get("water_sensor_key")
    selected_soil = selected_soil if selected_soil in ("soil_1_moisture", "soil_2_moisture") else None
    report = decision.get("pump_feedback")
    report = report if isinstance(report, dict) else {}
    feedback_fresh = (current and _fresh(report.get("reported_at"), now, 25)
                      and _fresh(report.get("received_at"), now, 25))
    ledger = decision.get("obligation_progress")
    ledger = ledger if isinstance(ledger, list) else decision.get("obligations")
    ledger = ledger if isinstance(ledger, list) else []
    # Use the presentation ledger for completed and active obligations.
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
                "planning_preview": activity_planning_preview(
                    activity, flow_reference, stock_concentration_g_l,
                    planned_water_l if (
                        selected_program_id == program.get("program_id")
                        and selected_activity_id == activity.get("activity_id")
                    ) else None,
                ),
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

    # Independent, NON-OPERATIONAL Fuzzy model preview from the genuine stored
    # SHADOW sensor snapshot. This is never the LiveEngine irrigation plan and
    # may not be used to dispatch or claim agronomic/hydraulic accuracy.
    # Only intentionally simulation-only profiles are eligible.
    fuzzy_preview = None
    fuzzy_preview_blockers = []
    operational_config, operational_state = resolve_guide_irrigation(operational_profile, guide)
    fuzzy_config = operational_config or simulation_config
    fuzzy_basis = "OPERATIONAL_PROFILE" if operational_config is not None else "SIMULATION_PROFILE"
    if not selected and not live_source:
        fuzzy_preview_blockers.append("no_source_decision")
    if operational_config is None and (simulation_config is None or getattr(simulation_config, "simulation_only", False) is not True):
        fuzzy_preview_blockers.append("simulation_profile_unavailable")

    selected_value = _number(telemetry.get(selected_soil)) if selected_soil else None
    selected_health = health.get(selected_soil) if selected_soil else None
    if selected_soil is None:
        fuzzy_preview_blockers.append("control_source_not_selected")
    elif selected_value is None or selected_value > 100:
        fuzzy_preview_blockers.append("selected_sensor_value_missing")

    if not isinstance(selected_health, dict) or selected_health.get("valid") is not True:
        fuzzy_preview_blockers.append("selected_sensor_health_invalid")
    else:
        if selected_health.get("controlValid") is False:
            fuzzy_preview_blockers.append("sensor_control_diagnostic_rejected")
        if selected_health.get("rawFresh") is not True or selected_health.get("lastPollOk") is not True:
            fuzzy_preview_blockers.append("sensor_raw_poll_not_verified")
        boot_id = selected_health.get("pollBootId")
        if not isinstance(boot_id, str) or not boot_id:
            fuzzy_preview_blockers.append("sensor_poll_boot_missing")
        raw_value = selected_health.get("raw")
        if not (
            type(raw_value) is int and 0 <= raw_value <= 1000
            and selected_value is not None
            and abs(raw_value / 10 - selected_value) <= 0.11
        ):
            fuzzy_preview_blockers.append("sensor_raw_value_unverified")
        raw_age = selected_health.get("rawAgeMs")
        if not (type(raw_age) is int and 0 <= raw_age <= 60000):
            fuzzy_preview_blockers.append("sensor_raw_age_unverified")

    if not (
        control.get("acknowledgement_status") == "applied"
        and type(control.get("revision")) is int
        and control.get("revision") == control.get("acknowledged_revision")
    ):
        fuzzy_preview_blockers.append("control_config_not_acknowledged")
    if _iso(telemetry.get("recorded_at")) is None:
        fuzzy_preview_blockers.append("sensor_timestamp_missing")
    elif not planning_fresh:
        fuzzy_preview_blockers.append("sensor_snapshot_stale")

    if not fuzzy_preview_blockers:
        try:
            projected = fuzzy_volume(selected_value, fuzzy_config)
            fuzzy_preview = {
                "basis": fuzzy_basis,
                "config_version": _text(fuzzy_config.version) or "simulation",
                "input_key": selected_soil,
                "moisture_pct": selected_value,
                "score": _number(projected.get("score")),
                "illustrative_water_l": _number(projected.get("water_l")),
                "model_max_irrigation_l": _number(fuzzy_config.max_irrigation_l),
                "recorded_at": _iso(telemetry.get("recorded_at")),
            }
        except (ValueError, ArithmeticError, KeyError, TypeError):
            fuzzy_preview_blockers.append("simulation_rules_invalid")
    # Bind each Guide fertilizer row independently to an explicitly selected
    # approved stock recipe. Bindings live ONLY in isolated SHADOW staging
    # storage; source recipe concentration always comes from current PostgreSQL.
    raw_programs = [p for p in guide.get("programs", []) if isinstance(p, dict)]
    for program in programs:
        raw_program = next((p for p in raw_programs if p.get("program_id") == program["program_id"]), None)
        if raw_program is None:
            continue
        raw_activities = [a for a in raw_program.get("activities", []) if isinstance(a, dict)]
        for activity in program["activities"]:
            raw_activity = next((a for a in raw_activities if a.get("activity_id") == activity["activity_id"]), None)
            if raw_activity is None:
                continue
            preview = activity["planning_preview"]
            if not preview["product_options"] or not live_source:
                continue
            for option in preview["product_options"]:
                row = option["source_row"]
                if row is None:
                    option["reasons"].append("stock_binding_required")
                    continue
                try:
                    concentration, status, recipe_id = resolve_binding(
                        snapshot, stock_bindings or {}, raw_program, raw_activity,
                        {"source_row": row}
                    )
                except (KeyError, ValueError, TypeError):
                    concentration, status, recipe_id = None, "STALE", None
                option["binding_status"] = status
                option["stock_recipe_id"] = recipe_id
                option["stock_concentration_g_l"] = concentration
                option["reasons"] = [reason for reason in option["reasons"]
                                     if reason != "stock_concentration_not_provided"]
                if status != "BOUND":
                    option["stock_l"] = None
                    option["stock_duration_minutes"] = None
                    option["reasons"].append(
                        "stock_binding_stale" if status == "STALE" else "stock_binding_required"
                    )
                    continue
                if option["mass_g"] is not None:
                    option["stock_l"] = option["mass_g"] / concentration
                    flow = preview.get("flow_reference")
                    rate = _number(flow.get("stock_lpm")) if isinstance(flow, dict) else None
                    option["stock_duration_minutes"] = (
                        option["stock_l"] / rate if rate and rate > 0 else None
                    )
                    if (preview["water_duration_minutes"] is not None
                            and option["stock_duration_minutes"] is not None
                            and option["stock_duration_minutes"] > preview["water_duration_minutes"]):
                        option["reasons"].append("stock_duration_exceeds_water_duration")
            if preview["product_options"]:
                preview["reasons"] = [reason for reason in preview["reasons"]
                                      if reason != "stock_concentration_not_provided"]
                if len(preview["product_options"]) == 1:
                    option = preview["product_options"][0]
                    preview["stock_l"] = option["stock_l"]
                    preview["stock_duration_minutes"] = option["stock_duration_minutes"]
                    preview["stock_concentration_g_l"] = option["stock_concentration_g_l"]
                if any(o["binding_status"] == "STALE" for o in preview["product_options"]):
                    preview["reasons"].append("stock_binding_stale")
                elif any(o["binding_status"] == "UNBOUND" for o in preview["product_options"]):
                    preview["reasons"].append("stock_binding_required")

    # Only a freshly validated Fuzzy SIMULATION may illustrate water volume
    # where the Guide has no water reference. This is deliberately NOT an
    # operational irrigation/fertigation plan, nor a guaranteed mix volume.
    if fuzzy_preview and planning_fresh:
        water = _number(fuzzy_preview.get("illustrative_water_l"))
        if water is not None:
            for program in programs:
                for activity in program["activities"]:
                    preview = activity["planning_preview"]
                    # Fuzzy irrigation demand is NOT a spray mixture volume
                    # or a water budget for dry/tabur application.
                    method = str(activity.get("method") or "").strip().lower()
                    if preview["water_l"] is not None or method not in (
                        "kocor", "fertigasi", "irigasi", "tetes", "drip"
                    ):
                        continue
                    preview["water_l"] = water
                    preview["water_source"] = "FUZZY_OPERATIONAL" if operational_config is not None else "FUZZY_SIMULATION"
                    preview["reasons"] = [x for x in preview["reasons"] if x != "guide_reference_water_missing"]
                    if operational_config is None:
                        preview["reasons"].append("fuzzy_water_is_simulation_only")
                    flow = preview.get("flow_reference")
                    rate = _number(flow.get("water_lpm")) if isinstance(flow, dict) else None
                    preview["water_duration_minutes"] = water / rate if rate and rate > 0 else None
                    for option in preview["product_options"]:
                        if (preview["water_duration_minutes"] is not None
                                and option["stock_duration_minutes"] is not None
                                and option["stock_duration_minutes"] > preview["water_duration_minutes"]
                                and "stock_duration_exceeds_water_duration" not in option["reasons"]):
                            option["reasons"].append("stock_duration_exceeds_water_duration")

    tank = estimate_water_tank(
        telemetry, capacity_l=tank_capacity_l, height_cm=tank_height_cm,
        source_current=planning_fresh, source_read_only=live_source,
        fuzzy_water_l=(
            fuzzy_preview.get("illustrative_water_l") if fuzzy_preview else None
        ),
    )

    fert_tank = estimate_fertilizer_tank(
        telemetry, capacity_l=fert_tank_capacity_l,
        height_cm=fert_tank_height_cm,
        source_current=planning_fresh, source_read_only=live_source,
    )

    irrigation_schedule = illustrate_two_day_irrigation(
        telemetry, now=now, capacity_l=tank_capacity_l, height_cm=tank_height_cm,
        source_current=planning_fresh, source_read_only=live_source,
        fuzzy_water_l=(
            fuzzy_preview.get("illustrative_water_l") if fuzzy_preview else None
        ),
    )

    production_fuzzy = production_fuzzy_result(operational_profile, guide, fuzzy_preview,
        fuzzy_preview_blockers, now=now, live_source=live_source)
    operational_state["calculation_ready"] = production_fuzzy["status"] == "READY"
    # Expose ONLY bounded reason codes, never raw Modbus/DB payload or credentials.
    return {
        "schemaVersion": 1,
        "mode": "SHADOW_MODE",
        "can_dispatch": False,
        "status": "CURRENT" if current else "STALE" if selected else "NO_DECISION",
        "evaluated_at": selected[2] if selected else None,
        "planning_source": "POSTGRES_READ_ONLY" if live_source else "DECISION_SNAPSHOT",
        "planning_status": planning_status,
        "planning_recorded_at": _iso(telemetry.get("recorded_at")),
        "flow_reference": flow_reference,
        "tank_preview": tank,
        "fertilizer_tank_preview": fert_tank,
        "irrigation_schedule_preview": irrigation_schedule,
        "water_carryover": present_carryover(water_carryover_state or {}, now=now),
        "decision": {
            "type": _text(decision.get("type")) if selected else None,
            "proposed_action": _text(decision.get("proposed_action")) if selected else None,
            "hold_reasons": _str_list(decision.get("hold_reasons")),
            "configuration_version": _text(decision.get("configuration_version")),
        },
        "feedback": {
            "status": (_text(report.get("status")) or "UNAVAILABLE") if feedback_fresh
                      else "STALE" if report else "UNAVAILABLE",
            "reported_off": report.get("reported_off") is True and feedback_fresh,
            "boot_matches": report.get("boot_matches") is True and feedback_fresh,
            "water_pump": report.get("water_pump") if type(report.get("water_pump")) is bool and feedback_fresh else None,
            "fert_pump": report.get("fert_pump") if type(report.get("fert_pump")) is bool and feedback_fresh else None,
            "reported_at": _iso(report.get("reported_at")),
        },
        "sensors": {
            "recorded_at": _iso(telemetry.get("recorded_at")),
            # A numeric reading is not trustworthy without its source health.
            # Never silently substitute soil 2 for a missing soil 1.
            "soil_moisture_pct": _number(telemetry.get("soil_1_moisture")) if soil_1_valid is True else None,
            "soil_2_moisture_pct": _number(telemetry.get("soil_2_moisture")) if soil_2_valid is True else None,
            "soil_1_valid": soil_1_valid,
            "soil_2_valid": soil_2_valid,
            "control_moisture_source": selected_soil,
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
        "fuzzy_preview": fuzzy_preview,
        "fuzzy_preview_blockers": fuzzy_preview_blockers,
        "operational_profile": operational_state,
        "production_fuzzy": production_fuzzy,
        "programs": programs,
        "note": "Rencana SHADOW; kebutuhan panduan bukan bukti aplikasi fisik.",
    }
