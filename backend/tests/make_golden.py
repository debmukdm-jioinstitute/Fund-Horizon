"""Regenerate golden persona summaries after an intentional change: python -m tests.make_golden"""
import json
from pathlib import Path

from app.data.loader import eligible_funds
from app.engine.pipeline import build_full_plan
from app.schemas import PlanRequest
from tests.test_personas import NAMES, summarise

raw = json.loads((Path(__file__).parent / "fixtures" / "personas.json").read_text())
df = eligible_funds()
for n in NAMES:
    out = summarise(build_full_plan(PlanRequest(**raw[n]), df))
    (Path(__file__).parent / "golden" / f"{n}.json").write_text(json.dumps(out, indent=2) + "\n")
    print(n, "written")
