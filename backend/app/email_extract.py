"""Read an uploaded document and suggest the client, document type, subject and message for the email composer.

Free and local: pypdf for text PDFs, RapidOCR (already a dependency) for scans/images. No network, no LLM.
"""
from __future__ import annotations

import io
import re
import zipfile
from functools import lru_cache

MAX_CHARS = 6000  # headers carry everything we need; keeps OCR/regex fast
OCR_PAGES = 2

# (label, keywords) - first label with a hit wins, so order is most specific first.
DOC_TYPES: list[tuple[str, tuple[str, ...]]] = [
    ("Capital gains statement", ("capital gain", "realised gain", "realized gain")),
    ("Consolidated account statement", ("consolidated account statement", "cas ", "nsdl", "cdsl")),
    ("Portfolio valuation", ("portfolio valuation", "valuation report", "portfolio report")),
    ("Account statement", ("statement of account", "account statement", "transaction statement")),
    ("KYC document", ("kyc", "know your customer", "aadhaar", "pan card", "permanent account number")),
    ("Invoice", ("invoice", "tax invoice")),
    ("Portfolio summary", ("mf summary", "portfolio summary", "summary report")),
    ("Portfolio factsheet", ("factsheet", "fact sheet")),
    ("Application form", ("application form", "mandate form", "nomination")),
]
NAME_RE = re.compile(
    r"(?i:investor|client|account holder|name of (?:the )?(?:investor|holder)|holder|dear|name)(?i:\s*name)?[ \t]*[:\-]?[ \t]*"
    r"((?i:mr|mrs|ms|shri|smt|dr)\.?[ \t]+)?([A-Z][A-Za-z.']+(?:[ \t]+[A-Z][A-Za-z.']+){0,3})"
)
# Layouts seen in the wild: "Account: 100537 - NAME - CODE" (PMS) and a name line right above "(PAN)" (MF summary).
ACCOUNT_RE = re.compile(r"Account:?[ \t]*\w+[ \t]*-[ \t]*([A-Za-z][A-Za-z .']+?)[ \t]*-")
PAN_RE = re.compile(r"^([A-Za-z][A-Za-z .']{2,60}?)[ \t]*\n[ \t]*\(?[A-Z]{5}\d{4}[A-Z]\)?", re.M)
PERIOD_RE = re.compile(
    r"(?:as\s*on|as\s*of|for the (?:month|period|year)(?: of| ended)?|period)\s*[:\-]?\s*"
    r"(\d{1,2}[-/ .][A-Za-z0-9]{1,9}[-/ .]\d{2,4}|[A-Za-z]{3,9}\s+\d{4})",
    re.I,
)
_STOP = {"name", "investor", "client", "statement", "account", "folio", "pan", "email", "address", "date"}


@lru_cache(maxsize=1)
def _ocr():
    from rapidocr_onnxruntime import RapidOCR  # heavy import: only when a scan/image shows up

    return RapidOCR()


def _ocr_image(img) -> str:
    import numpy as np

    res, _ = _ocr()(np.asarray(img.convert("RGB")))
    text = "\n".join(r[1] for r in res or [])
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)  # OCR often drops the space between words


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        r = PdfReader(io.BytesIO(data))
        if r.is_encrypted:
            return ""  # password-protected: the user fills the fields by hand
        text = "\n".join((p.extract_text() or "") for p in r.pages[:OCR_PAGES])
    except Exception:  # noqa: BLE001 - corrupt PDF falls through to OCR
        text = ""
    if len(text.strip()) >= 40:
        return text
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
        return "\n".join(_ocr_image(pdf[i].render(scale=1.5).to_pil()) for i in range(min(len(pdf), OCR_PAGES)))
    except Exception:  # noqa: BLE001 - unreadable file: no suggestions
        return ""


def extract_text(name: str, data: bytes) -> str:
    ext = name.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        text = _pdf_text(data)
    elif ext in {"png", "jpg", "jpeg"}:
        from PIL import Image

        text = _ocr_image(Image.open(io.BytesIO(data)))
    elif ext == "docx":
        try:
            xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf8", "ignore")
            text = re.sub(r"<[^>]+>", " ", xml.replace("</w:p>", "\n"))
        except (zipfile.BadZipFile, KeyError):
            text = ""
    elif ext in {"txt", "csv"}:
        text = data.decode("utf8", "ignore")
    else:
        text = ""  # xlsx/xls: tabular, nothing reliable to read a client from
    return text[:MAX_CHARS]


def suggest(name: str, text: str) -> dict:
    # the filename is the stronger signal (a factsheet can mention "portfolio summary" in its body)
    doc_type = next((l for hay in (name.lower(), text.lower()) for l, kws in DOC_TYPES if any(k in hay for k in kws)), None)
    client = next((m.group(1).strip() for r in (ACCOUNT_RE, PAN_RE) if (m := r.search(text))), None) or next(
        (m.group(2).strip() for m in NAME_RE.finditer(text) if m.group(2).split()[0].lower() not in _STOP), None
    )
    period = (m.group(1).strip() if (m := PERIOD_RE.search(text)) else None)
    label = doc_type or re.sub(r"[_\-]+", " ", name.rsplit(".", 1)[0]).strip().title() or "document"
    first = client.split()[0].title() if client else None
    subject = f"Your {label.lower()}" + (f" – {period}" if period else "") + " from Fund Horizon"
    body = (
        f"Hi {{name}},\n\nPlease find your {label.lower()}" + (f" for {period}" if period else "")
        + " attached. Do take a look and tell us if anything looks off.\n\nRegards,\nFund Horizon"
    )
    return {"client_name": client, "first_name": first, "doc_type": doc_type, "period": period,
            "subject": subject, "message": body}
