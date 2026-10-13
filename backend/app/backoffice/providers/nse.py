"""NSE India live data client: indices (incl. India VIX), FII/DII flows, option chains, quarterly results.

NSE publishes these as JSON behind its public website. The API requires a browser-like User-Agent and the
cookies set by the home page, so a client first warms a session. NSE may rate-limit or block datacenter IPs; every
call therefore reports failure through ``NseError`` instead of raising bare HTTP errors, and callers fall back to the
last stored data with an explicit unavailable/blocked status.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any

import httpx

logger = logging.getLogger("backoffice.providers.nse")

NSE_HOME = "https://www.nseindia.com/"
NSE_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)
SESSION_TTL_SECONDS = 600.0
IST = ZoneInfo("Asia/Kolkata")

# Index symbols whose derivatives are listed on NSE (BSE SENSEX derivatives are not served by this client).
NSE_DERIVATIVE_UNDERLYINGS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"}


class NseError(RuntimeError):
    """Raised when NSE cannot be reached or returns an unusable payload."""

    def __init__(self, message: str, status: str = "unavailable") -> None:
        super().__init__(message)
        self.status = status


def _num(value: Any) -> float | None:
    try:
        if value is None or value == "" or value == "-":
            return None
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def parse_nse_date(raw: str) -> str:
    """Parse NSE date strings (``12-Oct-2026``, ``13-Oct-2026 13:42``, ``13-10-2026``) to ``YYYY-MM-DD``."""
    raw = (raw or "").strip()
    for fmt in ("%d-%b-%Y %H:%M", "%d-%b-%Y %H:%M:%S", "%d-%b-%Y", "%d-%m-%Y", "%d-%b-%y", "%d-%B-%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Unknown NSE date: {raw!r}")


def parse_nse_timestamp(raw: str) -> str:
    """Parse ``13-Oct-2026 13:42:05`` style timestamps to ISO 8601 (no timezone; exchange local time)."""
    raw = (raw or "").strip()
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M"):
        try:
            return datetime.strptime(raw, fmt).isoformat()
        except ValueError:
            continue
    return parse_nse_date(raw)


class NseClient:
    """Thread-safe NSE JSON client with a cached warmed cookie session."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._client: httpx.Client | None = None
        self._warmed_at = 0.0

    def _session(self) -> httpx.Client:
        with self._lock:
            if self._client is None or time.monotonic() - self._warmed_at > SESSION_TTL_SECONDS:
                if self._client is not None:
                    self._client.close()
                self._client = httpx.Client(
                    timeout=httpx.Timeout(20.0, connect=10.0),
                    headers={"User-Agent": NSE_UA, "Accept-Language": "en-US,en;q=0.9"},
                    follow_redirects=True,
                )
                try:
                    self._client.get(NSE_HOME)
                except httpx.HTTPError as e:
                    raise NseError(f"NSE session warm-up failed: {e}") from e
                self._warmed_at = time.monotonic()
            return self._client

    def get_json(self, path: str, params: dict[str, str] | None = None, referer: str = NSE_HOME) -> Any:
        client = self._session()
        url = f"https://www.nseindia.com{path}"
        last: Exception | None = None
        for attempt in range(2):
            try:
                res = client.get(url, params=params, headers={"Accept": "application/json", "Referer": referer})
            except httpx.HTTPError as e:
                last = e
                continue
            if res.status_code in (401, 403):
                # Cookies expired or edge blocked us: force a fresh session once.
                self._warmed_at = 0.0
                client = self._session()
                last = NseError(f"NSE denied access (HTTP {res.status_code})", status="blocked")
                continue
            if res.status_code != 200:
                raise NseError(f"NSE returned HTTP {res.status_code} for {path}")
            try:
                return res.json()
            except ValueError as e:
                raise NseError(f"NSE returned non-JSON for {path}") from e
        if isinstance(last, NseError):
            raise last
        raise NseError(f"NSE request failed: {last}")

    # --- Indices -----------------------------------------------------------------------------------------

    def fetch_indices(self) -> dict[str, Any]:
        """Return ``{"as_of": date, "indices": {name: {last, previous_close, pct_change}}}``."""
        payload = self.get_json("/api/allIndices")
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not rows:
            raise NseError("NSE allIndices returned no data")
        stamp = payload.get("timestamp") or ""
        indices: dict[str, dict[str, float | None]] = {}
        for r in rows:
            name = r.get("index")
            last = _num(r.get("last"))
            if name and last is not None:
                indices[name] = {
                    "last": last,
                    "previous_close": _num(r.get("previousClose")),
                    "pct_change": _num(r.get("percentChange")),
                }
        return {"as_of": parse_nse_date(stamp) if stamp else datetime.now().strftime("%Y-%m-%d"), "indices": indices}

    # --- FII / DII ---------------------------------------------------------------------------------------

    def fetch_fii_dii(self) -> list[dict[str, Any]]:
        """Latest session FII/FPI and DII cash-market activity in INR crore."""
        payload = self.get_json("/api/fiidiiTradeReact", referer="https://www.nseindia.com/reports/fii-dii")
        if not isinstance(payload, list) or not payload:
            raise NseError("NSE FII/DII returned no rows")
        out: list[dict[str, Any]] = []
        for r in payload:
            raw_cat = str(r.get("category", "")).upper()
            category = "DII" if raw_cat.startswith("DII") else "FII" if raw_cat.startswith(("FII", "FPI")) else None
            buy, sell, net = _num(r.get("buyValue")), _num(r.get("sellValue")), _num(r.get("netValue"))
            if category is None or buy is None or sell is None or net is None:
                continue
            try:
                report_date = parse_nse_date(str(r.get("date", "")))
            except ValueError:
                continue
            out.append(
                {
                    "report_date": report_date,
                    "category": category,
                    "segment": "equity_cash",
                    "gross_buy": buy,
                    "gross_sell": sell,
                    "net": net,
                    "unit": "inr_crore",
                    "status": "provisional",
                    "source_id": "SRC_NSE_FNO",
                }
            )
        if not out:
            raise NseError("NSE FII/DII rows could not be parsed")
        return out

    # --- Option chain ------------------------------------------------------------------------------------

    def fetch_option_chain(self, symbol: str, expiry: str | None = None) -> dict[str, Any]:
        """Live index option chain for the requested (or nearest populated) expiry."""
        symbol = symbol.upper()
        if symbol not in NSE_DERIVATIVE_UNDERLYINGS:
            raise NseError(f"{symbol} derivatives are not available from NSE", status="unavailable")
        referer = "https://www.nseindia.com/option-chain"
        info = self.get_json("/api/option-chain-contract-info", {"symbol": symbol}, referer=referer)
        expiries: list[str] = list(info.get("expiryDates") or [])
        if not expiries:
            raise NseError(f"No listed expiries for {symbol}")

        # NSE keeps listing an expiry until its next session; never serve a series that already expired (IST).
        today = datetime.now(IST).strftime("%Y-%m-%d")
        live = [e for e in expiries if parse_nse_date(e) >= today]
        wanted = [expiry] if expiry else live[:4]
        if not wanted:
            raise NseError(f"No unexpired expiries for {symbol}")
        for exp in wanted:
            data = self.get_json(
                "/api/option-chain-v3", {"type": "Indices", "symbol": symbol, "expiry": exp}, referer=referer
            )
            records = (data or {}).get("records") or {}
            rows = records.get("data") or []
            if not rows:
                continue
            contracts: list[dict[str, Any]] = []
            for row in rows:
                for side, opt_type in (("CE", "CE"), ("PE", "PE")):
                    leg = row.get(side)
                    if not leg:
                        continue
                    strike = _num(leg.get("strikePrice") if leg.get("strikePrice") is not None else row.get("strikePrice"))
                    if strike is None:
                        continue
                    contracts.append(
                        {
                            "exchange": "NSE",
                            "underlying_symbol": symbol,
                            "expiry_date": parse_nse_date(str(leg.get("expiryDate") or exp)),
                            "strike_price": strike,
                            "option_type": opt_type,
                            "contract_id": leg.get("identifier"),
                            "last_price": _num(leg.get("lastPrice")),
                            "oi": int(_num(leg.get("openInterest")) or 0),
                            "oi_change": int(_num(leg.get("changeinOpenInterest")) or 0),
                            "volume": int(_num(leg.get("totalTradedVolume")) or 0),
                            "implied_vol": _num(leg.get("impliedVolatility")) or None,
                        }
                    )
            if not contracts:
                continue
            stamp = records.get("timestamp") or ""
            return {
                "underlying_symbol": symbol,
                "underlying_price": _num(records.get("underlyingValue")),
                "snapshot_timestamp": parse_nse_timestamp(stamp) if stamp else datetime.now().isoformat(timespec="seconds"),
                "expiry": parse_nse_date(exp),
                "expiries": [parse_nse_date(e) for e in expiries],
                "contracts": contracts,
            }
        raise NseError(f"NSE returned no option-chain rows for {symbol}")

    # --- Quarterly results -------------------------------------------------------------------------------

    def fetch_quarterly_results(self, symbol: str) -> list[dict[str, Any]]:
        """Recent quarterly results (newest first). Money fields are converted from INR lakh to INR crore."""
        payload = self.get_json(
            "/api/results-comparision", {"symbol": symbol.upper()}, referer="https://www.nseindia.com/get-quotes/equity"
        )
        rows = (payload or {}).get("resCmpData") or []
        quarters: list[dict[str, Any]] = []
        for r in rows:
            sales, pat = _num(r.get("re_net_sale")), _num(r.get("re_net_profit"))
            to_dt = r.get("re_to_dt")
            if sales is None or not to_dt:
                continue
            try:
                period_end = parse_nse_date(str(to_dt).title())
            except ValueError:
                continue
            pbt = _num(r.get("re_pro_loss_bef_tax"))
            interest = _num(r.get("re_int_new")) or 0.0
            depreciation = _num(r.get("re_depr_und_exp")) or 0.0
            other_income = _num(r.get("re_oth_inc_new")) or 0.0
            ebitda = (pbt + interest + depreciation - other_income) if pbt is not None else None
            quarters.append(
                {
                    "period_end": period_end,
                    "revenue_crore": round(sales / 100.0, 2),
                    "ebitda_crore": round(ebitda / 100.0, 2) if ebitda is not None else None,
                    "ebitda_margin_pct": round(ebitda / sales * 100.0, 2) if ebitda is not None and sales else None,
                    "pat_crore": round(pat / 100.0, 2) if pat is not None else None,
                    "filing_id": str(r.get("re_seq_num") or "") or None,
                }
            )
        quarters.sort(key=lambda q: q["period_end"], reverse=True)
        return quarters


_NSE = NseClient()


def get_nse_client() -> NseClient:
    return _NSE
