from __future__ import annotations
"""FastAPI app factory. Dataset is loaded once at startup into memory."""

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from threading import Lock

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.api.portal import router as portal_router
from app.api.routes import router
from app.data.loader import eligible_funds, load_metrics

load_dotenv()


def _flag(name: str, default: str) -> bool:
    return os.environ.get(name, default).lower() in ("true", "1", "yes")


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _readable(err: dict) -> str:
    loc = ".".join(str(p) for p in err["loc"] if p not in ("body",))
    msg = err["msg"].removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc else msg


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


class InProcessRateLimiter:
    """Sliding-window limiter. No extra process or paid service."""

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._last_prune = time.monotonic()

    def allow(self, bucket: str, key: str, *, max_requests: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[(bucket, key)]
            cutoff = now - window_s
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= max_requests:
                return False
            q.append(now)
            if now - self._last_prune > 60:
                stale = [k for k, hits in self._hits.items() if not hits or hits[-1] < now - 3600]
                for k in stale:
                    del self._hits[k]
                self._last_prune = now
            return True


def _plan_post(path: str) -> bool:
    return path.rstrip("/") == "/api/plans"


def _plan_get_recompute(path: str, request: Request) -> bool:
    if request.query_params.get("step_up") is None:
        return False
    parts = path.rstrip("/").split("/")
    return len(parts) == 4 and parts[1:3] == ["api", "plans"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app import backup

    try:
        await asyncio.to_thread(backup.restore_if_needed)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Restore from R2 on boot failed")
    if _flag("FH_REQUIRE_PRODUCTION_MIGRATIONS", "false"):
        from alembic.config import Config
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory

        from app.db import get_repository

        repo = get_repository()
        engine = getattr(repo, "engine", None)
        if engine:
            with engine.connect() as conn:
                context = MigrationContext.configure(conn)
                current_rev = context.get_current_revision()
                alembic_cfg = Config("alembic.ini")
                script = ScriptDirectory.from_config(alembic_cfg)
                head_rev = script.get_current_head()
                if current_rev != head_rev:
                    raise RuntimeError(f"Pending production migrations: current={current_rev}, head={head_rev}")

    load_metrics()
    app.state.eligible = eligible_funds()

    if _flag("FH_SEED_CRM", "false"):
        try:
            from app.crm_seed import seed_crm_if_empty

            await asyncio.to_thread(seed_crm_if_empty)
        except Exception:  # noqa: BLE001 - demo data is optional; never block start-up
            logging.getLogger(__name__).exception("CRM demo seed failed")

    try:
        from app.backoffice.mf_reference import ensure_loaded

        await asyncio.to_thread(ensure_loaded)
    except Exception:  # noqa: BLE001 - reference data is optional; never block start-up
        logging.getLogger(__name__).exception("MF reference load failed")

    from app import backup

    backup.warn_if_ephemeral()

    async def _daily_backup() -> None:
        while True:
            try:
                await asyncio.to_thread(backup.backup_sqlite)
            except Exception:  # noqa: BLE001 - a failed backup must never take the API down
                logging.getLogger(__name__).exception("DB backup failed")
            await asyncio.sleep(6 * 3600)  # one file per day; checking every 6h also covers restarts

    backup_task = asyncio.create_task(_daily_backup())

    collector_task = None
    if _flag("FH_BACKOFFICE_COLLECTORS", "true"):
        from app.backoffice.collectors import run_collector_loop

        collector_task = asyncio.create_task(run_collector_loop())

        # Daily briefing: build/refresh on startup so updated filtering applies
        # (idempotent upsert; the scheduled loop keeps it fresh afterwards).
        from app.backoffice.collectors import build_daily_briefing

        try:
            await asyncio.to_thread(build_daily_briefing)
        except Exception:
            logging.getLogger(__name__).exception("Startup briefing build failed")

    try:
        yield
    finally:
        backup_task.cancel()
        try:
            await asyncio.to_thread(backup.backup_sqlite)
        except Exception:  # noqa: BLE001
            logging.getLogger(__name__).exception("Shutdown DB backup failed")
        if collector_task:
            collector_task.cancel()
            try:
                await collector_task
            except (asyncio.CancelledError, Exception):
                pass


def create_app() -> FastAPI:
    docs_enabled = _flag("FH_ENABLE_DOCS", "false")
    app = FastAPI(
        title="Fund Horizon Planner",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    origins = [o.strip() for o in os.environ.get("FH_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    limiter = InProcessRateLimiter()
    app.state.rate_limiter = limiter

    @app.middleware("http")
    async def hardening_middleware(request: Request, call_next):
        is_head = request.method == "HEAD"
        if is_head:
            request.scope["method"] = "GET"

        if _flag("FH_RATE_LIMIT", "true"):
            path = request.url.path
            window = max(_int_env("FH_RATE_WINDOW_SECONDS", 60), 1)
            bucket = None
            cap = 0
            if request.method == "POST" and _plan_post(path):
                bucket, cap = "plan_post", max(_int_env("FH_PLAN_POST_RATE", 10), 1)
            elif request.method == "GET" and _plan_get_recompute(path, request):
                bucket, cap = "plan_get", max(_int_env("FH_PLAN_GET_RATE", 20), 1)
            if bucket and not limiter.allow(bucket, _client_ip(request), max_requests=cap, window_s=window):
                limited = JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please try again shortly."},
                    headers={"Retry-After": str(window)},
                )
                if is_head:
                    return Response(status_code=429, headers=dict(limited.headers))
                return limited

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if is_head:
            return Response(status_code=response.status_code, headers=dict(response.headers))
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"]), "message": _readable(e)} for e in exc.errors()]
        return JSONResponse(
            status_code=422,
            content={"detail": "; ".join(e["message"] for e in errors), "errors": errors},
        )

    from app.api.admin import admin_router
    from app.api.auth import auth_router
    from app.api.backoffice import router as backoffice_router
    from app.api.crm_core import router as crm_core_router
    from app.api.crm_extras import router as crm_extras_router
    from app.api.crm_phase3 import router as crm_phase3_router
    from app.api.crm_products import router as crm_products_router
    from app.api.crm_reports import router as crm_reports_router
    from app.api.customer_portal import router as customer_portal_router
    from app.api.learn import router as learn_router
    from app.api.rm import rm_router
    from app.backoffice.mf_reference import router as mf_reference_router

    app.include_router(router)
    app.include_router(portal_router)
    app.include_router(admin_router)
    app.include_router(auth_router)
    app.include_router(rm_router)
    app.include_router(crm_core_router)
    app.include_router(crm_extras_router)
    app.include_router(crm_phase3_router)
    app.include_router(crm_reports_router)
    app.include_router(learn_router)
    app.include_router(customer_portal_router)
    app.include_router(crm_products_router)
    app.include_router(backoffice_router)
    app.include_router(mf_reference_router)

    @app.get("/health")
    def health_check():
        import shutil

        from app.db.sqlite import get_default_db_path
        from app.storage import r2

        db_path = get_default_db_path()
        db_bytes = db_path.stat().st_size if db_path.exists() else 0
        data_dir = "/data" if os.path.exists("/data") else str(db_path.parent)
        try:
            data_free_mb = shutil.disk_usage(data_dir).free // (2**20)
        except Exception:
            data_free_mb = 0

        is_workers = bool(os.environ.get("CF_WORKER") == "1" or os.environ.get("WORKERS_RUNTIME"))
        return {
            "ok": True,
            "runtime": "workers" if is_workers else "standard",
            "r2": r2.enabled(),
            "db_bytes": db_bytes,
            "data_free_mb": data_free_mb,
        }

    return app



app = create_app()
