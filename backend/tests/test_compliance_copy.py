import ast
import re
from pathlib import Path

from app.config import disclosures as d

APP = Path(__file__).resolve().parents[1] / "app"
BANNED = re.compile(r"\b(best|guaranteed|advice|advisory|recommend you buy)\b", re.IGNORECASE)


def literals(path: Path):
    tree = ast.parse(path.read_text())
    doc_ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant):
                doc_ids.add(id(node.body[0].value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in doc_ids:
            yield node.value


def test_no_banned_words_in_user_facing_strings():
    offenders = []
    for path in APP.rglob("*.py"):
        if path.name == "disclosures.py":
            continue
        for lit in literals(path):
            if BANNED.search(lit):
                offenders.append((path.name, lit[:60]))
    for s in [
        *d.DISCLOSURE_LINES,
        d.SHORTLIST_HEADING,
        d.TAX_INFO,
        d.CONSENT_TEXT,
        d.ALLOCATION_HEADING,
        d.ANALYTICS_DISCLAIMER,
        d.COMPARE_DISCLAIMER,
        d.RANKING_DISCLAIMER,
        d.PORTFOLIO_DISCLAIMER,
        d.CAS_PRIVACY_NOTICE,
        d.CAS_CONSENT_TEXT,
        d.CAS_DISCLAIMER,
        d.RAG_DISCLAIMER,
    ]:
        assert not BANNED.search(s), s

    for q in (APP / "config" / "questionnaire.json").read_text().splitlines():
        assert not BANNED.search(q)
    assert not offenders, offenders


def test_required_disclosure_wording():
    joined = " ".join(d.DISCLOSURE_LINES)
    for needle in [
        "ARN 345439",
        "Investments in Mutual Funds are subject to Market Risks. Read all scheme related documents carefully.",
        "Past performance may or may not be sustained.",
        "We deal in Regular Plans only and earn a trailing commission; disclosure of commission is made at "
        "the time of investment. Direct plans with lower expense ratios are available to investors.",
        "Illustrations use assumed returns and are not guarantees.",
    ]:
        assert needle in joined
    assert d.SHORTLIST_HEADING == (
        "Illustrative shortlist (ranked by past-performance composite; not a recommendation)"
    )
