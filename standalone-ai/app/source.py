"""Read-only adapter for audited SPFF migrations 001, 013, 017, 020-025.

No inferred emergency-stop, selector or session capability fields. Until their
device contract is proven, this adapter records an explicit integration HOLD.
"""
from datetime import datetime, timezone
from uuid import uuid4

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
    def __init__(self, dsn, site_id, device_id, zone_id):
        self.dsn, self.site_id, self.device_id, self.zone_id = dsn, site_id, device_id, zone_id

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
            return {"schema_compatible": True, "telemetry": telemetry, "device_status": status,
                    "automatic_control": control, "approved_programs": programs, "recent_sessions": sessions,
                    "can_dispatch": False, "blocking_reason": "volume_session_and_safety_contract_not_verified"}

    def record_shadow(self, store):
        observation = self.inspect()
        decision = {"decision_id": str(uuid4()), "type": "HOLD", "mode": "SHADOW_MODE",
                    "at": datetime.now(timezone.utc).isoformat(), "can_dispatch": False,
                    "dispatch_status": "NOT_DISPATCHED", "simulation": False,
                    "reason": observation.get("blocking_reason", "source_schema_incompatible"),
                    "source_observation": observation}
        # Normalize datetime/UUID/Decimal to JSON without ever recording the DSN.
        import json
        decision = json.loads(json.dumps(decision, default=str, allow_nan=False))
        with store.transaction() as state:
            state["decisions"][decision["decision_id"]] = decision
            state["current_decision_id"] = decision["decision_id"]
        return decision
