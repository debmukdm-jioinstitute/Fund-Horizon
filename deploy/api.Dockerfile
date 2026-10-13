FROM python:3.12-slim AS base
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Lean production stage (Default): Zero paid AI, zero Chroma DB weight, fail-closed migrations
FROM base AS lean
WORKDIR /srv
COPY backend/app backend/app
COPY backend/alembic backend/alembic
COPY backend/alembic.ini backend/alembic.ini
COPY backend/scripts backend/scripts
COPY data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv
COPY data/fundhorizon_mf_rag_dataset/nav_monthly data/fundhorizon_mf_rag_dataset/nav_monthly

ENV FH_DATA_DIR=/srv/data/fundhorizon_mf_rag_dataset
ENV FH_INTERNAL_ONLY=true
ENV FH_ENABLE_DOCS=false
ENV FH_ALLOW_ASSUMPTION_OVERRIDES=false
ENV FH_PLAN_TTL_DAYS=30
ENV FH_RATE_LIMIT=true
ENV FH_AI_ENABLED=false
ENV FH_RAG_ENABLED=false
ENV FH_BACKOFFICE_COLLECTORS=true
ENV FH_REQUIRE_PRODUCTION_MIGRATIONS=true

WORKDIR /srv/backend
# Strictly fail startup if Alembic migrations fail:
CMD ["sh", "-c", "alembic upgrade head || { echo 'CRITICAL: Alembic migration failed. Halting startup.'; exit 1; }; uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
