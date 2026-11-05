import asyncio
import hmac
import json
import logging
import math
import os
from typing import Literal
from uuid import UUID
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import Field

from .engine import Engine
from .models import Config, Model, Program, Snapshot
from .scenarios import SCENARIOS, run_scenario
from .settings import ROOT, Settings, load_config
from .source import SPFFSource
from .dashboard_summary import present_shadow_dashboard
from .store import PostgresStore, SQLiteStore
from .hst_workflow import HstWorkflow, HstWorkflowConflict
from .live_engine import LiveProfile

log = logging.getLogger("spff_ai")


class Evaluation(Model):
    snapshot: Snapshot
    programs: list[Program] = Field(default_factory=list, max_length=100)


class HstApproval(Model):
    obligation_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    approval_id: UUID
    actor: str = Field(min_length=1, max_length=128)
    expected_remaining_g: float = Field(gt=0, allow_inf_nan=False)
    confirmation: Literal["REVIEW_HST_SHADOW_SESSION"]


def create_app(settings=None, config=None, store=None):
    settings = settings or Settings.load()
    config = config or load_config()
    # Config changes must not create a new obligation ledger or reset outstanding doses.
    scope = f"{settings.site_id}/{settings.device_id}/{settings.zone_id}/source-shadow"
    owns_store = store is None
    if store is None:
        store = PostgresStore(settings.state_dsn, scope) if settings.state_dsn else SQLiteStore(str(ROOT / settings.state_path), scope)
    # Keep the 56+ MB immutable legacy-development history in its existing scope.
    # HST is an independent, tiny PostgreSQL row (same database/table), so
    # scheduled scans and authenticated approvals never deserialize the legacy
    # decisions blob. An explicitly supplied test store remains unchanged.
    hst_store = (PostgresStore(settings.state_dsn, scope + "/hst-v1")
                 if owns_store and settings.state_dsn else store)
    engine = Engine(store, config, mode=settings.mode)
    source = SPFFSource(settings.source_dsn, settings.site_id, settings.device_id, settings.zone_id,
                        fertilizer_delivery_route=settings.fertilizer_delivery_route) if settings.source_dsn else None
    poll_status = {"enabled": settings.poll_enabled, "last_success": None, "last_error": None,
                   "scan_interval_seconds": max(300, settings.poll_seconds)}

    async def poll():
        from datetime import datetime, timezone
        while True:
            try:
                await asyncio.to_thread(source.record_shadow, hst_store)
                poll_status.update(last_success=datetime.now(timezone.utc).isoformat(), last_error=None)
            except Exception as error:
                # Exception text can include credentials supplied by drivers; log only type.
                poll_status["last_error"] = type(error).__name__
                log.error("shadow_poll_failed", extra={"error_type": type(error).__name__})
            await asyncio.sleep(poll_status["scan_interval_seconds"])

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(poll()) if settings.poll_enabled else None
        yield
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if owns_store:
            store.close()
            if hst_store is not store:
                hst_store.close()

    app = FastAPI(title="SPFF Adaptive AI — standalone", version="1.0.0", lifespan=lifespan)

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def index():
        return (ROOT / "app" / "index.html").read_text(encoding="utf-8")

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "spff-ai-engine", "mode": settings.mode,
                "can_dispatch": False, "timezone": config.timezone}

    @app.get("/ready")
    def ready():
        try:
            hst_store.read()
        except Exception:
            raise HTTPException(503, "state storage unavailable")
        if poll_status["enabled"] and (poll_status["last_error"] or not poll_status["last_success"]):
            raise HTTPException(503, "source shadow poll not ready")
        return {"status": "ready", "profile": "local-simulator" if not source else "source-shadow-hold",
                "hardware_ready": False}

    @app.get("/status")
    def status():
        state = hst_store.read()
        return {"mode": settings.mode, "port": settings.port, "can_dispatch": False,
                "fertilizer_delivery_route": settings.fertilizer_delivery_route,
                "source_configured": source is not None, "state_backend": "postgresql" if settings.state_dsn else "sqlite-local",
                "polling": poll_status,
                "decision_count": len(state.get("hst_workflow", {}).get("proposals", {})),
                "legacy_development_decision_count": (
                    len(state.get("decisions", {})) if hst_store is store else None),
                "legacy_history_scope": "separate_retained_legacy_scope" if hst_store is not store else "same_scope",
                "decision_trigger": "HST_SCHEDULE_ONLY",
                "blocking_reason": "existing firmware volume-session contract is unverified"}

    @app.get("/config")
    def get_config():
        return config.model_dump(mode="json")

    @app.get("/decisions")
    def decisions(limit: int = Query(default=30, ge=1, le=200)):
        # PostgreSQL JSONB objects do not preserve insertion order. Sort by
        # explicit UTC timestamps instead of relying on dict ordering.
        def order_key(decision):
            try:
                observed = datetime.fromisoformat(str(decision.get("at", "")).replace("Z", "+00:00"))
                if observed.tzinfo is None:
                    observed = datetime.min.replace(tzinfo=timezone.utc)
                else:
                    observed = observed.astimezone(timezone.utc)
            except (ValueError, TypeError, OverflowError):
                observed = datetime.min.replace(tzinfo=timezone.utc)
            return (observed, str(decision.get("decision_id") or ""))

        return sorted(store.read()["decisions"].values(), key=order_key, reverse=True)[:limit]

    @app.get("/dashboard/summary")
    def dashboard_summary():
        # Read stored REAL source-shadow decisions; do not trigger evaluation,
        # synthesize input, or return arbitrary raw source / credential payloads.
        if not source:
            raise HTTPException(503, "real SPFF source is not configured")
        try:
            state = store.read_summary() if hasattr(store, "read_summary") else store.read()
            # The 4k legacy source-shadow decisions are development history,
            # NOT active HST proposals. Current duties are exposed by /hst/proposals.
            # Preserve legacy /decisions readback for explicit history inspection.
            saved = {}
            # GET performs a read-only source inspection. It must not create
            # SHADOW decisions, credit doses, or write operational databases.
            planning_observation = source.inspect()
            # Profiles stay in the original small runtime_profiles table/scope.
            # Reading them never loads the legacy engine_state JSON blob.
            raw_profile = store.runtime_profile() if hasattr(store, "runtime_profile") else None
            profile = LiveProfile.model_validate(raw_profile) if raw_profile else None
            return present_shadow_dashboard(
                saved.values(), simulation_config=config,
                operational_profile=profile,
                tank_inventory_approval=(os.getenv("AI_TANK_POLICY_APPROVAL", "")
                    if os.getenv("AI_IRRIGATION_TARGET_POLICY") == "AVAILABLE_TANK" else None),
                inventory_scope=(settings.site_id, settings.device_id, settings.zone_id),
                planning_observation=planning_observation,
                stock_bindings=state.get('guide_stock_bindings', {}),
                tank_capacity_l=settings.tank_capacity_l,
                tank_height_cm=settings.tank_height_cm,
                fert_tank_capacity_l=settings.fert_tank_capacity_l,
                fert_tank_height_cm=settings.fert_tank_height_cm,
                water_carryover_state=state,
            )
        except Exception:
            log.warning("shadow_dashboard_read_failed")
            raise HTTPException(503, "shadow dashboard unavailable")

    @app.get("/hst/proposals")
    def hst_proposals():
        return HstWorkflow(hst_store, settings.site_id, settings.device_id, settings.zone_id).proposals()

    @app.post("/hst/approvals")
    def hst_approval(body: HstApproval, x_spff_bridge_key: str | None = Header(default=None)):
        # Only the authenticated Node API may relay operator identity. The
        # standalone AI endpoint is disabled unless an explicit shared secret
        # is configured on both services; localhost alone is not authentication.
        if (not settings.hst_bridge_key or not x_spff_bridge_key
                or not hmac.compare_digest(x_spff_bridge_key, settings.hst_bridge_key)):
            raise HTTPException(403, "authenticated operator bridge required")
        if not source or settings.mode != "SHADOW_MODE":
            raise HTTPException(409, "HST operator review requires source-shadow mode")
        try:
            # Idempotent replay must still work if the source goes offline
            # after the initial recorded review. Never reuse the UUID for
            # another actor/obligation/remaining-mass amount.
            existing = hst_store.read().get("hst_workflow", {}).get("approvals", {}).get(str(body.approval_id))
            if existing:
                if (existing["obligation_id"] != body.obligation_id
                        or existing["operator_id"] != body.actor
                        or not math.isclose(existing["expected_remaining_g"],
                                            body.expected_remaining_g, rel_tol=0, abs_tol=0.01)):
                    raise HstWorkflowConflict("approval_id_conflicts_with_existing_review")
                return existing
            # The sensor/tank/Soil 2 read occurs ONLY after explicit ACC.
            observation = json.loads(json.dumps(source.inspect(), default=str, allow_nan=False))
            raw_profile = store.runtime_profile() if hasattr(store, "runtime_profile") else None
            profile = LiveProfile.model_validate(raw_profile) if raw_profile else None
            return HstWorkflow(hst_store, settings.site_id, settings.device_id, settings.zone_id).review_approval(
                obligation_id=body.obligation_id,
                approval_id=body.approval_id,
                actor=body.actor,
                expected_remaining_g=body.expected_remaining_g,
                observation=observation, profile=profile,
            )
        except HstWorkflowConflict as error:
            raise HTTPException(409, str(error)) from error
        except Exception as error:
            log.error("hst_approval_preflight_failed", extra={"error_type": type(error).__name__})
            raise HTTPException(503, "HST sensor review unavailable") from error

    @app.get("/obligations")
    def obligations():
        return list(hst_store.read().get("hst_workflow", {}).get("obligations", {}).values())

    @app.get("/live/state")
    def live_state():
        state = hst_store.read().get("hst_workflow", {})
        return {"mode": settings.mode, "can_dispatch": False, "obligations": state.get("obligations", {}),
                "sessions": {}, "ema": {},
                "decision_count": len(state.get("proposals", {})),
                "legacy_development_state_ignored": True,
                "ec_target_required_for_scheduling": False}

    @app.get("/simulations")
    def scenarios():
        return SCENARIOS

    @app.post("/simulations/evaluate")
    def evaluate(body: Evaluation):
        # Arbitrary client inputs are isolated and are NEVER persisted as real shadow telemetry.
        scratch = SQLiteStore()
        try:
            return Engine(scratch, config, mode="DRY_RUN").evaluate(body.snapshot, body.programs)
        finally:
            scratch.close()

    @app.post("/simulations/{name}")
    def scenario(name: str):
        if name not in SCENARIOS:
            raise HTTPException(404, "unknown scenario")
        return run_scenario(name, config)

    @app.get("/source/audit")
    def source_audit():
        if not source:
            raise HTTPException(503, "set AI_SOURCE_DSN in this project's .env first")
        try:
            return source.inspect()
        except Exception as error:
            log.warning("source_read_failed", extra={"error_type": type(error).__name__})
            raise HTTPException(503, "SPFF source unavailable or schema incompatible")

    @app.get("/source/guide-programs")
    def source_guide_programs():
        if not source:
            raise HTTPException(503, "SPFF source is not configured")
        try:
            return source.inspect_guides()
        except Exception as error:
            log.warning("guide_source_read_failed", extra={"error_type": type(error).__name__})
            raise HTTPException(503, "SPFF guide source unavailable or schema incompatible")

    @app.post("/source/evaluate")
    def source_evaluate():
        if not source:
            raise HTTPException(503, "SPFF source is not configured")
        if settings.mode == "DRY_RUN":
            raise HTTPException(409, "DRY_RUN does not persist source decisions; use /source/audit")
        try:
            return source.record_shadow(hst_store)
        except Exception:
            raise HTTPException(503, "source evaluation unavailable")

    return app
