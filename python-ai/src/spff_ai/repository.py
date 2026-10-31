"""PostgreSQL adapter: SELECT existing tables, write adaptive_ai_* only.

No MQTT, serial, command insert, migration runner or device control API.
"""
import json
import hashlib
import math
from dataclasses import asdict
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

from . import __version__
from .adapters import ExistingFinalSessionAdapter, ExplicitStatusSafetyAdapter, UnreviewedRecoveryAdapter
from .core import JAKARTA, RANGES, decide, due, fresh, mass_balance, obligation_id, sensor_ok
from .learning import FlowState, learn_feedback


def json_default(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    raise TypeError(type(value).__name__)


def audit_json(value):
    """Preserve corrupt numeric inputs as explicit markers in the audit record."""
    if isinstance(value,float) and not math.isfinite(value):
        return {"invalid_numeric": str(value)}
    if isinstance(value,dict):
        return {k:audit_json(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):
        return [audit_json(v) for v in value]
    return value


def packed(value):
    return json.dumps(audit_json(value), default=json_default, allow_nan=False,sort_keys=True)


class PostgresRepository:
    def __init__(self, settings, delivery_adapter=None, safety_adapter=None, recovery_adapter=None):
        self.settings = settings
        self.delivery = delivery_adapter or ExistingFinalSessionAdapter(settings.evidence_complete)
        self.safety = safety_adapter or ExplicitStatusSafetyAdapter()
        self.recovery = recovery_adapter or UnreviewedRecoveryAdapter()

    def run_once(self):
        import psycopg
        # PostgreSQL aborts a stale competing snapshot; retry the entire unit,
        # including reads. No partial ledger/EMA/decision commit is retained.
        for attempt in range(3):
            try:
                return self._run_once()
            except (psycopg.errors.SerializationFailure, psycopg.errors.DeadlockDetected):
                if attempt == 2:
                    raise

    def _run_once(self):
        import psycopg
        from psycopg.rows import dict_row
        cfg = self.settings
        if cfg.execution_mode != "SHADOW_MODE":
            raise ValueError("Only SHADOW_MODE is implemented")
        with psycopg.connect(cfg.database_url, row_factory=dict_row, connect_timeout=10) as conn:
            with conn.cursor() as c:
                c.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                c.execute("SET LOCAL statement_timeout = '15s'")
                c.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                          (f"adaptive-ai-shadow:{cfg.site}:{cfg.device}",))
                # Database clock keeps all freshness checks consistent in this snapshot.
                c.execute("SELECT transaction_timestamp() AS now")
                now = c.fetchone()["now"]
                snapshot = self.read(c, now)
                snapshot["engine_config"] = {
                    "engine_version": __version__,
                    "execution_mode": cfg.execution_mode, "telemetry_age": cfg.telemetry_age,
                    "status_age": cfg.status_age,"alpha":cfg.alpha,"water_min":cfg.water_min,
                    "fert_min":cfg.fert_min,"fuzzy_profile":asdict(cfg.fuzzy_profile),
                    "ema_min_seconds":cfg.ema_min_seconds,"ema_outlier_factor":cfg.ema_outlier_factor,
                    "ema_profile_revision":cfg.ema_profile_revision}
                obligations = self.obligations(c, snapshot, now)
                snapshot["report_completion"] = any(o["remaining_stock_l"] == 0 and
                    (o["application_day"] == now.astimezone(JAKARTA).date() or
                     any(s.get("_link", {}).get("obligation_id") is not None and
                         str(s["_link"]["obligation_id"]) == o["obligation_id"] and
                         s["last_recorded_at"].astimezone(JAKARTA).date() == now.astimezone(JAKARTA).date()
                         for s in snapshot["sessions"] if s.get("_link"))) for o in obligations)
                ema = self.learn(c, snapshot, now)
                result = decide(snapshot, obligations, now, telemetry_age=cfg.telemetry_age,
                                status_age=cfg.status_age, water_min=cfg.water_min,
                                fert_min=cfg.fert_min, fuzzy_profile=cfg.fuzzy_profile)
                result["ema"] = ema
                result["mass_balances"] = obligations
                o = result.get("obligation")
                if o and ema.get("flow_fert_lpm"):
                    result["estimated_stock_seconds"] = o["remaining_stock_l"]/ema["flow_fert_lpm"]*60
                if result.get("fuzzy", {}).get("target_water_zone_l") is not None and ema.get("flow_water_lpm"):
                    result["estimated_water_seconds"] = result["fuzzy"]["target_water_zone_l"]/ema["flow_water_lpm"]*60
                self.save_calculations(c, obligations, result)
                fingerprint = {"snapshot": snapshot, "obligations": obligations,
                               "action": result["action"], "reason": result["reason"],
                               "ema": ema, "fuzzy": result.get("fuzzy"), "alpha": cfg.alpha,
                               "ema_profile_revision": cfg.ema_profile_revision,
                               "water_min": cfg.water_min,"fert_min":cfg.fert_min,
                               "telemetry_age":cfg.telemetry_age,"status_age":cfg.status_age,
                               "ema_min_seconds":cfg.ema_min_seconds,"ema_outlier_factor":cfg.ema_outlier_factor}
                evaluation_key = hashlib.sha256(packed(fingerprint).encode()).hexdigest()
                c.execute("""INSERT INTO spff.adaptive_ai_decisions
                    (decision_id,site_id,device_id,engine_version,execution_mode,evaluated_at,action,result,input_snapshot,evaluation_key)
                    VALUES(%s,%s,%s,%s,'SHADOW_MODE',%s,%s,%s::jsonb,%s::jsonb,%s)
                    ON CONFLICT(site_id,device_id,evaluation_key) DO NOTHING""",
                          (uuid4(), cfg.site, cfg.device, __version__, now, result["action"],
                           packed(result), packed(snapshot), evaluation_key))
                c.execute("SELECT result FROM spff.adaptive_ai_decisions WHERE site_id=%s AND device_id=%s AND evaluation_key=%s",
                          (cfg.site, cfg.device, evaluation_key))
                result = c.fetchone()["result"]
            return result

    def read(self, c, now):
        cfg = self.settings
        def rows(sql, args=None):
            c.execute(sql, args if args is not None else (cfg.site, cfg.device))
            return c.fetchall()
        def one(sql):
            return next(iter(rows(sql)), {})
        device = one("SELECT * FROM spff.devices WHERE site_id=%s AND device_id=%s")
        if not device:
            raise ValueError("Unknown device")
        raw_telemetry = rows("""SELECT * FROM spff.telemetry_samples WHERE site_id=%s AND device_id=%s
            AND recorded_at >= %s AND recorded_at <= %s
            ORDER BY recorded_at DESC,telemetry_id DESC""",
                             (cfg.site, cfg.device, now-timedelta(seconds=cfg.telemetry_age), now))
        telemetry = select_parameters(raw_telemetry, now, cfg.telemetry_age)
        status = one("""SELECT * FROM spff.device_status_events WHERE site_id=%s AND device_id=%s
            ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1""")
        config = one("SELECT * FROM spff.device_automatic_control_configs WHERE site_id=%s AND device_id=%s")
        crop = rows("SELECT * FROM spff.site_crop_selections WHERE site_id=%s AND zone_id='soil-1'", (cfg.site,))
        recipes = rows("""SELECT * FROM spff.fertigation_recipes WHERE site_id=%s
            AND zone_id='soil-1' AND crop_id=%s ORDER BY recipe_id""",
                       (cfg.site, crop[0]["crop_id"] if crop else None))
        sessions = rows("SELECT * FROM spff.fertigation_sessions WHERE site_id=%s AND device_id=%s")
        sessions.sort(key=lambda s:str(s["session_id"]))
        final_events = rows("""SELECT DISTINCT ON(session_id) session_id,status,payload,recorded_at
            FROM spff.fertigation_session_events WHERE site_id=%s AND device_id=%s
            ORDER BY session_id,recorded_at DESC,event_id DESC""")
        links = rows("""SELECT l.* FROM spff.adaptive_ai_session_links l
            JOIN spff.adaptive_ai_obligations o USING(obligation_id)
            WHERE o.site_id=%s AND o.device_id=%s""")
        for session in sessions:
            session["_link"] = next((l for l in links if str(l["source_session_id"]) == str(session["session_id"])), None)
            session["_final_event"] = next((e for e in final_events if str(e["session_id"]) == str(session["session_id"])), None)
        schedules = rows("SELECT * FROM spff.actuator_schedules WHERE site_id=%s AND device_id=%s AND enabled ORDER BY schedule_id")
        pulses = rows("""SELECT session_id,status,application_day FROM spff.soil_ec_pulse_sessions
            WHERE site_id=%s AND device_id=%s""")
        interlock = one("SELECT * FROM spff.device_water_interlock_configs WHERE site_id=%s AND device_id=%s")
        states = rows("""SELECT DISTINCT ON (actuator_key) * FROM spff.actuator_state_events
            WHERE site_id=%s AND device_id=%s ORDER BY actuator_key,recorded_at DESC,actuator_state_id DESC""")
        reasons = []
        if not device["enabled"]:
            reasons.append("device_disabled")
        if (not interlock or interlock.get("enabled") is not True
                or interlock.get("applied_enabled") is not True
                or interlock.get("acknowledgement_status") != "applied"
                or interlock.get("revision") != interlock.get("acknowledged_revision")):
            reasons.append("water_interlock_not_verified_enabled")
        reasons.extend(self.safety.reasons(status))
        for key in ("pump_water", "pump_fert"):
            state = next((s for s in states if s["actuator_key"] == key), {})
            if (not fresh(state.get("recorded_at"), now, cfg.status_age)
                    or state.get("state") != "inactive" or state.get("is_active") is not False):
                reasons.append(f"{key}_not_verified_off")
        if any(s["status"] in ("started", "running") for s in sessions):
            reasons.append("existing_session_active")
        reasons.extend(self.recovery.reasons(sessions))
        blockers = []
        if not crop:
            blockers.append("active_crop_missing")
        if any(r.get("application_mode") == "sensor" and r.get("approval_status") == "approved" for r in recipes):
            blockers.append("sensor_program_requires_schedule_adapter")
        if any(s["status"] in ("waiting", "in_flight", "fault") for s in pulses):
            reasons.append("soil_ec_owner_or_fault")
        # Pulses have no liters; never treat them as zero physical delivery.
        if pulses:
            blockers.append("pulse_volume_history_requires_delivery_adapter")
        if schedules:
            blockers.append("enabled_actuator_schedule_requires_arbitration_adapter")
        return {"site_id":cfg.site,"device_id":cfg.device,"telemetry": telemetry, "status": status, "config": config,
                "crop": crop, "recipes": recipes, "sessions": sessions,
                "actuator_schedules": schedules, "safety_reasons": reasons,
                "moisture_sensor_key": config.get("water_sensor_key", "soil_1_moisture"),
                "blockers": blockers, "evidence_complete": cfg.evidence_complete}

    def obligations(self, c, snapshot, now):
        cfg, day = self.settings, now.astimezone(JAKARTA).date()
        eligible = [r for r in snapshot["recipes"] if due(r, day) and r["target_stock_l"] > 0]
        if len(eligible) > 1:
            snapshot["blockers"].append("ambiguous_due_fertilizer_programs")
            eligible = []
        candidates = [(r, day) for r in eligible]
        # Bootstrap prior, explicitly correlated device sessions as shadow debt.
        # Historical calendar days with no session are not silently replayed.
        for session in snapshot["sessions"]:
            if session.get("_link"):
                continue  # Explicit obligation mapping survives midnight and new due dates.
            started = session.get("started_at")
            recipe = next((r for r in snapshot["recipes"]
                           if str(r["recipe_id"]) == str(session.get("recipe_id"))), None)
            if not recipe or not started or started > now:
                snapshot["blockers"].append("historical_session_requires_obligation_adapter")
                continue
            application_day = started.astimezone(JAKARTA).date()
            if (not due(recipe, application_day)
                    or session["target_stock_l"] != recipe["target_stock_l"]
                    or session["target_water_l"] != recipe["target_water_l"]):
                snapshot["blockers"].append("historical_session_recipe_target_mismatch")
                continue
            if recipe["target_stock_l"] > 0:
                candidates.append((recipe, application_day))
        for r, application_day in candidates:
            oid = obligation_id(cfg.site, cfg.device, r["recipe_id"], application_day)
            c.execute("""INSERT INTO spff.adaptive_ai_obligations
                (obligation_id,site_id,device_id,recipe_id,application_day,recipe_revision,recipe_snapshot)
                VALUES(%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING""",
                      (oid, cfg.site, cfg.device, r["recipe_id"], application_day, r["revision"], packed(r)))
        c.execute("SELECT * FROM spff.adaptive_ai_obligations WHERE site_id=%s AND device_id=%s ORDER BY application_day,obligation_id",
                  (cfg.site, cfg.device))
        result = []
        for o in c.fetchall():
            r = o["recipe_snapshot"]
            current = next((v for v in snapshot["recipes"] if str(v["recipe_id"]) == str(o["recipe_id"])), None)
            evidence, known = self.delivery.collect(snapshot["sessions"], str(o["recipe_id"]), o["application_day"],
                                                     obligation=o, now=now)
            # Recipe snapshot is immutable. Edits/revocation/crop changes require review.
            if not current or current["revision"] != o["recipe_revision"] or current["approval_status"] != "approved":
                snapshot["blockers"].append("obligation_recipe_changed_or_revoked")
                known = False
            for sid, liters in evidence:
                source = next(s for s in snapshot["sessions"] if str(s["session_id"]) == sid)
                c.execute("""INSERT INTO spff.adaptive_ai_delivery_evidence
                    (source_session_id,obligation_id,actual_stock_l,source_recorded_at)
                    VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                          (sid, o["obligation_id"], liters, source["last_recorded_at"]))
                c.execute("SELECT * FROM spff.adaptive_ai_delivery_evidence WHERE source_session_id=%s", (sid,))
                saved = c.fetchone()
                if str(saved["obligation_id"]) != str(o["obligation_id"]) or saved["actual_stock_l"] != liters:
                    known = False
                    snapshot["blockers"].append("REQUIRES_REVIEW:conflicting_delivery_evidence")
            c.execute("SELECT source_session_id,actual_stock_l FROM spff.adaptive_ai_delivery_evidence WHERE obligation_id=%s",
                      (o["obligation_id"],))
            stored_evidence = c.fetchall()
            if not {str(e["source_session_id"]) for e in stored_evidence}.issubset({sid for sid, _ in evidence}):
                known = False
            balance = mass_balance(r["target_stock_l"], r["stock_concentration_g_per_l"],
                                   [(str(e["source_session_id"]), e["actual_stock_l"]) for e in stored_evidence])
            result.append({**balance, "obligation_id": str(o["obligation_id"]),
                           "recipe_id": str(o["recipe_id"]), "application_day": o["application_day"],
                           "evidence_known": known, "calculation_status": "REQUIRES_REVIEW" if not known else
                           ("COMPLETED" if balance["remaining_stock_l"] == 0 else "OUTSTANDING"), "min_water_tank_percent": r["min_water_tank_percent"],
                           "min_stock_tank_percent": r["min_stock_tank_percent"]})
            if not known:
                snapshot["blockers"].append("REQUIRES_REVIEW:obligation_delivery_unknown")
            if balance["excess_stock_l"] > 0:
                snapshot["safety_reasons"].append("fertilizer_overdelivery")
        return result

    def save_calculations(self, c, obligations, decision):
        for o in obligations:
            status = o["calculation_status"]
            selected = decision.get("obligation", {}).get("obligation_id") or decision.get("obligation_id")
            if decision["action"] == "WAITING_FOR_WATER" and o["remaining_stock_l"] > 0 and (not selected or selected == o["obligation_id"]):
                status = "WAITING_FOR_WATER" if o["evidence_known"] else "REQUIRES_REVIEW"
            c.execute("""UPDATE spff.adaptive_ai_obligations SET calculation_status=%s,
                calculation=%s::jsonb,updated_at=now() WHERE obligation_id=%s""",
                      (status, packed(o), o["obligation_id"]))

    def learn(self, c, snapshot, now):
        cfg, result = self.settings, {}
        profile_revision = f"{cfg.ema_profile_revision}:device-config:{snapshot.get('config', {}).get('revision', 'unknown')}"
        for key, actuator in (("flow_water_lpm", "pump_water"), ("flow_fert_lpm", "pump_fert")):
            c.execute("SELECT state FROM spff.adaptive_ai_flow_state WHERE site_id=%s AND device_id=%s AND sensor_key=%s",
                      (cfg.site, cfg.device, key))
            old = c.fetchone()
            state = FlowState.load(old["state"]) if old else FlowState(profile_revision=profile_revision)
            c.execute("""SELECT t.*,s.state AS pump_state,s.is_active AS pump_active,s.recorded_at AS pump_at
                FROM spff.telemetry_samples t LEFT JOIN LATERAL (
                  SELECT state,is_active,recorded_at FROM spff.actuator_state_events
                  WHERE site_id=t.site_id AND device_id=t.device_id AND actuator_key=%s AND recorded_at<=t.recorded_at
                  ORDER BY recorded_at DESC,actuator_state_id DESC LIMIT 1
                ) s ON true WHERE t.site_id=%s AND t.device_id=%s
                  AND t.recorded_at>=%s AND t.recorded_at<=%s
                ORDER BY t.recorded_at,t.telemetry_id""",
                      (actuator, cfg.site, cfg.device, now-timedelta(seconds=cfg.telemetry_age), now))
            for row in c.fetchall():
                c.execute("SELECT 1 FROM spff.adaptive_ai_ema_feedback WHERE site_id=%s AND device_id=%s AND sensor_key=%s AND message_id=%s",
                          (cfg.site, cfg.device, key, row["message_id"]))
                if c.fetchone():
                    continue
                state, trace = learn_feedback(state, row, key, now, alpha=cfg.alpha,
                    min_seconds=cfg.ema_min_seconds, max_age=cfg.telemetry_age,
                    status_age=cfg.status_age, outlier_factor=cfg.ema_outlier_factor,
                    profile_revision=profile_revision)
                c.execute("""INSERT INTO spff.adaptive_ai_ema_feedback
                    (site_id,device_id,sensor_key,message_id,recorded_at,profile_revision,accepted,trace)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING""",
                          (cfg.site,cfg.device,key,row["message_id"],row["recorded_at"],profile_revision,
                           trace["accepted"],packed(trace)))
            c.execute("""INSERT INTO spff.adaptive_ai_flow_state(site_id,device_id,sensor_key,state)
                VALUES(%s,%s,%s,%s::jsonb) ON CONFLICT(site_id,device_id,sensor_key) DO UPDATE SET state=excluded.state""",
                      (cfg.site,cfg.device,key,packed(state.json())))
            if state.value is not None:
                c.execute("""INSERT INTO spff.adaptive_ai_ema
                    (site_id,device_id,sensor_key,value_lpm,last_recorded_at,sample_count,profile_revision)
                    VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(site_id,device_id,sensor_key)
                    DO UPDATE SET value_lpm=excluded.value_lpm,last_recorded_at=excluded.last_recorded_at,
                      sample_count=excluded.sample_count,profile_revision=excluded.profile_revision""",
                          (cfg.site,cfg.device,key,state.value,state.last_at,state.count,state.profile_revision))
            result[key] = state.value if (not state.reset_pending and state.profile_revision == profile_revision
                                         and fresh(state.last_at,now,cfg.telemetry_age)) else None
        return result


def select_parameters(rows, now, max_age):
    """Latest individually healthy actual value, with its own timestamp and ID.

    Never relabel an old last-known value with a newer message timestamp.
    Individual health is authoritative even if another sensor makes the global
    sensor_valid flag false. No inferred per-register timestamp is invented.
    """
    result = {"sensor_health": {}, "parameter_recorded_at": {}, "parameter_message_id": {}}
    ordered = sorted(rows, key=lambda r: (r["recorded_at"], r.get("telemetry_id", 0)), reverse=True)
    for key in RANGES:
        source = next((r for r in ordered if sensor_ok(r,key,now,max_age)), None)
        if source:
            result[key] = source[key]
            result["sensor_health"][key] = source["sensor_health"][key]
            result["parameter_recorded_at"][key] = source["recorded_at"]
            result["parameter_message_id"][key] = source.get("message_id")
    result["recorded_at"] = ordered[0]["recorded_at"] if ordered else None
    return result
