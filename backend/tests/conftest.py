import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.data.loader import eligible_funds, load_metrics
from app.main import create_app
from app.schemas import PlanRequest

# The suite must never write into the committed ChromaDB or the repo's data: point the RAG store at a
# throwaway copy before any app module opens it.
_SRC_CHROMA = Path(__file__).resolve().parents[1] / "chroma_db"
if "FH_CHROMA_DIR" not in os.environ:
    _tmp = Path(tempfile.mkdtemp(prefix="fh-chroma-test-"))
    if _SRC_CHROMA.exists():
        shutil.copytree(_SRC_CHROMA, _tmp, dirs_exist_ok=True)
    os.environ["FH_CHROMA_DIR"] = str(_tmp)

# Tests must not poll live market feeds in the background (slow, flaky, and it blocks app shutdown).
os.environ.setdefault("FH_BACKOFFICE_COLLECTORS", "false")

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
    old_db_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = ""
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        if old_db_url is not None:
            os.environ["DATABASE_URL"] = old_db_url
        else:
            os.environ.pop("DATABASE_URL", None)

