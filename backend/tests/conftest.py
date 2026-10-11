import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.data.loader import eligible_funds, load_metrics
from app.main import create_app
from app.schemas import PlanRequest

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def metrics():
    return load_metrics()


@pytest.fixture(scope="session")
def eligible():
    return eligible_funds()


@pytest.fixture(scope="session")
def personas():
    raw = json.loads((FIX / "personas.json").read_text())
    return {k: PlanRequest(**v) for k, v in raw.items()}


@pytest.fixture
def client(tmp_path):
    os.environ["FH_DB_PATH"] = str(tmp_path / "test.db")
    with TestClient(create_app()) as c:
        yield c

