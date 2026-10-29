"""Stress: every supported upload type, in many orders/combinations, plus hostile input, via the real /parse route."""
import io
import itertools
import zipfile

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import crm_core, monthly_report as api
from tests.test_monthly_report import MONTHLY_TEXT, VALUATION_TEXT

app = FastAPI()
app.include_router(api.router)
app.dependency_overrides[crm_core.crm_user] = lambda: {"id": "u1", "role": "admin"}
client = TestClient(app, raise_server_exceptions=False)
URL = "/api/backoffice/monthly-report/parse"


def _docx(text: str) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{ln}</w:t></w:r></w:p>" for ln in text.splitlines())
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="x"><w:body>{body}</w:body></w:document>')
    return b.getvalue()


def _xlsx(text: str) -> bytes:
    wb = openpyxl.Workbook()
    for ln in text.splitlines():
        wb.active.append(ln.split("   ") if "   " in ln else [ln])
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def _pdf(text: str) -> bytes:
    from reportlab.pdfgen import canvas

    b = io.BytesIO()
    c = canvas.Canvas(b)
    y = 800
    for ln in text.splitlines():
        c.drawString(30, y, ln)
        y -= 14
    c.save()
    return b.getvalue()


def _csv(text: str) -> bytes:
    return "\n".join(",".join(f'"{p}"' for p in ln.split("   ")) for ln in text.splitlines()).encode()


# monthly text is space-separated: keep each row as one cell so every format yields the same lines
FORMATS = {
    "txt": ("m.txt", lambda t: t.encode()),
    "md": ("m.md", lambda t: t.encode()),
    "html": ("m.html", lambda t: ("<html><body>" + "".join(f"<p>{ln}</p>" for ln in t.splitlines()) + "</body></html>").encode()),
    "docx": ("m.docx", _docx),
    "xlsx": ("m.xlsx", _xlsx),
    "csv": ("m.csv", lambda t: "\n".join(f'"{ln}"' for ln in t.splitlines()).encode()),
    "pdf": ("m.pdf", _pdf),
    "utf16": ("m16.txt", lambda t: t.encode("utf-16")),
    "noext": ("report", lambda t: t.encode()),
}


def post(files):
    return client.post(URL, files=[("files", (n, d, "application/octet-stream")) for n, d in files])


@pytest.mark.parametrize("fmt", FORMATS)
def test_monthly_report_in_every_format(fmt):
    name, mk = FORMATS[fmt]
    r = post([(name, mk(MONTHLY_TEXT))])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["file_results"][0]["kind"] == "monthly", d["file_results"]
    assert len(d["buckets"]) == 6 and d["client"]["name"] == "A B Test"


@pytest.mark.parametrize("a,b", itertools.permutations(FORMATS, 2))
def test_any_two_formats_any_order(a, b):
    # monthly in format a + valuation in format b -> both recognised, whatever the order
    files = [(f"1_{FORMATS[a][0]}", FORMATS[a][1](MONTHLY_TEXT)), (f"2_{FORMATS[b][0]}", FORMATS[b][1](VALUATION_TEXT))]
    for order in (files, files[::-1]):
        r = post(order)
        assert r.status_code == 200, r.text
        kinds = sorted(x["kind"] for x in r.json()["file_results"])
        assert kinds == ["monthly", "valuation"], (a, b, r.json()["file_results"], r.json()["warnings"])


def test_ten_mixed_files_at_once():
    files = [(f"{i}_{FORMATS[f][0]}", FORMATS[f][1](MONTHLY_TEXT if i == 0 else VALUATION_TEXT)) for i, f in enumerate(FORMATS)]
    r = post(files)
    assert r.status_code == 200 and len(r.json()["file_results"]) == 9
    assert all(x["kind"] != "error" for x in r.json()["file_results"])


BAD = {
    "empty": ("e.pdf", b""),
    "random_bin": ("x.bin", bytes(range(256)) * 40),
    "truncated_pdf": ("t.pdf", _pdf(MONTHLY_TEXT)[:200]),
    "pdf_named_txt": ("p.txt", _pdf(MONTHLY_TEXT)),
    "docx_named_pdf": ("d.pdf", _docx(MONTHLY_TEXT)),
    "text_named_xlsx": ("t.xlsx", MONTHLY_TEXT.encode()),
    "bad_zip": ("z.docx", b"PK\x03\x04garbage"),
    "plain_zip": ("a.zip", (lambda b: (zipfile.ZipFile(b, "w").writestr("a.txt", "x"), b.getvalue())[1])(io.BytesIO())),
    "legacy_doc": ("o.doc", b"\xd0\xcf\x11\xe0" + b"\0" * 600),
    "fake_png": ("i.png", b"\x89PNG not really"),
    "unicode_name": ("रिपोर्ट ✓ \"q\" ..\\..\\x.txt", MONTHLY_TEXT.encode()),
    "huge_line": ("h.txt", b"9" * 3_000_000),
}


@pytest.mark.parametrize("key", BAD)
def test_hostile_input_never_500s_and_says_why(key):
    name, data = BAD[key]
    r = post([(name, data)])
    assert r.status_code == 200, (key, r.status_code, r.text[:300])
    fr = r.json()["file_results"][0]
    if key in ("pdf_named_txt", "docx_named_pdf", "unicode_name", "text_named_xlsx"):
        assert fr["kind"] == "monthly", fr  # content sniffed, extension ignored
    else:
        assert fr["kind"] in ("error", "unrecognised"), fr
        assert r.json()["warnings"], "user must be told why"


def test_encrypted_pdf_says_password():
    from pypdf import PdfReader, PdfWriter

    w = PdfWriter()
    w.append(PdfReader(io.BytesIO(_pdf(MONTHLY_TEXT))))
    w.encrypt("secret")
    b = io.BytesIO()
    w.write(b)
    r = post([("locked.pdf", b.getvalue())])
    assert r.status_code == 200 and "password" in r.json()["file_results"][0]["error"].lower()


def test_one_bad_file_does_not_poison_the_batch():
    files = [("good.md", MONTHLY_TEXT.encode()), ("bad.pdf", b""), ("val.docx", _docx(VALUATION_TEXT)), ("junk.bin", b"\x00\x01" * 900)]
    r = post(files)
    kinds = {x["name"]: x["kind"] for x in r.json()["file_results"]}
    assert kinds["good.md"] == "monthly" and kinds["val.docx"] == "valuation" and kinds["bad.pdf"] == "error" and kinds["junk.bin"] == "error"


def test_limits_are_clean_422s():
    assert post([(f"{i}.txt", b"x") for i in range(11)]).status_code == 422
    assert client.post(URL).status_code == 422
    assert post([("big.txt", b"x" * (15 * 1024 * 1024 + 1))]).status_code == 422


def test_duplicate_names_and_repeat_uploads():
    files = [("same.md", MONTHLY_TEXT.encode()), ("same.md", VALUATION_TEXT.encode())]
    assert post(files).status_code == 200
    for _ in range(5):
        assert post([("same.md", MONTHLY_TEXT.encode())]).status_code == 200


def test_scanned_image_goes_through_ocr():
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1500, 560), "white")
    d = ImageDraw.Draw(img)
    f = ImageFont.load_default(size=26)
    for i, ln in enumerate(MONTHLY_TEXT.splitlines()):
        d.text((20, 10 + i * 30), ln, fill="black", font=f)
    b = io.BytesIO()
    img.save(b, "PNG")
    r = post([("scan.png", b.getvalue()), ("scan_noext", b.getvalue())])
    assert r.status_code == 200, r.text
    assert all(x["method"] == "ocr" and "error" not in x for x in r.json()["file_results"]), r.json()["file_results"]
