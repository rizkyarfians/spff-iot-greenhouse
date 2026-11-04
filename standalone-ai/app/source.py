"""Read-only adapter for audited SPFF migrations 001, 013, 017, 020-025.

No inferred emergency-stop, selector or session capability fields. Until their
device contract is proven, this adapter records an explicit integration HOLD.
"""
from datetime import datetime, timezone
from uuid import uuid4
from .guide_programs import read_guide_programs
from .flow_reference import observed_flow_reference

REQUIRED = {
    "telemetry_samples": {"telemetry_id", "site_id", "device_id", "message_id", "recorded_at", "received_at", "sensor_health",
                          "soil_1_moisture", "tank_water_level_pct", "tank_fert_level_pct",
                          "flow_water_total_l", "flow_fert_total_l"},
    "fertigation_recipes": {"site_id", "recipe_id", "planting_date", "application_date", "application_mode",
                           "application_interval_days", "target_stock_l", "stock_concentration_g_per_l", "zone_id", "crop_id", "approval_status", "created_at"},
    "device_automatic_control_configs": {"site_id", "device_id", "desired_mode", "applied_mode", "revision", "acknowledged_revision"},
    "device_status_events": {"device_status_id", "site_id", "device_id", "recorded_at", "raw_payload", "mode"},
    "site_crop_selections": {"site_id", "zone_id", "crop_id"},
    "fertigation_sessions": {"session_id", "site_id", "device_id", "status", "pumps_off", "last_recorded_at"},
}



def normalize_soil_diagnostics(telemetry):
    """Copy only audited firmware sensor diagnostics into the source snapshot.

    The current firmware calls its control gate "controlEligible"; early
    adapters expected "controlValid". Preserve the real firmware rejection
    rather than assuming a merely valid transport reading is control-ready.
    """
    raw_payload = telemetry.pop("raw_payload", None)
    reported = raw_payload.get("sensorHealth") if isinstance(raw_payload, dict) else None
    normalized = telemetry.get("sensor_health")
    if not isinstance(reported, dict) or not isinstance(normalized, dict):
        return
    for key in ("soil_1_moisture", "soil_2_moisture"):
        raw_diag = reported.get(key)
        current = normalized.get(key)
        if not isinstance(raw_diag, dict) or not isinstance(current, dict):
            continue
        control_diag = {
            name: raw_diag[name]
            for name in ("raw", "rawAgeMs", "rawFresh", "lastPollOk", "pollBootId")
            if name in raw_diag
        }
        # Treat an explicit firmware-level rejection as authoritative.
        # Do not synthesize eligibility when the field is absent.
        eligible = raw_diag.get("controlEligible")
        legacy = raw_diag.get("controlValid")
        if type(eligible) is bool:
            control_diag["controlValid"] = eligible
        elif type(legacy) is bool:
            control_diag["controlValid"] = legacy
        current.update(control_diag)


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
            # Reject poisoned future sensor clocks (e.g. the 2085 record). Source
            # freshness/maximum age is still enforced by LiveEngine using the
            # active runtime planning profile; never invent a fresh reading.
            telemetry = connection.execute(
                "SELECT * FROM spff.telemetry_samples "
                "WHERE site_id=%s AND device_id=%s "
                "AND recorded_at <= received_at + INTERVAL '5 seconds' "
                "AND received_at <= NOW() + INTERVAL '5 seconds' "
                "AND recorded_at <= NOW() + INTERVAL '5 seconds' "
                "ORDER BY recorded_at DESC, telemetry_id DESC LIMIT 1", args
            ).fetchone()
            status = connection.execute("SELECT * FROM spff.device_status_events WHERE site_id=%s AND device_id=%s ORDER BY recorded_at DESC,device_status_id DESC LIMIT 1", args).fetchone()
            control = connection.execute("SELECT * FROM spff.device_automatic_control_configs WHERE site_id=%s AND device_id=%s", args).fetchone()
            programs = connection.execute("SELECT r.* FROM spff.fertigation_recipes r JOIN spff.site_crop_selections c ON r.site_id=c.site_id AND r.zone_id=c.zone_id AND r.crop_id=c.crop_id WHERE r.site_id=%s AND r.zone_id=%s AND r.approval_status='approved' ORDER BY r.created_at", (self.site_id, self.zone_id)).fetchall()
            sessions = connection.execute("SELECT session_id,status,pumps_off,last_recorded_at FROM spff.fertigation_sessions WHERE site_id=%s AND device_id=%s ORDER BY last_recorded_at DESC LIMIT 20", args).fetchall()
            # Never leak arbitrary firmware payload fields into a decision.
            if telemetry:
                normalize_soil_diagnostics(telemetry)
            if status:
                # The normalized device_status row does not expose the boot
                # token. Whitelist only the status pulseBootId; do not copy
                # arbitrary raw device JSON into a control decision.
                raw_status = status.pop("raw_payload", None)
                status["pulse_boot_id"] = (
                    raw_status.get("pulseBootId")
                    if isinstance(raw_status, dict) and isinstance(raw_status.get("pulseBootId"), str)
                    else None
                )
            relation = connection.execute("SELECT to_regclass('spff.adaptive_fert_events') AS relation").fetchone()["relation"]
            adaptive = None
            adaptive_access = "missing_relation"
            if relation:
                required_adaptive = {"site_id", "device_id", "message_id", "payload", "received_at", "stored_at"}
                allowed = connection.execute("SELECT has_table_privilege(current_user,'spff.adaptive_fert_events','SELECT') AS allowed").fetchone()["allowed"]
                adaptive_access = "available" if allowed else "select_permission_required"
                if allowed and not required_adaptive.issubset(columns.get("adaptive_fert_events", set())):
                    adaptive_access = "incompatible_schema"
                elif allowed:
                    adaptive = connection.execute(
                        "SELECT message_id,payload,received_at FROM spff.adaptive_fert_events "
                        "WHERE site_id=%s AND device_id=%s AND payload->>'kind'='adaptive_fert_telemetry' "
                        "AND received_at <= NOW() + INTERVAL '5 seconds' "
                        "ORDER BY received_at DESC,stored_at DESC LIMIT 1", args
                    ).fetchone()
            # Read-only, bounded history used ONLY to calculate a provisional
            # planning-time reference. This never changes the operational flow EMA.
            flow_rows = connection.execute(
                "SELECT recorded_at,flow_water_total_l,flow_fert_total_l,sensor_health "
                "FROM spff.telemetry_samples "
                "WHERE site_id=%s AND device_id=%s "
                "AND recorded_at >= NOW() - INTERVAL '7 days' "
                "AND recorded_at <= NOW() + INTERVAL '5 seconds' "
                "AND recorded_at <= received_at + INTERVAL '5 seconds' "
                "ORDER BY recorded_at DESC,telemetry_id DESC LIMIT 3000",
                args
            ).fetchall()
            flow_reference = observed_flow_reference(flow_rows)
            return {"schema_compatible": True, "telemetry": telemetry, "device_status": status,
                    "automatic_control": control, "approved_programs": programs, "recent_sessions": sessions,
                    "historical_flow_reference": flow_reference,
                    "guide_programs": read_guide_programs(connection, self.site_id, self.device_id, self.zone_id,
                                                         fertilizer_delivery_route=self.fertilizer_delivery_route),
                    "execution_evidence": {"status": adaptive_access, "latest_adaptive": adaptive},
                    "can_dispatch": False, "blocking_reason": "volume_session_and_safety_contract_not_verified"}

    def inspect_water_session_evidence(self, session_id):
        """Read one terminal water-only device session and matching completion event.

        Evidence is SELECT-only, scoped to this source's site/device. Counter
        deltas, unrelated sessions and pump ON status are never proof.
        """
        from uuid import UUID
        import psycopg
        from psycopg.rows import dict_row
        try:
            key = str(UUID(str(session_id)))
        except (TypeError, ValueError, AttributeError):
            raise ValueError("invalid water session UUID") from None
        with psycopg.connect(self.dsn, connect_timeout=5, row_factory=dict_row) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            connection.execute("SET LOCAL statement_timeout='5s'")
            for relation in ("spff.fertigation_sessions", "spff.fertigation_session_events"):
                ready = connection.execute(
                    "SELECT to_regclass(%s) IS NOT NULL AND has_table_privilege(current_user,%s,'SELECT') AS ready",
                    (relation, relation)
                ).fetchone()
                if not ready["ready"]:
                    raise ValueError("source evidence tables not readable")
            rows = connection.execute(
                """SELECT s.session_id::text AS session_id,s.site_id,s.device_id,
                         s.status,s.pumps_off,s.target_stock_l,s.actual_stock_l,
                         s.actual_water_l,s.started_at,s.finished_at,
                         e.message_id,e.sequence,e.recorded_at AS event_recorded_at,
                         e.received_at AS event_received_at,e.payload
                   FROM spff.fertigation_sessions s
                   JOIN spff.fertigation_session_events e
                     ON e.session_id=s.session_id AND e.site_id=s.site_id
                     AND e.device_id=s.device_id AND e.status='completed'
                     AND e.recorded_at=s.finished_at
                   WHERE s.site_id=%s AND s.device_id=%s AND s.session_id=%s::uuid
                   ORDER BY e.event_id DESC LIMIT 2""",
                (self.site_id, self.device_id, key)
            ).fetchall()
            if len(rows) != 1:
                raise ValueError("unique terminal session event proof not found")
            row = rows[0]
            payload = row.get("payload")
            if not isinstance(payload, dict):
                raise ValueError("terminal session event payload missing")
            if (row.get("status") != "completed" or row.get("pumps_off") is not True
                    or row.get("target_stock_l") != 0
                    or row.get("actual_stock_l") != 0
                    or row.get("actual_water_l") is None or row["actual_water_l"] <= 0
                    or payload.get("kind") != "fertigation_session_event"
                    or payload.get("status") != "completed"
                    or payload.get("pumpsOff") is not True
                    or payload.get("targetStockL") != 0
                    or payload.get("actualStockL") != 0
                    or payload.get("actualWaterL") != row.get("actual_water_l")
                    or payload.get("sessionId") != key
                    or payload.get("siteId") != self.site_id
                    or payload.get("deviceId") != self.device_id
                    or payload.get("messageId") != row.get("message_id")
                    or payload.get("sequence") != row.get("sequence")):
                raise ValueError("completed event did not confirm measured water-only session")
            # Whitelist narrow, non-secret fields. No arbitrary raw payload.
            return {
                "source": "SPFF_COMPLETED_SESSION_EVENT",
                "session_id": key, "site_id": self.site_id,
                "device_id": self.device_id, "status": "completed",
                "pumps_off": True, "target_stock_l": 0,
                "actual_stock_l": 0, "actual_water_l": float(row["actual_water_l"]),
                "started_at": row["started_at"],
                "finished_at": row["finished_at"],
                "event_recorded_at": row["event_recorded_at"],
                "event_received_at": row["event_received_at"],
                "message_id": row["message_id"], "sequence": row["sequence"],
            }

    def record_shadow(self, store):
        """HST schedule scan; no telemetry read or repeated decision snapshots.

        Bound hardware feedback still reconciles only explicitly linked sessions.
        Approval-time safety/evidence inspection is handled separately.
        """
        from .hst_workflow import HstWorkflow
        self.process_bound_feedback(store)
        return HstWorkflow(store, self.site_id, self.device_id, self.zone_id).scan(
            self.inspect_guides()
        )

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
