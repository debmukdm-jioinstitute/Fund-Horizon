FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv
COPY data/fundhorizon_mf_rag_dataset/nav_monthly data/fundhorizon_mf_rag_dataset/nav_monthly
ENV FH_DATA_DIR=/srv/data/fundhorizon_mf_rag_dataset
WORKDIR /srv/backend
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
