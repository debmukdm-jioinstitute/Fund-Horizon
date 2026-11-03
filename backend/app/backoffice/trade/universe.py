"""NSE equity universes for the Trade desk scanner."""

from __future__ import annotations

# Nifty 50 constituents (as of late 2025 — enough for offline scans; refresh periodically).
NIFTY_50: list[tuple[str, str]] = [
    ("ADANIENT", "Adani Enterprises"),
    ("ADANIPORTS", "Adani Ports"),
    ("APOLLOHOSP", "Apollo Hospitals"),
    ("ASIANPAINT", "Asian Paints"),
    ("AXISBANK", "Axis Bank"),
    ("BAJAJ-AUTO", "Bajaj Auto"),
    ("BAJFINANCE", "Bajaj Finance"),
    ("BAJAJFINSV", "Bajaj Finserv"),
    ("BEL", "Bharat Electronics"),
    ("BHARTIARTL", "Bharti Airtel"),
    ("BPCL", "Bharat Petroleum"),
    ("BRITANNIA", "Britannia Industries"),
    ("CIPLA", "Cipla"),
    ("COALINDIA", "Coal India"),
    ("DRREDDY", "Dr Reddy's Laboratories"),
    ("EICHERMOT", "Eicher Motors"),
    ("GRASIM", "Grasim Industries"),
    ("HCLTECH", "HCL Technologies"),
    ("HDFCBANK", "HDFC Bank"),
    ("HDFCLIFE", "HDFC Life"),
    ("HEROMOTOCO", "Hero MotoCorp"),
    ("HINDALCO", "Hindalco Industries"),
    ("HINDUNILVR", "Hindustan Unilever"),
    ("ICICIBANK", "ICICI Bank"),
    ("INDUSINDBK", "IndusInd Bank"),
    ("INFY", "Infosys"),
    ("ITC", "ITC"),
    ("JIOFIN", "Jio Financial"),
    ("JSWSTEEL", "JSW Steel"),
    ("KOTAKBANK", "Kotak Mahindra Bank"),
    ("LT", "Larsen & Toubro"),
    ("M&M", "Mahindra & Mahindra"),
    ("MARUTI", "Maruti Suzuki"),
    ("NESTLEIND", "Nestle India"),
    ("NTPC", "NTPC"),
    ("ONGC", "Oil & Natural Gas Corporation"),
    ("POWERGRID", "Power Grid Corporation"),
    ("RELIANCE", "Reliance Industries"),
    ("SBILIFE", "SBI Life Insurance"),
    ("SBIN", "State Bank of India"),
    ("SUNPHARMA", "Sun Pharmaceutical"),
    ("TATACONSUM", "Tata Consumer Products"),
    ("TATAMOTORS", "Tata Motors"),
    ("TATASTEEL", "Tata Steel"),
    ("TCS", "Tata Consultancy Services"),
    ("TECHM", "Tech Mahindra"),
    ("TITAN", "Titan Company"),
    ("TRENT", "Trent"),
    ("ULTRACEMCO", "UltraTech Cement"),
    ("WIPRO", "Wipro"),
]

# Liquid names often used for ORB demos / stress fixtures.
DEMO_WATCH = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "ITC", "BHARTIARTL"]


def universe(kind: str = "nifty50") -> list[dict]:
    kind = (kind or "nifty50").lower()
    if kind in ("nifty50", "n50", "default"):
        rows = NIFTY_50
    elif kind in ("demo", "watch"):
        names = dict(NIFTY_50)
        rows = [(s, names.get(s, s)) for s in DEMO_WATCH]
    else:
        rows = NIFTY_50
    return [{"symbol": s, "name": n, "exchange": "NSE"} for s, n in rows]


def symbols(kind: str = "nifty50") -> list[str]:
    return [r["symbol"] for r in universe(kind)]
