"""Staff market desk: fetch public market pages and serve them on this origin.

Links stay under Fund Horizon. Chrome, wordmark and third-party names are stripped.
Scripts are dropped so their JS never runs on our origin.
"""

from __future__ import annotations

import re
from datetime import datetime
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from fastapi.responses import Response

UPSTREAM = "https://tipsheet.markets"
PAGE_PREFIX = "/backoffice/markets"
ASSET_PREFIX = "/api/backoffice/markets"
TIMEOUT = 20
_MAX = 8 * 1024 * 1024

_ATTR = re.compile(
    r'(?P<pre>\b(?:href|src|action|poster|cite)\s*=\s*)(?P<q>["\'])(?P<url>.*?)(?P=q)',
    re.I | re.S,
)
_CSS_URL = re.compile(r'url\(\s*(["\']?)(?P<url>[^)\'"]+)\1\s*\)', re.I)
_FONT_FACE = re.compile(r"@font-face\s*\{.*?\}", re.S | re.I)
_SCRIPT = re.compile(r"<script\b[^>]*>.*?</script>", re.S | re.I)
_STYLE = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
_BODY = re.compile(r"<body\b[^>]*>(.*)</body>", re.S | re.I)
_BLOCK = re.compile(
    r"<(header|footer|nav)\b[^>]*class=\"[^\"]*(?:mast|foot|sstrip)[^\"]*\"[^>]*>.*?</\1>",
    re.S | re.I,
)
_SKIP = re.compile(r'<a\b[^>]*class="[^"]*\bskip\b[^"]*"[^>]*>.*?</a>', re.S | re.I)
_ONATTR = re.compile(r"\s+on[a-z]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_BRAND = re.compile(r"tipsheet(?:\.markets)?", re.I)
_BRAND_TEXT = re.compile(r">[^<]+<")
_FONT_VARS = re.compile(r"(--(?:sans|display|serif|mono)\s*:)[^;]+")
_FONT_FAMILY = re.compile(r"font-family\s*:\s*[^;}]+", re.I)


def safe_path(path: str) -> str:
    path = (path or "").lstrip("/")
    if ".." in path.split("/") or path.startswith("\\"):
        raise HTTPException(400, "Invalid path.")
    return path


def classify(url_path: str) -> str:
    last = url_path.rstrip("/").rsplit("/", 1)[-1]
    if "." in last and not last.endswith(".html"):
        return ASSET_PREFIX
    return PAGE_PREFIX


def rebase(url: str) -> str:
    url = (url or "").strip()
    if not url or url[0] in "#?" or url.startswith(("mailto:", "javascript:", "data:", "blob:", "tel:")):
        return url
    if url.startswith(PAGE_PREFIX) or url.startswith(ASSET_PREFIX):
        return url
    for origin in (UPSTREAM, UPSTREAM.replace("https://", "http://")):
        if url.startswith(origin):
            url = url[len(origin) :] or "/"
            break
    if url.startswith("//"):
        host = url[2:].split("/", 1)[0].lower()
        if host == "tipsheet.markets" or host.endswith(".tipsheet.markets"):
            url = url[2 + len(host) :] or "/"
        else:
            return url
    if not url.startswith("/"):
        return url
    return classify(url) + url


def _rebase_attr(m: re.Match[str]) -> str:
    return f"{m.group('pre')}{m.group('q')}{rebase(m.group('url'))}{m.group('q')}"


def rewrite_urls(text: str) -> str:
    text = _ATTR.sub(_rebase_attr, text)
    text = _CSS_URL.sub(lambda m: f"url({rebase(m.group('url'))})", text)
    return text


def _scrub_brand_text(html: str) -> str:
    def repl(m: re.Match[str]) -> str:
        inner = m.group(0)[1:-1]
        inner = _BRAND.sub("", inner)
        inner = re.sub(r"[ \t]{2,}", " ", inner)
        inner = re.sub(r"\s+([,.;:])", r"\1", inner)
        return f">{inner}<"

    return _BRAND_TEXT.sub(repl, html)


def _hide_chrome(html: str) -> str:
    html = _SCRIPT.sub("", html)
    html = _BLOCK.sub("", html)
    html = _SKIP.sub("", html)
    html = _ONATTR.sub("", html)
    html = re.sub(r"<title>[^<]*</title>", "<title>Market overview</title>", html, count=1, flags=re.I)
    return html


def split_document(html: str) -> tuple[str, str]:
    html = _hide_chrome(html)
    styles = "".join(_STYLE.findall(html))
    styles = _FONT_FACE.sub("", styles)
    styles = re.sub(r":root\b", ":host", styles)
    styles = re.sub(r"(?<![.#\w-])(?:html|body)(?![#\w-])", ":host", styles)
    styles = _FONT_VARS.sub(r"\1 var(--font-google-sans)", styles)
    styles = _FONT_FAMILY.sub("font-family: var(--font-google-sans)", styles)
    styles += (
        ".mast,.sstrip,.foot,.wordmark,.skip,.links,.menu,.mast-small,.sec-sheet,.menu-sheet,.foot-brand,.foot-base"
        "{display:none!important}"
        ":host{display:block;background:var(--paper);color:var(--ink)}"
        ":host,:host *,:host *::before,:host *::after"
        "{font-family:var(--font-google-sans)!important}"
    )
    body = _BODY.search(html)
    inner = body.group(1) if body else html
    inner = _STYLE.sub("", inner)
    inner = _SCRIPT.sub("", inner)
    inner = _BLOCK.sub("", inner)
    inner = _SKIP.sub("", inner)
    inner = rewrite_urls(inner)
    inner = _scrub_brand_text(inner)
    styles = rewrite_urls(styles)
    return styles, inner


def fetch_upstream(path: str, query: str = "") -> tuple[int, str, bytes]:
    path = safe_path(path)
    url = f"{UPSTREAM}/{path}"
    if query:
        url = f"{url}?{query}"
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "tipsheet.markets":
        raise HTTPException(400, "Invalid upstream.")
    req = Request(url, headers={"User-Agent": "FundHorizon/market-desk", "Accept": "*/*"})
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            data = resp.read(_MAX + 1)
            if len(data) > _MAX:
                raise HTTPException(502, "Upstream too large.")
            ctype = resp.headers.get("Content-Type", "application/octet-stream")
            return resp.status, ctype, data
    except HTTPError as e:
        data = e.read(_MAX) if e.fp else b""
        ctype = e.headers.get("Content-Type", "application/octet-stream") if e.headers else "text/plain"
        return e.code, ctype, data
    except URLError as e:
        raise HTTPException(502, f"Upstream unavailable: {e.reason}") from e


def is_asset(path: str) -> bool:
    last = (path or "").rstrip("/").rsplit("/", 1)[-1]
    return "." in last and not last.endswith(".html")


def query_string(params: dict[str, str]) -> str:
    clean = {k: v for k, v in params.items() if k not in ("desk", "format")}
    return urlencode(clean)


def json_payload(path: str, query: str) -> dict[str, str]:
    status, ctype, data = fetch_upstream(path, query)
    if status >= 400:
        raise HTTPException(status, "Market page unavailable.")
    if "html" not in ctype.lower():
        raise HTTPException(415, "Not a page.")
    html = data.decode("utf-8", errors="replace")
    css, body = split_document(html)
    return {"css": css, "html": body}


def asset_response(path: str, query: str) -> Response:
    status, ctype, data = fetch_upstream(path, query)
    if "html" in ctype.lower() or "javascript" in ctype.lower() or "css" in ctype.lower() or "json" in ctype.lower():
        text = data.decode("utf-8", errors="replace")
        if "javascript" in ctype.lower():
            text = text.replace(UPSTREAM, "")
            text = re.sub(r'(["\'])/(?!/|backoffice/markets|api/backoffice/markets)', rf"\1{ASSET_PREFIX}/", text)
        elif "html" in ctype.lower():
            text = _hide_chrome(text)
            text = rewrite_urls(text)
            text = _scrub_brand_text(text)
        else:
            text = rewrite_urls(text)
        data = text.encode("utf-8")
    return Response(content=data, status_code=status, media_type=ctype.split(";")[0].strip() or None)


_SHEET_BAD = re.compile(r"[\[\]:*?/\\]")
_PCT = re.compile(r"^([+\-−–])?(\d+(?:\.\d+)?)\s*%$")
_NUM = re.compile(r"^([+\-−–])?(\d+(?:\.\d+)?)$")
_FONT = "Google Sans"


def _cell_text(cell) -> str:
    for tag in cell.find_all(["svg", "img", "button", "script", "style"]):
        tag.decompose()
    return re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()


def _coerce(value: str):
    text = (value or "").strip().replace(",", "")
    if not text:
        return "", None
    pct = _PCT.match(text)
    if pct:
        sign = -1 if pct.group(1) in ("-", "−", "–") else 1
        return sign * float(pct.group(2)) / 100.0, "0.0%"
    num = _NUM.match(text)
    if num and len(text) <= 16:
        sign = -1 if num.group(1) in ("-", "−", "–") else 1
        n = sign * float(num.group(2))
        if n == int(n) and abs(n) < 1_000_000_000:
            return int(n), None
        return n, None
    return value.strip(), None


def _sheet_name(raw: str, used: set[str]) -> str:
    name = _SHEET_BAD.sub("", raw or "").strip() or "Sheet"
    name = name[:31]
    base = name
    n = 2
    while name.lower() in used:
        suffix = f" {n}"
        name = (base[: 31 - len(suffix)] + suffix).strip()
        n += 1
    used.add(name.lower())
    return name


def _table_title(table, index: int) -> str:
    heading = ""
    for prev in table.find_all_previous(["h1", "h2", "h3", "h4"], limit=12):
        heading = prev.get_text(" ", strip=True)
        if heading:
            break
    cap = table.find("caption")
    caption = cap.get_text(" ", strip=True) if cap else ""
    if heading:
        return heading
    if caption:
        return caption.split(".")[0].strip() or caption
    return f"Table {index}"


def extract_tables(html: str) -> list[tuple[str, list[list[str]]]]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    sheets: list[tuple[str, list[list[str]]]] = []
    for i, table in enumerate(soup.find_all("table"), 1):
        if table.find_parent("table"):
            continue
        rows: list[list[str]] = []
        for tr in table.find_all("tr"):
            if tr.find_parent("table") is not table and tr.find_parent("table") is not None:
                continue
            cells = [_cell_text(c) for c in tr.find_all(["th", "td"], recursive=False)]
            if not cells:
                cells = [_cell_text(c) for c in tr.find_all(["th", "td"])]
            if any(c for c in cells):
                rows.append(cells)
        if len(rows) < 2:
            continue
        sheets.append((_table_title(table, i), rows))
        if len(sheets) >= 40:
            break
    return sheets


def build_xlsx(sheets: list[tuple[str, list[list[str]]]]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    if not sheets:
        raise HTTPException(404, "No tables on this page.")
    wb = Workbook()
    used: set[str] = set()
    for i, (title, rows) in enumerate(sheets):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = _sheet_name(title, used)
        header_font = Font(name=_FONT, bold=True)
        body_font = Font(name=_FONT)
        for r_i, row in enumerate(rows, start=1):
            for c_i, raw in enumerate(row, start=1):
                value, num_fmt = _coerce(raw) if r_i > 1 else (raw, None)
                cell = ws.cell(r_i, c_i, value)
                cell.font = header_font if r_i == 1 else body_font
                cell.alignment = Alignment(wrap_text=False)
                if num_fmt:
                    cell.number_format = num_fmt
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        widths = [0] * max((len(r) for r in rows), default=0)
        for row in rows:
            for c_i, raw in enumerate(row):
                widths[c_i] = max(widths[c_i], min(len(str(raw or "")), 48))
        for c_i, width in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(c_i)].width = min(max(width + 2, 10), 48)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def xlsx_filename(path: str) -> str:
    slug = (path or "overview").strip("/").replace("/", "-") or "overview"
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", slug).strip("-")[:60] or "overview"
    day = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y%m%d")
    return f"markets-{slug}-{day}.xlsx"


def xlsx_response(path: str, query: str = "") -> Response:
    status, ctype, data = fetch_upstream(path, query)
    if status >= 400:
        raise HTTPException(status, "Market page unavailable.")
    if "html" not in ctype.lower():
        raise HTTPException(415, "Not a page.")
    html = data.decode("utf-8", errors="replace")
    _, body = split_document(html)
    payload = build_xlsx(extract_tables(body))
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{xlsx_filename(path)}"',
            "Cache-Control": "private, no-store",
        },
    )
