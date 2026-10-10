import json
from pathlib import Path

import pytest

from app.data.loader import eligible_funds, load_metrics
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
