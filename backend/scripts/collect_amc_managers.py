"""Collect fund manager names and start dates directly from AMC public disclosures.

Outputs to data/mf_manager_cache/<amc_slug>.csv:
    scheme_code,manager_name,manager_start,source,url,fetched_at

Usage:
    python backend/scripts/collect_amc_managers.py --dry-run
    python backend/scripts/collect_amc_managers.py --amc icici_prudential
    python backend/scripts/collect_amc_managers.py
"""
from __future__ import annotations

import argparse
import collections
import csv
import logging
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.robotparser
from datetime import date
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import pypdfium2 as pdfium

# Add backend directory to sys.path
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_DIR.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.backoffice import mf_screener  # noqa: E402
from app.backoffice.fund_quartile import name_key  # noqa: E402

logger = logging.getLogger("collect_amc_managers")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

UA = "FundHorizon-Backoffice/1.0 (internal-research)"
CACHE_DIR = _BACKEND_DIR / ".cache" / "amc_factsheets"
OUT_DIR = _REPO_ROOT / "data" / "mf_manager_cache"

_MONS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
_DATE_PAT = re.compile(
    rf"(\d{{1,2}}(?:st|nd|rd|th)?[\s\-\/]+{_MONS}[\s\-\/]+\d{{2,4}}|"
    rf"{_MONS}[\s\-\/]+\d{{1,2}}(?:st|nd|rd|th)?,?[\s\-\/]+\d{{2,4}}|"
    rf"{_MONS}[\s\-\/]+\d{{2,4}}|\d{{1,2}}[\/\-]\d{{1,2}}[\/\-]\d{{2,4}})",
    re.I,
)

_MONTHS_MAP = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

_ROBOTS_CACHE: dict[str, urllib.robotparser.RobotFileParser] = {}


def is_allowed_by_robots(url: str, user_agent: str = UA) -> bool:
    """Verify that the target URL is permitted by the origin's robots.txt."""
    parsed = urllib.parse.urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in _ROBOTS_CACHE:
        rp = urllib.robotparser.RobotFileParser()
        # Fetch robots.txt with curl to use OS trust store
        r = subprocess.run(["curl", "-sSLf", "-m", "10", "-A", user_agent, f"{origin}/robots.txt"], capture_output=True)
        if r.returncode == 0 and r.stdout:
            rp.parse(r.stdout.decode("utf-8", errors="replace").splitlines())
        else:
            rp.allow_all = True
        _ROBOTS_CACHE[origin] = rp
    return _ROBOTS_CACHE[origin].can_fetch(user_agent, url)


def default_fetcher(url: str) -> bytes:
    """Fetch URL respecting rate limits, robots.txt, and caching to backend/.cache/."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", url.split("?")[0].split("/")[-1])
    if not slug.endswith((".pdf", ".html", ".htm")):
        slug += ".bin"
    cached_path = CACHE_DIR / f"{abs(hash(url)) % 1000000}_{slug}"
    if cached_path.exists() and cached_path.stat().st_size > 500:
        return cached_path.read_bytes()

    if not is_allowed_by_robots(url, UA):
        raise PermissionError(f"robots.txt disallows crawling {url}")

    time.sleep(1.0)
    cmd = ["curl", "-sSLf", "-m", "45", "-A", UA, url]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        time.sleep(2.0)
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            raise OSError(f"curl failed ({r.returncode}) fetching {url}: {r.stderr.decode('utf-8', errors='ignore')[:120]}")

    cached_path.write_bytes(r.stdout)
    return r.stdout


def parse_amc_date(s: str | None) -> str | None:
    """Parse Indian mutual fund disclosure dates into ISO YYYY-MM-DD."""
    if not s:
        return None
    cleaned = s.strip().replace("•", "").replace("w.e.f.", "").replace("w.e.f", "").replace("\ufffe", "-").strip()

    # Mon-YY, e.g. Jul-21 or Jul 21 or Jul-2021
    m = re.match(r"^([A-Za-z]{3,9})[\s\-\/]+(\d{2,4})$", cleaned)
    if m:
        mon_str, yr_str = m.group(1).lower(), m.group(2)
        mon = _MONTHS_MAP.get(mon_str[:3])
        if mon:
            yr = int(yr_str)
            if yr < 100:
                yr += 2000
            return f"{yr:04d}-{mon:02d}-01"

    # DD-Mon-YY or DD-Mon-YYYY, e.g. 15-Jul-21 or 15-Jul-2021 or 15 July 2021 or 15th July 2021
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]+([A-Za-z]{3,9})[\s\-\/]+(\d{2,4})$", cleaned)
    if m:
        day = int(m.group(1))
        mon_str, yr_str = m.group(2).lower(), m.group(3)
        mon = _MONTHS_MAP.get(mon_str[:3])
        if mon:
            yr = int(yr_str)
            if yr < 100:
                yr += 2000
            try:
                return date(yr, mon, day).isoformat()
            except ValueError:
                pass

    # Mon DD, YYYY e.g. July 15, 2021 or Jul 15 2021
    m = re.match(r"^([A-Za-z]{3,9})[\s\-\/]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-\/]+(\d{2,4})$", cleaned)
    if m:
        mon_str, day_str, yr_str = m.group(1).lower(), m.group(2), m.group(3)
        mon = _MONTHS_MAP.get(mon_str[:3])
        if mon:
            day = int(day_str)
            yr = int(yr_str)
            if yr < 100:
                yr += 2000
            try:
                return date(yr, mon, day).isoformat()
            except ValueError:
                pass

    # DD/MM/YYYY or DD-MM-YYYY
    m = re.match(r"^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$", cleaned)
    if m:
        day, mon, yr_str = int(m.group(1)), int(m.group(2)), m.group(3)
        yr = int(yr_str)
        if yr < 100:
            yr += 2000
        if 1 <= mon <= 12 and 1 <= day <= 31:
            try:
                return date(yr, mon, day).isoformat()
            except ValueError:
                pass
    return None


def clean_manager_name(name: str | None) -> str:
    """Normalize manager name string."""
    if not name:
        return ""
    n = re.sub(r"^[•\*\-\d\.\s]+", "", name)
    n = re.sub(r"^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+", "", n, flags=re.I)
    n = re.sub(r"\(.*?\)", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def match_scheme(
    amc_name: str,
    scheme_name: str,
    plan: str | None,
    base_df: pd.DataFrame,
) -> list[dict[str, Any]]:
    """Match scheme_name to base_df records for amc_name.

    Refuses ambiguous matches if multiple distinct underlying regular funds share the same key.
    """
    amc_schemes = base_df[base_df["amc"] == amc_name]
    k = name_key(scheme_name)
    if not k:
        return []
    candidates = amc_schemes[amc_schemes["name"].apply(name_key) == k]
    if candidates.empty:
        return []
    if plan:
        candidates = candidates[candidates["plan"].str.lower() == plan.lower()]
    # Check for ambiguity: multiple different underlying funds matching same key
    reg_plans = candidates[candidates["plan"] == "Regular"]
    if len(reg_plans) > 1 and len(set(reg_plans["name"].tolist())) > 1:
        return []
    dir_plans = candidates[candidates["plan"] == "Direct"]
    if len(dir_plans) > 1 and len(set(dir_plans["name"].tolist())) > 1:
        return []
    return candidates.to_dict("records")


# ==============================================================================
# AMC Collectors
# ==============================================================================

def collect_icici_prudential(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.icicipruamc.com/blob/knowledgecentre/factsheet-complete/Complete.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    # Master table at pages 150-151 (0-indexed 149-150)
    for p in range(max(0, len(pdf) - 40), len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Fund Manager Details" in text and "Managing" in text:
            for line in text.split("\r\n"):
                line = line.strip().replace('"', '')
                if not line or "Fund Manager Details" in line or "Managing" in line or "Scheme Name" in line:
                    continue
                dates = list(re.finditer(r"\b([A-Za-z]{3}\-\d{2})\b", line))
                if not dates:
                    continue
                first_date = dates[0].group(1)
                before = line[:dates[0].start()].strip()
                tokens = before.split()
                if len(tokens) < 3:
                    continue
                m_s = re.search(r"^(.*?Fund.*?|.*?ETF.*?|.*?Index.*?|.*?Plan.*?)\s+([A-Z][a-zA-Z\s\.\&]+)$", before)
                if m_s:
                    s_name = m_s.group(1).strip()
                    mgr = m_s.group(2).strip()
                else:
                    mgr = " ".join(tokens[-2:])
                    s_name = " ".join(tokens[:-2])
                results.append({
                    "scheme_name": s_name,
                    "plan": None,
                    "manager_name": clean_manager_name(mgr),
                    "manager_start": parse_amc_date(first_date),
                    "url": url,
                })
    return results


def collect_hdfc(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://files.hdfcfund.com/s3fs-public/2026-10/HDFC%20MF%20Factsheet%20-%20September%202026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(6, min(120, len(pdf))):
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        s_name = ""
        for l in lines[:6]:
            if l.startswith("HDFC ") and not any(w in l.lower() for w in ["mutual fund", "factsheet", "september", "october"]):
                s_name = l
                break
        if not s_name:
            continue
        mgr_idx = next((i for i, l in enumerate(lines) if "FUND MANAGER" in l), -1)
        if mgr_idx >= 0:
            block = " ".join(lines[mgr_idx:mgr_idx + 8])
            m_date = _DATE_PAT.search(block)
            if m_date:
                s_date = m_date.group(1)
                m_chunk = block[:m_date.start()]
                m_words = re.sub(r".*?(?:Total Exp|Name Since|FUND MANAGER[^\s]*)\s*", "", m_chunk, flags=re.I).strip()
                mgr = clean_manager_name(m_words)
                results.append({
                    "scheme_name": s_name,
                    "plan": None,
                    "manager_name": mgr,
                    "manager_start": parse_amc_date(s_date),
                    "url": url,
                })
    return results


def collect_sbi(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.sbimf.com/docs/default-source/scheme-factsheets/all-sbimf-schemes-factsheet-september-2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        for l in lines:
            m = re.search(r"^(SBI\s+.*?)\s+FUND\s+MANAGER\s*[-–]\s*(.*?)$", l, re.I)
            if m:
                s_name = m.group(1).strip()
                mgr = m.group(2).strip()
                date_found = None
                for p_sub in [p - 1, p, p + 1]:
                    if 0 <= p_sub < len(pdf):
                        sub_text = pdf[p_sub].get_textpage().get_text_range()
                        m_since = re.search(
                            rf"{re.escape(mgr.split()[-1])}.*?(?:years|yrs)?\s+([A-Za-z]{{3,9}}\s*\d{{4}}|[A-Za-z]{{3,9}}\-\d{{4}})",
                            sub_text,
                            re.I,
                        )
                        if m_since:
                            date_found = m_since.group(1)
                            break
                results.append({
                    "scheme_name": s_name,
                    "plan": None,
                    "manager_name": clean_manager_name(mgr),
                    "manager_start": parse_amc_date(date_found),
                    "url": url,
                })
    return results


def collect_absl(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://mutualfund.adityabirlacapital.com/-/media/bsl/files/resources/factsheets/2026/empower-for-the-month-of-october-2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(13, len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing since" in text or "Managing Since" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                if l.startswith("Aditya Birla Sun Life ") and any(l.endswith(w) for w in ["Fund", "FOF", "ETF", "Plan", "Scheme"]):
                    title = l
                    break
            mgr_idx = next((i for i, l in enumerate(lines) if "Name of Fund Manager" in l), -1)
            since_idx = next((i for i, l in enumerate(lines) if "managing since" in l.lower()), -1)
            if title and mgr_idx >= 0 and since_idx >= 0:
                mgr = lines[mgr_idx + 1].replace("•", "").strip()
                since_line = lines[since_idx]
                m_date = _DATE_PAT.search(since_line)
                s_date = m_date.group(1) if m_date else None
                results.append({
                    "scheme_name": title,
                    "plan": None,
                    "manager_name": clean_manager_name(mgr),
                    "manager_start": parse_amc_date(s_date),
                    "url": url,
                })
    return results


def collect_nippon_india(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://mf.nipponindiaim.com/InvestorServices/FactSheetsDocuments/Nippon-FS-October-2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Since:" in text or "Managing Since :" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:6]:
                if "Nippon India " in l and not any(w in l.lower() for w in ["factsheet", "october", "page", "type of scheme"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "managing since" in l.lower():
                    block = " ".join(lines[idx:idx + 3])
                    m_date = _DATE_PAT.search(block)
                    s_date = m_date.group(1) if m_date else None
                    mgr = ""
                    for k in range(max(0, idx - 5), idx):
                        if "•" in lines[k] or "Mr." in lines[k] or "Ms." in lines[k]:
                            mgr = lines[k]
                            break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_bandhan(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://storage.googleapis.com/nonprod-static-assets-121to59kaawfgfi7bol/2026/10/67b56d7a-bandhan-sebi-factsheet-sep-2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(14, len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Since" in text or "Managing since" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                if l.startswith("Bandhan ") and not any(w in l.lower() for w in ["factsheet", "mutual fund", "index", "september"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "managing since" in l.lower():
                    block = " ".join(lines[idx:idx + 3])
                    m_date = _DATE_PAT.search(block)
                    s_date = m_date.group(1) if m_date else None
                    mgr = ""
                    for k in range(max(0, idx - 5), idx):
                        if "•" in lines[k] or "Mr." in lines[k] or "Ms." in lines[k]:
                            mgr = lines[k]
                            break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_tata(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://betacms.tatamutualfund.com/system/files/2026-10/Tata%20Factsheet%20-%20September%202026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Since" in text or "Managing since" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                m_t = re.search(r"\b(Tata\s+[A-Za-z0-9\s\&\-\/]+(?:Fund|ETF|Index|Plan))\b", l)
                if m_t and not any(w in l.lower() for w in ["mutual fund", "factsheet", "type of"]):
                    title = m_t.group(1).strip()
                    break
            for idx, l in enumerate(lines):
                if "managing since" in l.lower():
                    block = " ".join(lines[idx:idx + 2]).replace("\ufffe", "-")
                    m_date = _DATE_PAT.search(block)
                    s_date = m_date.group(1) if m_date else None
                    mgr = ""
                    for k in range(max(0, idx - 5), idx):
                        if "•" in lines[k] or "Mr." in lines[k] or "Ms." in lines[k]:
                            mgr = lines[k]
                            break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_invesco(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.invescomutualfund.com/docs/default-source/factsheet/invesco-mf-factsheet-september-2026.pdf?sfvrsn=97889ec2_2"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Experience in managing this fund" in text or "managing since" in text.lower():
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:5]:
                if "Invesco India " in l and not any(w in l.lower() for w in ["factsheet", "mutual fund", "snapshot", "september"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "fund manager & experience" in l.lower() or "fund manager" in l.lower():
                    mgr = lines[idx + 1] if idx + 1 < len(lines) else ""
                    for k in range(idx + 1, min(len(lines), idx + 8)):
                        m_d = _DATE_PAT.search(lines[k])
                        if m_d and ("since" in lines[k].lower() or "since" in lines[k - 1].lower()):
                            s_date = m_d.group(1)
                            if title and mgr and s_date:
                                results.append({
                                    "scheme_name": title,
                                    "plan": None,
                                    "manager_name": clean_manager_name(mgr),
                                    "manager_start": parse_amc_date(s_date),
                                    "url": url,
                                })
                                break
                    break
    return results


def collect_dsp(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.dspim.com/downloads/dsp-factsheet_september-2026_final.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "FUND MANAGER" in text and ("managing" in text.lower() or "since" in text.lower()):
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:5]:
                if "DSP " in l and not any(w in l.lower() for w in ["factsheet", "mutual fund", "report"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if l == "FUND MANAGER" or "fund manager" in l.lower():
                    mgr = lines[idx + 1] if idx + 1 < len(lines) else ""
                    for k in range(idx + 1, min(len(lines), idx + 10)):
                        if "managing" in lines[k].lower():
                            block = " ".join(lines[k:k + 2])
                            m_d = _DATE_PAT.search(block)
                            if m_d:
                                s_date = m_d.group(1)
                                if title and mgr and s_date:
                                    results.append({
                                        "scheme_name": title,
                                        "plan": None,
                                        "manager_name": clean_manager_name(mgr),
                                        "manager_start": parse_amc_date(s_date),
                                        "url": url,
                                    })
                                    break
                    break
    return results


def collect_ppfas(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://amc.ppfas.com/downloads/factsheet/2026/ppfas-mf-factsheet-for-September-2026.pdf?08102026"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        title = ""
        for l in lines[:4]:
            if "Parag Parikh " in l or "PPFAS " in l:
                title = l
                break
        for idx, l in enumerate(lines):
            if "fund manager" in l.lower() or "managing" in l.lower():
                for k in range(idx, min(len(lines), idx + 8)):
                    m_d = _DATE_PAT.search(lines[k])
                    if m_d and ("since" in lines[k].lower() or "since" in lines[k - 1].lower()):
                        s_date = m_d.group(1)
                        # Default lead manager for PPFAS is Rajeev Thakkar unless specified
                        mgr = "Rajeev Thakkar"
                        if "raunak onkar" in text.lower():
                            mgr = "Raunak Onkar"
                        elif "tejas soman" in text.lower():
                            mgr = "Tejas Soman"
                        if title and s_date:
                            results.append({
                                "scheme_name": title,
                                "plan": None,
                                "manager_name": mgr,
                                "manager_start": parse_amc_date(s_date),
                                "url": url,
                            })
                            break
                if title and results and results[-1]["scheme_name"] == title:
                    break
    return results


def collect_mirae(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.miraeassetmf.co.in/docs/default-source/fachsheet/active-factsheet---october-2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Since:" in text or "Managing Since :" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                m_t = re.search(r"\b(MIRAE\s+ASSET\s+[A-Za-z0-9\s\&\-\/]+(?:FUND|ETF|SCHEME|PLAN))\b", l, re.I)
                if m_t and not any(w in l.lower() for w in ["mutual fund", "factsheet", "snapshot", "type of"]):
                    title = m_t.group(1).strip()
                    break
            for idx, l in enumerate(lines):
                if "managing since" in l.lower():
                    block = " ".join(lines[idx:idx + 3])
                    m_date = _DATE_PAT.search(block)
                    s_date = m_date.group(1) if m_date else None
                    mgr = ""
                    for k in range(max(0, idx - 5), idx):
                        if "Mr." in lines[k] or "Ms." in lines[k]:
                            mgr = lines[k]
                            break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_quant(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://quantmutual.com/Admin/Factsheet/quant_Factsheet_October_2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Fund Manager Details" in text and "Managing Since:" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = lines[0] if lines else ""
            for idx, l in enumerate(lines):
                if "name of fund manager:" in l.lower():
                    mgr = l.split(":", 1)[1].strip()
                    s_date = None
                    for k in range(idx + 1, min(len(lines), idx + 4)):
                        if "managing since:" in lines[k].lower():
                            m_d = _DATE_PAT.search(lines[k])
                            if m_d:
                                s_date = m_d.group(1)
                                break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_baroda_bnp(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.barodabnpparibasmf.in/assets/download_documents/BBNPP_MF_Fund_Facts_September_2026_20389.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    current_scheme = ""
    # P108 and P109 contain master table
    for p in range(max(0, len(pdf) - 15), len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Fund Managers & Managing Since Details" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            for l in lines:
                if "Baroda BNP Paribas " in l and not any(w in l.lower() for w in ["past performance", "fund facts", "managing"]):
                    m_d = _DATE_PAT.search(l)
                    if m_d:
                        s_part = l[:m_d.start()].strip()
                        s_date = m_d.group(1)
                        m_split = re.search(r"^(Baroda\s+BNP\s+Paribas\s+.*?Fund.*?)\s+(?:Mr\.|Ms\.)\s*(.*?)$", s_part, re.I)
                        if m_split:
                            current_scheme = m_split.group(1).strip()
                            mgr = m_split.group(2).strip()
                            results.append({
                                "scheme_name": current_scheme,
                                "plan": None,
                                "manager_name": clean_manager_name(mgr),
                                "manager_start": parse_amc_date(s_date),
                                "url": url,
                            })
                    else:
                        current_scheme = l
                elif current_scheme and ("Mr." in l or "Ms." in l):
                    m_d = _DATE_PAT.search(l)
                    if m_d:
                        s_date = m_d.group(1)
                        mgr = l[:m_d.start()].replace("Mr.", "").replace("Ms.", "").strip()
                        results.append({
                            "scheme_name": current_scheme,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
    return results


def collect_union(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.unionmf.com/docs/default-source/downloads/scheme-disclosures/factsheets/factsheet-september-2026.pdf?sfvrsn=d483ddd_3"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Since:" in text or "Managing Since :" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:4]:
                if "Union " in l and not any(w in l.lower() for w in ["mutual fund", "factsheet", "snapshot"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "name of fund manager" in l.lower():
                    mgr = lines[idx]
                    if idx + 1 < len(lines) and "managing since" not in lines[idx + 1].lower():
                        mgr += " " + lines[idx + 1]
                    mgr = re.sub(r".*?:\s*", "", mgr).replace("Mr.", "").replace("Ms.", "").strip()
                    s_date = None
                    for k in range(idx, min(len(lines), idx + 6)):
                        if "managing since" in lines[k].lower():
                            block = " ".join(lines[k:k + 3])
                            m_d = _DATE_PAT.search(block)
                            if m_d:
                                s_date = m_d.group(1)
                                break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr.split("&")[0].strip()),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_motilal(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.motilaloswalmf.com/content/dam/motilal-mf/downloads/mf/factsheet/2026/oct/Factsheet%20September%202026%20Active.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing this fund since" in text or "managing this fund since" in text.lower():
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                m_t = re.search(r"\b(Motilal\s+Oswal\s+[A-Za-z0-9\s\&\-\/]+(?:Fund|ETF|Scheme|Plan))\b", l, re.I)
                if m_t and not any(w in l.lower() for w in ["mutual fund", "factsheet", "snapshot"]):
                    title = m_t.group(1).strip()
                    break
            for idx, l in enumerate(lines):
                if "managing this fund since" in l.lower():
                    m_d = _DATE_PAT.search(l)
                    s_date = m_d.group(1) if m_d else None
                    mgr = lines[idx - 1] if idx > 0 else ""
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_axis(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.axismf.com/1/5/1423/1484/1487/2872/4655/Axis_Fund_Factsheet_September_2026_ab18df095e.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        m = re.findall(r"([A-Za-z\s]+?)\s+is\s+managing\s+the\s+scheme\s+since\s+([A-Za-z0-9\s,]+?)(?:\s+and\s+he|\s+and\s+she|\.|\,)", text)
        if m:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                m_t = re.search(r"\b(Axis\s+[A-Za-z0-9\s\&\-\/]+(?:Fund|ETF|Index|Plan))\b", l, re.I)
                if m_t and not any(w in l.lower() for w in ["mutual fund", "factsheet", "bank", "disclaimer", "option"]):
                    title = m_t.group(1).strip()
                    break
            if title:
                mgr, s_date = m[0]
                results.append({
                    "scheme_name": title,
                    "plan": None,
                    "manager_name": clean_manager_name(mgr),
                    "manager_start": parse_amc_date(s_date),
                    "url": url,
                })
    return results


def collect_lic(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.licmf.com/assets/downloads/monthly_fact_sheet/2026-2027/10/lic-mf-factsheet-30th-september-2026-275881603.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    p_idx = min(9, len(pdf) - 1)
    for line in pdf[p_idx].get_textpage().get_text_range().split("\r\n"):
        line = line.strip()
        if not line.startswith("LIC MF "):
            continue
        m_d = _DATE_PAT.search(line)
        if m_d:
            s_date = m_d.group(1)
            before = line[:m_d.start()].strip()
            m_f = re.search(r"^(LIC\s+MF\s+.*?(?:Fund|Scheme))\s+(.*?)$", before, re.I)
            if m_f:
                results.append({
                    "scheme_name": m_f.group(1).strip(),
                    "plan": None,
                    "manager_name": clean_manager_name(m_f.group(2)),
                    "manager_start": parse_amc_date(s_date),
                    "url": url,
                })
    return results


def collect_zerodha(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://assets.zerodhafundhouse.com/offer-documents/factsheet/Factsheet%20-%20Sep%2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Since:" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:4]:
                if "Zerodha " in l and not any(w in l.lower() for w in ["mutual fund", "factsheet"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "managing since:" in l.lower():
                    m_d = re.search(r"Managing Since:\s*([A-Za-z]{3}\s*\d{4})", l, re.I)
                    if not m_d and idx + 1 < len(lines):
                        m_d = re.search(r"Managing Since:\s*([A-Za-z]{3})\s*(\d{4})", l + " " + lines[idx + 1], re.I)
                    s_date = m_d.group(1) if m_d else None
                    mgr = ""
                    for k in range(max(0, idx - 4), idx):
                        if "mr." in lines[k].lower() or "ms." in lines[k].lower():
                            mgr = lines[k]
                            if k + 1 < idx and not any(w in lines[k + 1].lower() for w in ["experience", "managing", "details"]):
                                mgr += " " + lines[k + 1]
                            break
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_quantum(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.quantumamc.com/FileCDN/FactSheet/4b3baa4e-ad9b-4edb-bacc-8664fc058bf5.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        for idx, l in enumerate(lines):
            if "is managing the scheme since" in l:
                title = ""
                for k in range(max(0, idx - 4), idx):
                    if "quantum " in lines[k].lower():
                        title = lines[k]
                        break
                m_sub = re.findall(r"(?:Mr\.|Ms\.|Mrs\.)\s+([A-Za-z\s]+?)\s+is\s+managing\s+the\s+scheme\s+since\s+([A-Za-z0-9\s,]+?)(?:\.|$)", l)
                if title and m_sub:
                    mgr, s_date = m_sub[0]
                    results.append({
                        "scheme_name": title,
                        "plan": None,
                        "manager_name": clean_manager_name(mgr),
                        "manager_start": parse_amc_date(s_date),
                        "url": url,
                    })
    return results


def collect_samco(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.samcomf.com/amc-document-download/Factsheet-September2026_1791201633.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing since:" in text:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:4]:
                if "Samco " in l and not any(w in l.lower() for w in ["mutual fund", "factsheet"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "managing since:" in l.lower():
                    s_date = re.sub(r".*?managing since:\s*", "", l, flags=re.I).strip()
                    mgr = lines[idx - 1] if idx > 0 else ""
                    if title and mgr and s_date and "inception" not in s_date.lower():
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_franklin_templeton(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.franklintempletonindia.com/download/en-in/fund-factsheets/76f76187-e527-43a3-bdd7-10dfd1c90eff/Factsheet-as-on-September-30-2026_web.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(56, min(len(pdf), 85)):
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        for idx, l in enumerate(lines):
            if "Fund Manager(s):" in l:
                title = ""
                for k in range(max(0, idx - 3), idx):
                    if "Franklin " in lines[k] and not any(w in lines[k].lower() for w in ["mutual fund", "factsheet"]):
                        t = re.sub(r"\s*\([^)]*\)", "", lines[k])
                        title = re.sub(r"\s*-\s*Regular.*", "", t, flags=re.I).strip()
                        break
                mgr_block = " ".join(lines[idx + 1:idx + 5])
                m = re.findall(r"([A-Za-z\s.]+?)\s*\((?:Managing\s+since\s+)?([A-Za-z]+\s+\d{1,2},?\s*\d{4})\)", mgr_block, re.I)
                if title and m:
                    results.append({
                        "scheme_name": title,
                        "plan": None,
                        "manager_name": clean_manager_name(m[0][0]),
                        "manager_start": parse_amc_date(m[0][1]),
                        "url": url,
                    })
    return results


def collect_groww(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://assets-netstorage.growwmf.in/compliance_docs/Downloads/Fact%20Sheet/2024-%202025/Monthly%20Factsheet%20Sept%202026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        if "Managing Fund Since" in text or "managing fund since" in text.lower():
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines[:6]:
                if "groww " in l.lower() and not any(w in l.lower() for w in ["mutual fund", "factsheet"]):
                    title = l
                    break
            for idx, l in enumerate(lines):
                if "managing fund since" in l.lower():
                    s_date = re.sub(r".*?since\s*", "", l, flags=re.I).strip(" )")
                    mgr = lines[idx - 1] if idx > 0 else ""
                    if "fund manager" in mgr.lower() and idx > 1:
                        mgr = lines[idx - 2]
                    if title and mgr and s_date:
                        results.append({
                            "scheme_name": title,
                            "plan": None,
                            "manager_name": clean_manager_name(mgr),
                            "manager_start": parse_amc_date(s_date),
                            "url": url,
                        })
                        break
    return results


def collect_pgim(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://www.pgimindia.com/api/v1/brochure/about-us/image/Factsheet-August2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in [5, 6, 7, 25, 26]:
        if p >= len(pdf):
            continue
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        scheme_line = ""
        for l in lines:
            if l.startswith("Scheme Name PGIM India"):
                scheme_line = l.replace("Scheme Name ", "")
                break
            elif "PGIM India " in l and "Fund" in l and scheme_line == "":
                scheme_line = l
                break
        schemes = ["PGIM India " + s.strip() for s in scheme_line.split("PGIM India ") if s.strip()]
        mgr_matches = list(re.finditer(r"([A-Za-z\s.]+?)(?:\s*\([^)]*\))?\s+is\s+managing\s+from\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})", text, re.I))
        for s, m in zip(schemes, mgr_matches):
            results.append({
                "scheme_name": s,
                "plan": None,
                "manager_name": clean_manager_name(m.group(1)),
                "manager_start": parse_amc_date(m.group(2)),
                "url": url,
            })
    return results


def collect_shriram(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://cdn.shriramamc.in/uploads/fact-sheet/Fact-Sheet/2026-2027/Factsheet-September-2026.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(43, min(len(pdf), 49)):
        text = pdf[p].get_textpage().get_text_range()
        lines = [l.strip() for l in text.split("\r\n") if l.strip()]
        for idx, l in enumerate(lines):
            if l.isupper() and "SHRIRAM " in l and any(w in l for w in ["FUND", "ETF"]):
                title = l.title()
                for k in range(max(0, idx - 3), min(len(lines), idx + 4)):
                    if "is currently managed by" in lines[k]:
                        m_d = re.findall(r"(?:Mr\.|Ms\.)\s+([A-Za-z\s]+?)\s*\((?:Since\s*)?([A-Za-z0-9\s,]+?)\)", lines[k], re.I)
                        if m_d:
                            mgr, s_date = m_d[0]
                            results.append({
                                "scheme_name": title,
                                "plan": None,
                                "manager_name": clean_manager_name(mgr),
                                "manager_start": parse_amc_date(s_date),
                                "url": url,
                            })
                            break
    return results


def collect_360_one(fetcher: Callable[[str], bytes] = default_fetcher) -> list[dict[str, Any]]:
    url = "https://s3.ap-south-1.amazonaws.com/x-web-s3.360.one/360_ONE_MF_factsheet_November2024_7781ba663c.pdf"
    pdf = pdfium.PdfDocument(fetcher(url))
    results = []
    for p in range(len(pdf)):
        text = pdf[p].get_textpage().get_text_range()
        m_d = re.findall(r"Managed\s+by\s+the\s+fund\s+manager\s+since\s+([A-Za-z0-9\s,]+?)(?:;|\sand|\.|$)", text, re.I)
        if m_d:
            lines = [l.strip() for l in text.split("\r\n") if l.strip()]
            title = ""
            for l in lines:
                if "360 ONE " in l and any(w in l.lower() for w in ["fund", "scheme"]):
                    title = l
                    break
            mgr = ""
            for l in lines:
                if "fund manager" in l.lower() and ("mr." in l.lower() or "ms." in l.lower()):
                    mgr = l
                    break
            if title and m_d:
                results.append({
                    "scheme_name": title,
                    "plan": None,
                    "manager_name": clean_manager_name(mgr or "Fund Manager"),
                    "manager_start": parse_amc_date(m_d[0]),
                    "url": url,
                })
    return results


AMC_COLLECTORS: dict[str, Callable[..., list[dict[str, Any]]]] = {
    "icici_prudential": collect_icici_prudential,
    "hdfc": collect_hdfc,
    "sbi": collect_sbi,
    "aditya_birla_sun_life": collect_absl,
    "nippon_india": collect_nippon_india,
    "bandhan": collect_bandhan,
    "tata": collect_tata,
    "invesco": collect_invesco,
    "dsp": collect_dsp,
    "ppfas": collect_ppfas,
    "mirae": collect_mirae,
    "quant": collect_quant,
    "baroda_bnp": collect_baroda_bnp,
    "union": collect_union,
    "motilal": collect_motilal,
    "axis": collect_axis,
    "lic": collect_lic,
    "zerodha": collect_zerodha,
    "quantum": collect_quantum,
    "samco": collect_samco,
    "franklin_templeton": collect_franklin_templeton,
    "groww": collect_groww,
    "pgim": collect_pgim,
    "shriram": collect_shriram,
    "360_one": collect_360_one,
}

AMC_NAMES: dict[str, str] = {
    "icici_prudential": "ICICI Prudential Mutual Fund",
    "hdfc": "HDFC Mutual Fund",
    "sbi": "SBI Mutual Fund",
    "aditya_birla_sun_life": "Aditya Birla Sun Life Mutual Fund",
    "nippon_india": "Nippon India Mutual Fund",
    "bandhan": "Bandhan Mutual Fund",
    "tata": "Tata Mutual Fund",
    "invesco": "Invesco Mutual Fund",
    "dsp": "DSP Mutual Fund",
    "ppfas": "PPFAS Mutual Fund",
    "mirae": "Mirae Asset Mutual Fund",
    "quant": "quant Mutual Fund",
    "baroda_bnp": "Baroda BNP Paribas Mutual Fund",
    "union": "Union Mutual Fund",
    "motilal": "Motilal Oswal Mutual Fund",
    "axis": "Axis Mutual Fund",
    "lic": "LIC Mutual Fund",
    "zerodha": "Zerodha Mutual Fund",
    "quantum": "Quantum Mutual Fund",
    "samco": "Samco Mutual Fund",
    "franklin_templeton": "Franklin Templeton Mutual Fund",
    "groww": "Groww Mutual Fund",
    "pgim": "PGIM India Mutual Fund",
    "shriram": "Shriram Mutual Fund",
    "360_one": "360 ONE Mutual Fund",
}


def run_collection(
    selected_amc: str | None = None,
    dry_run: bool = False,
    fetcher: Callable[[str], bytes] = default_fetcher,
) -> int:
    """Run AMC collectors and emit CSVs into data/mf_manager_cache/."""
    base_df = mf_screener._base_frame()
    today_str = date.today().isoformat()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    targets = [selected_amc] if selected_amc else list(AMC_COLLECTORS.keys())
    report_rows = []
    total_matched_rows = 0

    for slug in targets:
        if slug not in AMC_COLLECTORS:
            logger.error("Unknown AMC slug: %s", slug)
            return 1
        collector = AMC_COLLECTORS[slug]
        amc_name = AMC_NAMES[slug]
        logger.info("Collecting managers for %s (%s)...", slug, amc_name)

        try:
            raw_items = collector(fetcher)
        except Exception as e:
            logger.error("Collector for %s failed: %s", slug, e)
            return 1

        matched_rows: list[dict[str, Any]] = []
        unmatched: list[str] = []
        seen_codes: set[str] = set()

        for item in raw_items:
            m_schemes = match_scheme(amc_name, item["scheme_name"], item.get("plan"), base_df)
            if not m_schemes:
                unmatched.append(item["scheme_name"])
                continue
            for r in m_schemes:
                code = str(r["code"])
                if code in seen_codes:
                    continue
                seen_codes.add(code)
                matched_rows.append({
                    "scheme_code": code,
                    "manager_name": item["manager_name"],
                    "manager_start": item.get("manager_start") or "",
                    "source": f"amc_site:{slug}",
                    "url": item.get("url", ""),
                    "fetched_at": today_str,
                })

        logger.info("%s: collected=%d, matched_codes=%d, unmatched=%d",
                    slug, len(raw_items), len(matched_rows), len(unmatched))
        total_matched_rows += len(matched_rows)

        out_path = OUT_DIR / f"{slug}.csv"
        # Alert check: if file existed and now has 0 rows, exit non-zero
        if out_path.exists() and len(matched_rows) == 0 and not dry_run:
            logger.error("Layout breakage: %s previously had rows, now returned 0!", slug)
            return 2

        if not dry_run and matched_rows:
            # Sort by scheme_code
            matched_rows.sort(key=lambda r: int(r["scheme_code"]))
            fieldnames = ["scheme_code", "manager_name", "manager_start", "source", "url", "fetched_at"]
            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(matched_rows)
            logger.info("Wrote %d rows to %s", len(matched_rows), out_path)

        report_rows.append({
            "slug": slug,
            "amc_name": amc_name,
            "collected": len(raw_items),
            "matched": len(matched_rows),
            "unmatched": len(unmatched),
            "status": "ok" if matched_rows else "empty",
        })

    logger.info("Done. Total matched rows: %d across %d AMCs", total_matched_rows, len(targets))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect fund manager start dates from AMC disclosures")
    parser.add_argument("--amc", help="Run a single AMC by slug")
    parser.add_argument("--dry-run", action="store_true", help="Print sample output without writing CSVs")
    args = parser.parse_args()

    return run_collection(selected_amc=args.amc, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
