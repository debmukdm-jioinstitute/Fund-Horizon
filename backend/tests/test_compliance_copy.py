import ast
import re
from pathlib import Path

from app.config import disclosures as d

APP = Path(__file__).resolve().parents[1] / "app"
BANNED = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(d.BANNED_WORDS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
COPY_STRINGS = [
    *d.DISCLOSURE_LINES,
    d.SHORTLIST_HEADING,
    d.TAX_INFO,
    d.TAX_PER_GOAL_NOTE,
    d.SUCCESS_PROB_NOTE,
    d.SCHEME_DOCS_NOTE,
    d.CONSENT_TEXT,
    d.ALLOCATION_HEADING,
    d.ANALYTICS_DISCLAIMER,
    d.COMPARE_DISCLAIMER,
    d.RANKING_DISCLAIMER,
    d.PORTFOLIO_DISCLAIMER,
    *d.SIZED_STATUS_LABELS.values(),
]


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


def test_banned_list_catches_advice_tone():
    assert "suggested" in d.BANNED_WORDS and "recommend" in d.BANNED_WORDS
    assert BANNED.search("suggested allocation")
    assert BANNED.search("we recommend this fund")
    assert BANNED.search("Recommend you buy")
    assert not BANNED.search("not a recommendation")
    assert not BANNED.search("suggested_monthly_sip")


def test_no_banned_words_in_user_facing_strings():
    offenders = []
    for path in APP.rglob("*.py"):
        if path.name == "disclosures.py":
            continue
        for lit in literals(path):
            if BANNED.search(lit):
                offenders.append((path.name, lit[:80]))
    for s in COPY_STRINGS:
        assert not BANNED.search(s), s

    for q in (APP / "config" / "questionnaire.json").read_text().splitlines():
        assert not BANNED.search(q)
    assert not offenders, offenders


def test_required_disclosure_wording():
    joined = " ".join(d.DISCLOSURE_LINES)
    for needle in [
        "ARN 345439",
        "execution-only distributor",
        "not a SEBI-registered investment adviser",
        "Investments in Mutual Funds are subject to Market Risks. Read all scheme related documents carefully.",
        "Past performance may or may not be sustained.",
        "We deal in Regular Plans only and earn a trailing commission; disclosure of commission is made at "
        "the time of investment. Direct plans with lower expense ratios are available to investors.",
        "Illustrations use assumed returns and are not guarantees.",
        "SEBI riskometer",
        "Scheme Information Document (SID)",
        "Key Information Memorandum (KIM)",
    ]:
        assert needle in joined
    assert d.SHORTLIST_HEADING == (
        "Illustrative shortlist (ranked by past-performance composite; not a recommendation)"
    )
    assert d.ALLOCATION_HEADING == "Illustrative allocation"
    assert "pre-tax" in d.TAX_INFO.lower()
    assert "enough after tax" in d.TAX_INFO
    assert "pre-tax illustration" in d.TAX_PER_GOAL_NOTE.lower()
    assert "not the same as likely to succeed" in d.SUCCESS_PROB_NOTE
    assert "amfiindia.com" in d.SCHEME_DOCS_NOTE
    payload = d.all_disclosures()
    assert payload["tax_per_goal_note"] == d.TAX_PER_GOAL_NOTE
    assert payload["success_prob_note"] == d.SUCCESS_PROB_NOTE
    assert payload["scheme_docs_note"] == d.SCHEME_DOCS_NOTE
    assert payload["sized_status_labels"]["funded"] == "Sized at assumed return"


def test_new_copy_keeps_compliance_review_marker():
    src = Path(d.__file__).read_text()
    for name in (
        "TAX_PER_GOAL_NOTE",
        "SUCCESS_PROB_NOTE",
        "SCHEME_DOCS_NOTE",
        "SIZED_STATUS_LABELS",
        "ALLOCATION_HEADING",
        "TAX_INFO",
        "DISCLOSURE_LINES",
    ):
        block = src.split(f"{name} =", 1)[1].split("\n\n", 1)[0]
        assert "TODO(owner-compliance-review)" in block, name
