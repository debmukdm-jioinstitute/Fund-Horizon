#!/usr/bin/env python3
"""Generate RAG markdown and JSON documents from existing dataset CSVs.

Purely local; ZERO network calls.
Generates:
  - schemes_md/ (one markdown file per scheme with YAML frontmatter & data quality banner)
  - schemes_json/ (structured JSON per scheme)
  - categories/ (category summary with 3Y CAGR ranking)
  - amcs/ (AMC summaries)
  - ingest_example.py (starter ChromaDB + bge-small example)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
from pathlib import Path

import pandas as pd


def pct(x, d=2):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x*100:.{d}f}%"


def num(x, d=2):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{d}f}"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:90]


def nav_at(s: pd.Series, dt: pd.Timestamp):
    sub = s.loc[:dt]
    return sub.iloc[-1] if len(sub) else None


def compute_calendar_returns(nav_file: Path, n: int = 10) -> dict[int, float]:
    if not nav_file.exists():
        return {}
    try:
        df = pd.read_csv(nav_file)
        if df.empty or "date" not in df.columns or "nav" not in df.columns:
            return {}
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
        df = df.dropna().sort_values("date").drop_duplicates("date")
        if df.empty:
            return {}
        s = df.set_index("date")["nav"]
        out = {}
        last_year = s.index[-1].year
        for y in range(last_year, last_year - n, -1):
            a, b = pd.Timestamp(y - 1, 12, 31), pd.Timestamp(y, 12, 31)
            if a < s.index[0]:
                continue
            v0 = nav_at(s, a)
            v1 = s.iloc[-1] if y == last_year else nav_at(s, b)
            if v0 and not math.isnan(v0) and not math.isnan(v1) and v0 > 0:
                out[y] = v1 / v0 - 1
        return out
    except Exception:
        return {}


def build_scheme_md(r: dict, cal: dict[int, float], asof: str) -> str:
    dq = r.get("data_quality", "ok")
    notes = {
        "ok": "",
        "split_adjusted": f"> DATA NOTE: NAV history had split/consolidation-type jumps ({r.get('nav_adjustments', '')}); earlier NAVs were rescaled so returns are continuous.\n\n",
        "nav_shock": f"> DATA WARNING: unexplained single-day NAV jump(s) in history ({r.get('nav_shocks', '')}). These may be genuine credit events or data errors; verify before quoting returns.\n\n",
        "segregated_portfolio": "> DATA NOTE: segregated portfolio (side pocket) units; not comparable with normal schemes. Excluded from rankings.\n\n",
        "flat_nav": "> DATA NOTE: NAV is (almost) constant over the last 3 years, so risk ratios are not meaningful. Excluded from rankings.\n\n",
        "inactive_or_stale": f"> DATA NOTE: no NAV since {r.get('last_nav_date', '')}; scheme appears inactive/wound up. Return and risk metrics are not computed and the scheme is excluded from rankings.\n\n",
    }
    banner = notes.get(dq, "")
    if r.get("extreme_return_flag") and not dq == "inactive_or_stale":
        banner += "> REVIEW FLAG: 1-year return is above +100% or below -100%-equivalent extremes; verify against the AMC factsheet before quoting.\n\n"

    cal_tbl = "\n".join(f"| {y} | {pct(v)} |" for y, v in sorted(cal.items(), reverse=True)) or "| n/a | n/a |"

    isin = r.get("isin_growth_or_payout") or "n/a"

    return f"""---
doc_type: mutual_fund_scheme
scheme_code: {r['scheme_code']}
scheme_name: "{r['scheme_name']}"
amc: "{r['amc']}"
category: "{r['category']}"
plan: {r['plan']}
option: {r['option']}
isin_growth: {isin}
latest_nav: {r.get('latest_nav', 'n/a')}
latest_nav_date: {r.get('last_nav_date', 'n/a')}
data_asof: {asof}
data_quality: {dq}
---

# {r['scheme_name']}

{banner}**AMC:** {r['amc']} | **Category:** {r['category']} | **Plan/Option:** {r['plan']} {r['option']} | **Scheme code:** {r['scheme_code']}
**Latest NAV:** {r.get('latest_nav', 'n/a')} on {r.get('last_nav_date', 'n/a')} | **Launch/first NAV date in data:** {r.get('first_nav_date', 'n/a')} ({r.get('history_years', 'n/a')} years of history)

## Returns (computed from NAV; periods over 1 year are annualised CAGR)

| Period | Return |
|---|---|
| 1 month | {pct(r.get('ret_1m'))} |
| 3 months | {pct(r.get('ret_3m'))} |
| 6 months | {pct(r.get('ret_6m'))} |
| 1 year | {pct(r.get('ret_1y'))} |
| 3 years CAGR | {pct(r.get('cagr_3y'))} |
| 5 years CAGR | {pct(r.get('cagr_5y'))} |
| 7 years CAGR | {pct(r.get('cagr_7y'))} |
| 10 years CAGR | {pct(r.get('cagr_10y'))} |
| Since inception CAGR | {pct(r.get('cagr_since_inception'))} |

## Risk (3-year window, risk-free rate assumed 6.5%)

- Annualised volatility: {pct(r.get('vol_3y'))}
- Sharpe ratio: {num(r.get('sharpe_3y'))} | Sortino ratio: {num(r.get('sortino_3y'))}
- Max drawdown (3Y): {pct(r.get('max_drawdown_3y'))} | Max drawdown (full history): {pct(r.get('max_drawdown_all'))}

## Rolling returns (monthly sampling, CAGR)

| Window | Min | Median | Max | % of periods positive |
|---|---|---|---|---|
| 1 year | {pct(r.get('roll1y_min'))} | {pct(r.get('roll1y_median'))} | {pct(r.get('roll1y_max'))} | {pct(r.get('roll1y_pct_positive'), 0)} |
| 3 years | {pct(r.get('roll3y_min'))} | {pct(r.get('roll3y_median'))} | {pct(r.get('roll3y_max'))} | {pct(r.get('roll3y_pct_positive'), 0)} |
| 5 years | {pct(r.get('roll5y_min'))} | {pct(r.get('roll5y_median'))} | {pct(r.get('roll5y_max'))} | {pct(r.get('roll5y_pct_positive'), 0)} |

## Calendar-year returns

| Year | Return |
|---|---|
{cal_tbl}

> Source: AMFI NAV master + mfapi.in NAV history; metrics computed by script. Past performance may or may not be sustained. Not investment advice.
"""


def generate_all(dataset_dir: Path, limit: int = 0):
    metrics_path = dataset_dir / "all_schemes_metrics.csv"
    nav_dir = dataset_dir / "nav_monthly"

    if not metrics_path.exists():
        raise FileNotFoundError(f"Missing {metrics_path}")

    for sub in ("schemes_md", "schemes_json", "categories", "amcs"):
        (dataset_dir / sub).mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(metrics_path)
    print(f"Loaded {len(df)} schemes from {metrics_path}")

    asof = "2026-10-09"
    if "last_nav_date" in df.columns:
        dates = pd.to_datetime(df["last_nav_date"], errors="coerce")
        if not dates.isna().all():
            asof = dates.max().strftime("%Y-%m-%d")

    records = df.to_dict("records")
    if limit > 0:
        records = records[:limit]

    print(f"Generating documents for {len(records)} schemes...")
    for idx, r in enumerate(records, 1):
        code = str(r["scheme_code"])
        base = f"{code}_{slug(str(r.get('scheme_name', '')))}"
        cal = compute_calendar_returns(nav_dir / f"{code}.csv")

        # Markdown
        md_text = build_scheme_md(r, cal, asof)
        (dataset_dir / "schemes_md" / f"{base}.md").write_text(md_text, encoding="utf-8")

        # JSON
        clean_metrics = {}
        for k, v in r.items():
            if isinstance(v, float) and math.isnan(v):
                clean_metrics[k] = None
            else:
                clean_metrics[k] = v
        js = {
            **clean_metrics,
            "calendar_returns": cal,
        }
        (dataset_dir / "schemes_json" / f"{base}.json").write_text(
            json.dumps(js, indent=2, default=str), encoding="utf-8"
        )

        if idx % 500 == 0 or idx == len(records):
            print(f"Processed {idx}/{len(records)} schemes...")

    # Category summaries
    okdf = df[df["data_quality"].isin(["ok", "split_adjusted"])].copy()
    print("Generating category summaries...")
    for cat_name, g in okdf.groupby("category"):
        g_sorted = g.sort_values("cagr_3y", ascending=False)
        lines = [
            f"# Category: {cat_name}",
            f"Schemes (Regular, Growth): {len(g_sorted)}  |  data as of {asof}",
            "",
            f"Median 1Y: {pct(g_sorted['ret_1y'].median())} | 3Y CAGR: {pct(g_sorted['cagr_3y'].median())} | 5Y CAGR: {pct(g_sorted['cagr_5y'].median())} | 10Y CAGR: {pct(g_sorted['cagr_10y'].median())}",
            f"Median 3Y volatility: {pct(g_sorted['vol_3y'].median())} | median Sharpe: {num(g_sorted['sharpe_3y'].median())}",
            "",
            "## Ranked by 3-year CAGR",
            "",
            "| Rank | Code | Scheme | AMC | 1Y | 3Y | 5Y | 10Y | Vol 3Y | Sharpe 3Y | Max DD 3Y |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for k, (_, row) in enumerate(g_sorted.iterrows(), 1):
            lines.append(
                f"| {k} | {row['scheme_code']} | {row['scheme_name']} | {row['amc']} | {pct(row.get('ret_1y'))} | {pct(row.get('cagr_3y'))} | {pct(row.get('cagr_5y'))} | {pct(row.get('cagr_10y'))} | {pct(row.get('vol_3y'))} | {num(row.get('sharpe_3y'))} | {pct(row.get('max_drawdown_3y'))} |"
            )
        (dataset_dir / "categories" / f"{slug(str(cat_name))}.md").write_text("\n".join(lines), encoding="utf-8")

    # AMC summaries
    print("Generating AMC summaries...")
    for amc_name, g in okdf.groupby("amc"):
        g_sorted = g.sort_values("cagr_3y", ascending=False)
        lines = [
            f"# AMC: {amc_name}",
            f"Schemes (Regular, Growth): {len(g_sorted)}  |  data as of {asof}",
            "",
            "| Code | Scheme | Category | 1Y | 3Y | 5Y | 10Y |",
            "|---|---|---|---|---|---|---|",
        ]
        for _, row in g_sorted.iterrows():
            lines.append(
                f"| {row['scheme_code']} | {row['scheme_name']} | {row['category']} | {pct(row.get('ret_1y'))} | {pct(row.get('cagr_3y'))} | {pct(row.get('cagr_5y'))} | {pct(row.get('cagr_10y'))} |"
            )
        (dataset_dir / "amcs" / f"{slug(str(amc_name))}.md").write_text("\n".join(lines), encoding="utf-8")

    # Write ingest_example.py into dataset_dir
    ingest_py = dataset_dir / "ingest_example.py"
    ingest_py.write_text(
        '''"""ChromaDB ingestion and query example using fastembed (BAAI/bge-small-en-v1.5)."""
from pathlib import Path
import chromadb
from fastembed import TextEmbedding

def main():
    client = chromadb.PersistentClient(path="./chroma_db")
    collection = client.get_or_create_collection(name="fundhorizon_schemes")
    model = TextEmbedding("BAAI/bge-small-en-v1.5")
    
    docs_dir = Path("schemes_md")
    files = list(docs_dir.glob("*.md"))[:10]
    print(f"Found {len(files)} sample markdown files for ingestion")
    
    texts = [f.read_text(encoding="utf-8") for f in files]
    ids = [f.stem for f in files]
    embeddings = list(model.embed(texts))
    
    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=texts,
    )
    print("Sample ingestion complete!")

if __name__ == "__main__":
    main()
''',
        encoding="utf-8",
    )

    print("Document generation complete successfully!")


def main():
    parser = argparse.ArgumentParser(description="Generate RAG markdown and JSON docs from CSVs")
    parser.add_argument(
        "--dataset-dir",
        type=str,
        default="data/fundhorizon_mf_rag_dataset",
        help="Path to fundhorizon_mf_rag_dataset directory",
    )
    parser.add_argument("--limit", type=int, default=0, help="Optional limit for schemes (0 = all)")
    args = parser.parse_args()

    generate_all(Path(args.dataset_dir), limit=args.limit)


if __name__ == "__main__":
    main()
