import base64
import io

import pytest
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from app.report.pdf_fill import PdfFillError, apply_edits

def _png() -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (8, 4), (0, 0, 0, 255)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


PNG = _png()


def _pdf(rotate: int = 0) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(300, 400))
    c.drawString(20, 380, "SAMPLE FORM")
    c.save()
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(buf.getvalue())))
    if rotate:
        w.pages[0].rotate(rotate)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def test_text_marks_signature_and_whiteout_are_drawn_in_google_sans():
    edits = [
        {"page": 0, "type": "text", "x": 20, "y": 60, "w": 100, "h": 14, "text": "Ravi Kumar", "size": 12},
        {"page": 0, "type": "check", "x": 20, "y": 100, "w": 12, "h": 12},
        {"page": 0, "type": "signature", "x": 20, "y": 150, "w": 80, "h": 30, "dataUrl": PNG},
        {"page": 0, "type": "whiteout", "x": 15, "y": 10, "w": 120, "h": 20},
    ]
    out = apply_edits(_pdf(), edits)
    page = PdfReader(io.BytesIO(out)).pages[0]
    assert "Ravi Kumar" in page.extract_text()
    fonts = {str(f.get_object().get("/BaseFont")) for f in page["/Resources"]["/Font"].values()}
    assert any("GoogleSans" in f for f in fonts), fonts  # the typed text uses Google Sans


def test_bad_inputs_are_rejected_with_a_readable_message():
    with pytest.raises(PdfFillError, match="not a readable PDF"):
        apply_edits(b"not a pdf", [])
    with pytest.raises(PdfFillError, match="does not exist"):
        apply_edits(_pdf(), [{"page": 5, "type": "dot", "x": 0, "y": 0, "w": 5, "h": 5}])
    with pytest.raises(PdfFillError, match="rotated"):
        apply_edits(_pdf(90), [{"page": 0, "type": "dot", "x": 0, "y": 0, "w": 5, "h": 5}])
    with pytest.raises(PdfFillError, match="Unknown edit"):
        apply_edits(_pdf(), [{"page": 0, "type": "script", "x": 0, "y": 0, "w": 5, "h": 5}])


def test_endpoints_proxy_catalogue_only_and_fill_an_upload(client):
    from tests.test_backoffice_api import _create_staff, _login_staff

    _login_staff(client, _create_staff())
    assert client.get("/api/backoffice/operations/official-forms/pdf", params={"url": "https://evil.example/x.pdf"}).status_code == 404
    r = client.post(
        "/api/backoffice/operations/pdf-fill",
        files={"file": ("f.pdf", _pdf(), "application/pdf")},
        data={"edits": '[{"page":0,"type":"text","x":20,"y":60,"w":100,"h":14,"text":"Hello","size":12}]', "filename": "my form"},
    )
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert "Hello" in PdfReader(io.BytesIO(r.content)).pages[0].extract_text()
    assert 'my_form.pdf' in r.headers["content-disposition"]
    bad = client.post("/api/backoffice/operations/pdf-fill", files={"file": ("f.pdf", b"nope", "application/pdf")}, data={"edits": "[]"})
    assert bad.status_code == 422


def test_comb_field_puts_one_character_in_each_cell_and_covers_hints():
    # a 120pt wide, 14pt tall field with 8 cells (e.g. a DD MM YYYY date box)
    edit = {"page": 0, "type": "field", "x": 100, "y": 50, "w": 120, "h": 14, "text": "16091999", "comb": 8, "size": 9}
    page = PdfReader(io.BytesIO(apply_edits(_pdf(), [edit]))).pages[0]
    xs: list[float] = []

    def visit(text, cm, tm, font_dict, font_size):
        if text.strip() and text.strip() in "16091999":
            xs.append(tm[4] * cm[0] + cm[4])

    page.extract_text(visitor_text=visit)
    assert len(xs) == 8
    gaps = [b - a for a, b in zip(xs, xs[1:])]
    assert all(abs(g - 15.0) < 1.0 for g in gaps), gaps  # 120 / 8 cells
    assert 100 < xs[0] < 115 and xs[-1] < 220


def test_field_text_respects_alignment_inside_its_rectangle():
    edit = {"page": 0, "type": "field", "x": 100, "y": 50, "w": 100, "h": 14, "text": "Centre", "align": 1}
    page = PdfReader(io.BytesIO(apply_edits(_pdf(), [edit]))).pages[0]
    seen = []
    page.extract_text(visitor_text=lambda t, cm, tm, f, s: seen.append((t, tm[4] * cm[0] + cm[4])) if "Centre" in t else None)
    assert seen and 125 < seen[0][1] < 160  # starts left of the middle (150), ends right of it
