import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import Field

from .engine import Engine
from .models import Config, Model, Program, Snapshot
from .scenarios import SCENARIOS, run_scenario
from .settings import ROOT, Settings, load_config
from .source import SPFFSource
from .store import PostgresStore, SQLiteStore

log = logging.getLogger("spff_ai")


class Evaluation(Model):
    snapshot: Snapshot
    programs: list[Program] = Field(default_factory=list, max_length=100)


def create_app(settings=None, config=None, store=None):
    settings = settings or Settings.load()
    config = config or load_config()
    # Config changes must not create a new obligation ledger or reset outstanding doses.
    scope = f"{settings.site_id}/{settings.device_id}/{settings.zone_id}/source-shadow"
    owns_store = store is None
    if store is None:
        store = PostgresStore(settings.state_dsn, scope) if settings.state_dsn else SQLiteStore(str(ROOT / settings.state_path), scope)
    engine = Engine(store, config, mode=settings.mode)
    source = SPFFSource(settings.source_dsn, settings.site_id, settings.device_id, settings.zone_id) if settings.source_dsn else None
    poll_status = {"enabled": settings.poll_enabled, "last_success": None, "last_error": None}

    async def poll():
        from datetime import datetime, timezone
        while True:
            try:
                await asyncio.to_thread(source.record_shadow, store)
                poll_status.update(last_success=datetime.now(timezone.utc).isoformat(), last_error=None)
            except Exception as error:
                # Exception text can include credentials supplied by drivers; log only type.
                poll_status["last_error"] = type(error).__name__
                log.error("shadow_poll_failed", extra={"error_type": type(error).__name__})
            await asyncio.sleep(settings.poll_seconds)

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
            store.read()
        except Exception:
            raise HTTPException(503, "state storage unavailable")
        if poll_status["enabled"] and (poll_status["last_error"] or not poll_status["last_success"]):
            raise HTTPException(503, "source shadow poll not ready")
        return {"status": "ready", "profile": "local-simulator" if not source else "source-shadow-hold",
                "hardware_ready": False}

    @app.get("/status")
    def status():
        state = store.read()
        return {"mode": settings.mode, "port": settings.port, "can_dispatch": False,
                "source_configured": source is not None, "state_backend": "postgresql" if settings.state_dsn else "sqlite-local",
                "polling": poll_status, "decision_count": len(state["decisions"]),
                "blocking_reason": "existing firmware volume-session contract is unverified"}

    @app.get("/config")
    def get_config():
        return config.model_dump(mode="json")

    @app.get("/decisions")
    def decisions(limit: int = Query(default=30, ge=1, le=200)):
        return list(store.read()["decisions"].values())[-limit:][::-1]

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

    @app.post("/source/evaluate")
    def source_evaluate():
        if not source:
            raise HTTPException(503, "SPFF source is not configured")
        if settings.mode == "DRY_RUN":
            raise HTTPException(409, "DRY_RUN does not persist source decisions; use /source/audit")
        try:
            return source.record_shadow(store)
        except Exception:
            raise HTTPException(503, "source evaluation unavailable")

    return app
