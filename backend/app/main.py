"""FastAPI app factory. Dataset is loaded once at startup into memory."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.data.loader import eligible_funds, load_metrics

load_dotenv()


def _readable(err: dict) -> str:
    loc = ".".join(str(p) for p in err["loc"] if p not in ("body",))
    msg = err["msg"].removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc else msg


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_metrics()
    app.state.eligible = eligible_funds()
    yield


def create_app() -> FastAPI:
    docs_enabled = os.environ.get("FH_ENABLE_DOCS", "true").lower() in ("true", "1", "yes")
    app = FastAPI(
        title="Fund Horizon Planner",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    origins = [o.strip() for o in os.environ.get("FH_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"]), "message": _readable(e)} for e in exc.errors()]
        return JSONResponse(
            status_code=422,
            content={"detail": "; ".join(e["message"] for e in errors), "errors": errors},
        )

    from app.api.admin import admin_router

    app.include_router(router)
    app.include_router(admin_router)
    return app



app = create_app()
