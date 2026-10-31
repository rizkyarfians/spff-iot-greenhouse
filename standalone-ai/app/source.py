"""Read-only adapter for audited SPFF migrations 001, 013, 017, 020-025.

No inferred emergency-stop, selector or session capability fields. Until their
device contract is proven, this adapter records an explicit integration HOLD.
"""
from datetime import datetime, timezone
from uuid import uuid4
from .guide_programs import read_guide_programs

REQUIRED = {
    "telemetry_samples": {"telemetry_id", "site_id", "device_id", "message_id", "recorded_at", "sensor_health",
                          "soil_1_moisture", "tank_water_level_pct", "tank_fert_level_pct",
                          "flow_water_total_l", "flow_fert_total_l"},
    "fertigation_recipes": {"site_id", "recipe_id", "planting_date", "application_date", "application_mode",
                           "application_interval_days", "target_stock_l", "stock_concentration_g_per_l", "zone_id", "crop_id", "approval_status", "created_at"},
    "device_automatic_control_configs": {"site_id", "device_id", "desired_mode", "applied_mode", "revision", "acknowledged_revision"},
    "device_status_events": {"device_status_id", "site_id", "device_id", "recorded_at", "raw_payload", "mode"},
    "site_crop_selections": {"site_id", "zone_id", "crop_id"},
    "fertigation_sessions": {"session_id", "site_id", "device_id", "status", "pumps_off", "last_recorded_at"},
}


class SPFFSource:
    def __init__(self, dsn, site_id, device_id, zone_id, *, fertilizer_delivery_route="reference"):
        self.dsn, self.site_id, self.device_id, self.zone_id = dsn, site_id, device_id, zone_id
        if fertilizer_delivery_route not in ("reference", "drip"):
            raise ValueError("unknown fertilizer delivery route")
        self.fertilizer_delivery_route = fertilizer_delivery_route

    def inspect_guides(self):
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(self.dsn, connect_timeout=5, row_factory=dict_row) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            connection.execute("SET LOCAL statement_timeout='5s'")
            return read_guide_programs(connection, self.site_id, self.device_id, self.zone_id,
                                       fertilizer_delivery_route=self.fertilizer_delivery_route)

    def inspect(self):
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(self.dsn, connect_timeout=5, row_factory=dict_row) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            connection.execute("SET LOCAL statement_timeout='5s'")
            rows = connection.execute("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='spff'").fetchall()
            columns = {}
            for row in rows:
                columns.setdefault(row["table_name"], set()).add(row["column_name"])
            missing = {table: sorted(required - columns.get(table, set())) for table, required in REQUIRED.items()
                       if required - columns.get(table, set())}
            if missing:
                return {"schema_compatible": False, "missing": missing, "can_dispatch": False}
            args = (self.site_id, self.device_id)
            telemetry = connection.execute("SELECT * FROM spff.telemetry_samples WHERE site_id=%s AND device_id=%s ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 1", args).fetchone()
            status = connection.execute("SELECT * FROM spff.device_status_events WHERE site_id=%s AND device_id=%s ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1", args).fetchone()
            control = connection.execute("SELECT * FROM spff.device_automatic_control_configs WHERE site_id=%s AND device_id=%s", args).fetchone()
            programs = connection.execute("SELECT r.* FROM spff.fertigation_recipes r JOIN spff.site_crop_selections c ON r.site_id=c.site_id AND r.zone_id=c.zone_id AND r.crop_id=c.crop_id WHERE r.site_id=%s AND r.zone_id=%s AND r.approval_status='approved' ORDER BY r.created_at", (self.site_id, self.zone_id)).fetchall()
            sessions = connection.execute("SELECT session_id,status,pumps_off,last_recorded_at FROM spff.fertigation_sessions WHERE site_id=%s AND device_id=%s ORDER BY last_recorded_at DESC LIMIT 20", args).fetchall()
            # raw_payload can contain unsanitized device input. Keep only audited typed DB columns in responses.
            if telemetry:
                telemetry.pop("raw_payload", None)
            if status:
                status.pop("raw_payload", None)
            relation = connection.execute("SELECT to_regclass('spff.adaptive_fert_events') AS relation").fetchone()["relation"]
            adaptive = None
            adaptive_access = "missing_relation"
            if relation:
                allowed = connection.execute("SELECT has_table_privilege(current_user,'spff.adaptive_fert_events','SELECT') AS allowed").fetchone()["allowed"]
                adaptive_access = "available" if allowed else "select_permission_required"
                if allowed:
                    adaptive = connection.execute("SELECT message_id,payload,received_at FROM spff.adaptive_fert_events WHERE site_id=%s AND device_id=%s AND payload->>'kind'='adaptive_fert_telemetry' ORDER BY received_at DESC,stored_at DESC LIMIT 1", args).fetchone()
            return {"schema_compatible": True, "telemetry": telemetry, "device_status": status,
                    "automatic_control": control, "approved_programs": programs, "recent_sessions": sessions,
                    "guide_programs": read_guide_programs(connection, self.site_id, self.device_id, self.zone_id,
                                                         fertilizer_delivery_route=self.fertilizer_delivery_route),
                    "execution_evidence": {"status": adaptive_access, "latest_adaptive": adaptive},
                    "can_dispatch": False, "blocking_reason": "volume_session_and_safety_contract_not_verified"}

    def record_shadow(self, store):
        from .live_engine import LiveEngine, LiveProfile
        import json
        observation = self.inspect()
        observation = json.loads(json.dumps(observation, default=str, allow_nan=False))
        self.process_bound_feedback(store)
        raw_profile = store.runtime_profile() if hasattr(store, "runtime_profile") else None
        profile = LiveProfile.model_validate(raw_profile) if raw_profile else None
        return LiveEngine(store, self.site_id, self.device_id, self.zone_id).evaluate(observation, profile)

    def process_bound_feedback(self, store):
        """Only DB-origin events explicitly bound by a dispatcher may debit a dose."""
        sessions = store.read().get("live", {}).get("sessions", {})
        if not sessions:
            return
        import psycopg
        from psycopg.rows import dict_row
        from .live_feedback import process_feedback
        with psycopg.connect(self.dsn, connect_timeout=5, row_factory=dict_row) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            connection.execute("SET LOCAL statement_timeout='5s'")
            rows = connection.execute("SELECT message_id,payload FROM spff.adaptive_fert_events WHERE site_id=%s AND device_id=%s AND payload->>'kind'='adaptive_fert_telemetry' AND payload->>'sessionId'=ANY(%s) AND NOT(message_id=ANY(%s)) ORDER BY received_at,stored_at,message_id LIMIT 1000", (self.site_id, self.device_id, list(sessions), list(store.read().get("live", {}).get("feedback", {})))).fetchall()
        for event in rows:
            process_feedback(store, event, datetime.now(timezone.utc))
