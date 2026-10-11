"""Question-answering and synthesis layer for fund knowledge base.

In Phase 4, synthesizes responses via deterministic templates + live analytics.
Phase 5 attaches the LiteLLM rephrasing layer on top.
"""
from __future__ import annotations

import math
from typing import Any

from app.config.disclosures import RAG_DISCLAIMER
from app.data.loader import load_metrics
from app.rag.store import search_schemes

AS_OF_DATE = "2026-10-09"


def fmt_pct(val: float | None) -> str:
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return "N/A"
    return f"{val * 100:.2f}%"


def fmt_num(val: float | None) -> str:
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return "N/A"
    return f"{val:.2f}"


def fallback_keyword_search(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Scan in-memory metrics CSV for keyword matches if Chroma collection is empty."""
    df = load_metrics()
    q = query.lower().strip()
    words = [w for w in q.split() if len(w) > 2 and w not in {"fund", "mutual", "scheme", "what", "show", "tell", "about", "top"}]

    if not words:
        words = [q]

    mask = df["scheme_name"].str.lower().str.contains(words[0], na=False, regex=False)
    for w in words[1:]:
        mask = mask | df["scheme_name"].str.lower().str.contains(w, na=False, regex=False)
        mask = mask | df["amc"].str.lower().str.contains(w, na=False, regex=False)
        mask = mask | df["category"].str.lower().str.contains(w, na=False, regex=False)

    matched = df[mask].copy()
    if matched.empty:
        # Fallback to top schemes by 3Y CAGR
        matched = df[df["data_quality"].isin(["ok", "split_adjusted"])].sort_values("cagr_3y", ascending=False)

    matched = matched.head(top_k)
    results = []
    for _, row in matched.iterrows():
        results.append({
            "scheme_code": str(row["scheme_code"]),
            "document": f"# {row['scheme_name']}\nAMC: {row['amc']} | Category: {row['category']}",
            "metadata": {
                "scheme_code": str(row["scheme_code"]),
                "scheme_name": str(row["scheme_name"]),
                "amc": str(row["amc"]),
                "category": str(row["category"]),
                "plan": str(row.get("plan", "Regular")),
                "data_quality": str(row.get("data_quality", "ok")),
            },
            "distance": 0.1,
        })
    return results


def answer_query(
    query: str,
    filters: dict[str, Any] | None = None,
    top_k: int = 4,
) -> dict[str, Any]:
    """Retrieve schemes and synthesize a structured, verifiable answer with cited sources."""
    # 1. Semantic search via ChromaDB
    hits = search_schemes(query, filters=filters, top_k=top_k)

    # Fallback if Chroma collection is unpopulated or returned nothing
    if not hits:
        hits = fallback_keyword_search(query, top_k=top_k)

    if not hits:
        return {
            "query": query,
            "answer": "No mutual fund schemes matched your query. Please search by scheme name, category, or AMC.",
            "sources": [],
            "as_of": AS_OF_DATE,
            "disclaimer": RAG_DISCLAIMER,
        }

    # 2. Enrich with metrics from all_schemes_metrics
    df = load_metrics()
    metrics_by_code = {str(r["scheme_code"]): r for _, r in df.iterrows()}

    sources = []
    schemes_data = []
    for hit in hits:
        code = str(hit.get("scheme_code"))
        meta = hit.get("metadata", {})
        m = metrics_by_code.get(code)

        name = meta.get("scheme_name") or (m["scheme_name"] if m is not None else f"Scheme {code}")
        amc = meta.get("amc") or (m["amc"] if m is not None else "Unknown AMC")
        cat = meta.get("category") or (m["category"] if m is not None else "Unclassified")
        plan = meta.get("plan") or (m["plan"] if m is not None else "Regular")

        source_item = {
            "scheme_code": code,
            "scheme_name": name,
            "amc": amc,
            "category": cat,
            "plan": plan,
            "data_quality": meta.get("data_quality", "ok"),
        }
        sources.append(source_item)

        if m is not None:
            schemes_data.append({
                "code": code,
                "name": name,
                "amc": amc,
                "category": cat,
                "plan": plan,
                "latest_nav": m.get("latest_nav"),
                "ret_1y": m.get("ret_1y"),
                "cagr_3y": m.get("cagr_3y"),
                "cagr_5y": m.get("cagr_5y"),
                "vol_3y": m.get("vol_3y"),
                "sharpe_3y": m.get("sharpe_3y"),
                "data_quality": m.get("data_quality", "ok"),
            })

    # 3. Format structured template answer
    lines = [
        f"### Performance Overview for Query: \"{query}\"",
        "",
        f"Found {len(schemes_data)} relevant scheme(s) based on your query and filters. All figures as of **{AS_OF_DATE}**:",
        "",
    ]

    for s in schemes_data:
        lines.append(f"#### {s['name']} (Scheme Code: {s['code']})")
        lines.append(f"- **AMC / Category:** {s['amc']} | {s['category']} ({s['plan']} Plan)")
        lines.append(f"- **Latest NAV:** ₹{s['latest_nav']}")
        lines.append(f"- **Trailing Returns:** 1-Year: {fmt_pct(s['ret_1y'])} | 3-Year CAGR: {fmt_pct(s['cagr_3y'])} | 5-Year CAGR: {fmt_pct(s['cagr_5y'])}")
        lines.append(f"- **Risk Profile (3Y):** Volatility: {fmt_pct(s['vol_3y'])} | Sharpe Ratio: {fmt_num(s['sharpe_3y'])}")
        if s["data_quality"] != "ok":
            lines.append(f"- **Data Quality Note:** Status is `{s['data_quality']}`.")
        lines.append("")

    lines.append(
        "> **Note on Historical Returns:** Trailing returns over 1 year are annualised compound growth (CAGR). "
        "Past performance is not an indicator of future results."
    )

    answer_text = "\n".join(lines)

    return {
        "query": query,
        "answer": answer_text,
        "sources": sources,
        "as_of": AS_OF_DATE,
        "disclaimer": RAG_DISCLAIMER,
    }
