FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY backend/alembic backend/alembic
COPY backend/alembic.ini backend/alembic.ini
COPY backend/scripts backend/scripts
COPY backend/chroma_db backend/chroma_db
COPY data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv
COPY data/fundhorizon_mf_rag_dataset/nav_monthly data/fundhorizon_mf_rag_dataset/nav_monthly
ENV FH_DATA_DIR=/srv/data/fundhorizon_mf_rag_dataset
ENV FH_ENABLE_DOCS=false
ENV FH_ALLOW_ASSUMPTION_OVERRIDES=false
ENV FH_PLAN_TTL_DAYS=30
ENV FH_RATE_LIMIT=true
WORKDIR /srv/backend
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then alembic upgrade head || echo WARNING: alembic migration failed; fi; uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
