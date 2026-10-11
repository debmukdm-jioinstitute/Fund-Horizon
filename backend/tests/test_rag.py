
from app.rag import answer_query, ingest_documents, search_schemes
from app.rag.store import parse_frontmatter


def test_rag_frontmatter_parser():
    content = """---
doc_type: mutual_fund_scheme
scheme_code: 128628
scheme_name: "HDFC Banking and PSU Debt Fund"
amc: "HDFC Mutual Fund"
category: "Debt Scheme - Banking and PSU Fund"
plan: Regular
option: Growth
---

# Scheme Heading
Body text here.
"""
    meta, body = parse_frontmatter(content)
    assert meta["scheme_code"] == "128628"
    assert meta["amc"] == "HDFC Mutual Fund"
    assert meta["plan"] == "Regular"
    assert "Body text here." in body


def test_rag_answer_query_templated():
    res = answer_query("Large Cap Funds", filters={"plan": "Regular"}, top_k=3)
    assert res["query"] == "Large Cap Funds"
    assert "2026-10-09" in res["as_of"]
    assert "ARN 345439" in res["disclaimer"]
    assert len(res["sources"]) > 0
    assert "Performance Overview" in res["answer"]
    for s in res["sources"]:
        assert "scheme_code" in s
        assert "scheme_name" in s


def test_rag_ingest_sample(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_CHROMA_DIR", str(tmp_path / "test_chroma"))

    # Create dummy markdown docs
    doc_dir = tmp_path / "sample_docs"
    doc_dir.mkdir()
    doc_text = """---
doc_type: mutual_fund_scheme
scheme_code: 999001
scheme_name: "Test Alpha Bluechip Fund - Regular Plan - Growth"
amc: "Test AMC"
category: "Equity Scheme - Large Cap Fund"
plan: Regular
option: Growth
latest_nav: 125.40
data_quality: ok
---

# Test Alpha Bluechip Fund
Returns and metrics details.
"""
    (doc_dir / "999001_test_fund.md").write_text(doc_text, encoding="utf-8")

    count = ingest_documents(doc_dir, limit=1)
    assert count == 1

    hits = search_schemes("Alpha Bluechip", top_k=1)
    assert len(hits) == 1
    assert hits[0]["scheme_code"] == "999001"
    assert hits[0]["metadata"]["amc"] == "Test AMC"


def test_rag_api_endpoints(client):
    # GET /api/rag/ask
    res = client.get("/api/rag/ask", params={"query": "HDFC", "top_k": 2})
    assert res.status_code == 200
    data = res.json()
    assert data["query"] == "HDFC"
    assert "answer" in data
    assert "sources" in data
    assert len(data["sources"]) > 0
    assert data["as_of"] == "2026-10-09"

    # POST /api/rag/ask
    post_res = client.post(
        "/api/rag/ask",
        json={"query": "SBI Small Cap", "category": "Equity Scheme - Small Cap Fund", "top_k": 2},
    )
    assert post_res.status_code == 200
    post_data = post_res.json()
    assert "answer" in post_data
    assert "sources" in post_data

    # POST /api/rag/ingest
    ingest_res = client.post("/api/rag/ingest", params={"limit": 2})
    assert ingest_res.status_code == 200
    ingest_data = ingest_res.json()
    assert "ingested" in ingest_data
