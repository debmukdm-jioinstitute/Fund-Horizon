from __future__ import annotations
"""Workers-safe FastAPI application factory for Cloudflare Python Workers."""

import os
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


def _readable(err: dict) -> str:
    loc = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body",))
    msg = str(err.get("msg", "")).removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc else msg


def create_worker_app() -> FastAPI:
    app = FastAPI(
        title="Fund Horizon API (Workers)",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    origins = [
        o.strip()
        for o in os.environ.get(
            "FH_CORS_ORIGINS",
            "https://fundhorizon.up.railway.app,https://fund-horizon-web.fundhorizon.workers.dev,http://localhost:3000",
        ).split(",")
        if o.strip()
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        is_head = request.method == "HEAD"
        if is_head:
            request.scope["method"] = "GET"
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if is_head:
            return Response(status_code=response.status_code, headers=dict(response.headers))
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e.get("loc", ())), "message": _readable(e)} for e in exc.errors()]
        return JSONResponse(
            status_code=422,
            content={"detail": "; ".join(e["message"] for e in errors), "errors": errors},
        )

    @app.get("/health")
    @app.get("/healthz")
    def health_check():
        return {
            "ok": True,
            "runtime": "workers",
            "d1": True,
            "r2": True,
        }

    @app.get("/api/meta")
    def meta():
        from app.config import load_allocation, load_assumptions, load_questionnaire
        return {
            "assumptions": load_assumptions(),
            "allocation": load_allocation(),
            "questionnaire": load_questionnaire(),
        }

    from app.api.admin import admin_router
    from app.api.auth import auth_router
    from app.api.crm_core import router as crm_core_router
    from app.api.crm_extras import router as crm_extras_router
    from app.api.crm_products import router as crm_products_router
    from app.api.learn import router as learn_router
    from app.api.portal import router as portal_router
    from app.api.rm import rm_router

    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(crm_core_router)
    app.include_router(crm_extras_router)
    app.include_router(crm_products_router)
    app.include_router(learn_router)
    app.include_router(portal_router)
    app.include_router(rm_router)

    return app


app = create_worker_app()
