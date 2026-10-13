"""Load the local fund dataset into Supabase. Plans and CAS sessions are left alone."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

FUND_COLS = [
    "scheme_code",
    "isin_growth_or_payout",
    "isin_reinvest",
    "scheme_name",
    "plan_raw",
    "option_raw",
    "latest_nav_date",
    "amc",
    "structure",
    "category",
    "plan",
    "option",
    "first_nav_date",
    "last_nav_date",
    "data_quality",
    "extreme_return_flag",
    "nav_adjustments",
    "nav_shocks",
]
METRIC_COLS = [
    "scheme_code",
    "latest_nav",
    "history_years",
    "nav_points",
    "ret_1m",
    "ret_3m",
    "ret_6m",
    "ret_1y",
    "cagr_3y",
    "cagr_5y",
    "cagr_7y",
    "cagr_10y",
    "max_drawdown_all",
    "cagr_since_inception",
    "vol_3y",
    "sharpe_3y",
    "sortino_3y",
    "max_drawdown_3y",
    "roll1y_min",
    "roll1y_median",
    "roll1y_max",
    "roll1y_pct_positive",
    "roll3y_min",
    "roll3y_median",
    "roll3y_max",
    "roll3y_pct_positive",
    "roll5y_min",
    "roll5y_median",
    "roll5y_max",
    "roll5y_pct_positive",
]
NAV_COLS = ["scheme_code", "nav_date", "nav"]
_DATE_COLS = {"latest_nav_date", "first_nav_date", "last_nav_date"}
_INT_COLS = {"nav_points"}
_BOOL_COLS = {"extreme_return_flag"}


def _none(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    if isinstance(value, str):
        text = value.strip()
        if text in ("", "-", "None", "nan", "NaN"):
            return None
        return text
    return value


def _date(value):
    value = _none(value)
    if value is None:
        return None
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def _bool(value):
    value = _none(value)
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes")


def _float(value):
    value = _none(value)
    if value is None:
        return None
    return float(value)


def _int(value):
    value = _none(value)
    if value is None:
        return None
    return int(float(value))


def _field(column: str, value):
    if column in _DATE_COLS or column == "nav_date":
        return _date(value)
    if column in _BOOL_COLS:
        return _bool(value)
    if column in _INT_COLS:
        return _int(value)
    if column == "scheme_code":
        text = _none(value)
        return None if text is None else str(text)
    if column in ("scheme_name", "amc", "structure", "category", "plan", "option", "plan_raw", "option_raw",
                  "isin_growth_or_payout", "isin_reinvest", "data_quality", "nav_adjustments", "nav_shocks"):
        return _none(value)
    return _float(value)


def _tuple(row: dict, columns: list[str]) -> tuple:
    return tuple(_field(column, row.get(column)) for column in columns)


def fund_tuple(row: dict) -> tuple:
    return _tuple(row, FUND_COLS)


def metric_tuple(row: dict) -> tuple:
    return _tuple(row, METRIC_COLS)


def nav_rows(scheme_code: str, frame: pd.DataFrame) -> list[tuple]:
    rows = []
    for record in frame.to_dict("records"):
        nav_date = _date(record.get("date"))
        nav = _float(record.get("nav"))
        if nav_date is None or nav is None:
            continue
        rows.append((scheme_code, nav_date, nav))
    return rows


def _copy(cur, table: str, columns: list[str], rows: list[tuple]) -> None:
    if not rows:
        return
    sql = f"COPY {table} ({', '.join(columns)}) FROM STDIN"
    with cur.copy(sql) as copy:
        for row in rows:
            copy.write_row(row)


def sync(conn, data_dir: Path, nav_batch: int = 50_000) -> dict:
    frame = pd.read_csv(data_dir / "all_schemes_metrics.csv", dtype={"scheme_code": str})
    records = frame.to_dict("records")
    funds = [fund_tuple(row) for row in records]
    metrics = [metric_tuple(row) for row in records]
    codes = {row[0] for row in funds if row[0]}

    with conn.cursor() as cur:
        cur.execute("TRUNCATE nav_monthly, metrics, funds")
        _copy(cur, "funds", FUND_COLS, funds)
        _copy(cur, "metrics", METRIC_COLS, metrics)
    conn.commit()

    nav_count = 0
    skipped = 0
    batch: list[tuple] = []
    nav_dir = data_dir / "nav_monthly"

    def flush() -> None:
        nonlocal nav_count, batch
        if not batch:
            return
        with conn.cursor() as cur:
            _copy(cur, "nav_monthly", NAV_COLS, batch)
        conn.commit()
        nav_count += len(batch)
        batch = []

    for path in sorted(nav_dir.glob("*.csv")):
        if path.stem not in codes:
            skipped += 1
            continue
        series = pd.read_csv(path)
        batch.extend(nav_rows(path.stem, series))
        if len(batch) >= nav_batch:
            flush()
    flush()
    return {"funds": len(funds), "metrics": len(metrics), "nav_monthly": nav_count, "nav_files_skipped": skipped}
