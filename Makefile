.PHONY: setup dev test lint

PY := backend/.venv/bin/python

setup:
	cd backend && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -e ".[dev]"
	cd frontend && npm install && npx playwright install chromium

dev:
	@echo "API  : http://localhost:8000   Web: http://localhost:3000"
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000 & \
	cd frontend && npm run dev -- --port 3000; wait

test:
	cd backend && .venv/bin/python -m pytest tests --cov=app/engine --cov-fail-under=85 -q
	cd frontend && npx playwright test

lint:
	cd backend && .venv/bin/ruff check app tests
	cd frontend && npm run lint && npx tsc --noEmit && node scripts/check-copy.mjs && node scripts/check-fonts.mjs
