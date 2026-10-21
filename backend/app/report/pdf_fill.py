from __future__ import annotations
from app.db.d1 import on_workers
from fastapi import HTTPException

"""Apply a filled-in form (typed text, marks, signatures, images, whiteout) onto an existing PDF.

Coordinates arrive in PDF points with the origin at the top-left of the page as a viewer shows it (crop box).
Text is drawn in Google Sans, never in the source form's font, so the site-wide typeface rule holds.
"""

import base64
import io
import re
from typing import Any

if not on_workers():
    from pypdf import PdfReader, PdfWriter, Transformation
    from pypdf.generic import ArrayObject, NameObject
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas

from app.report import fonts

MAX_EDITS = 800
MAX_IMAGE_BYTES = 3_000_000
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class PdfFillError(ValueError):
    """The input PDF or an edit cannot be applied; the message is safe to show to the user."""


def _rgb(value: Any) -> tuple[float, float, float]:
    s = value if isinstance(value, str) and _HEX.match(value) else "#0B2545"
    return tuple(int(s[i:i + 2], 16) / 255 for i in (1, 3, 5))  # type: ignore[return-value]


def _image(data_url: Any) -> ImageReader:
    m = re.match(r"^data:image/(png|jpeg|jpg);base64,(.+)$", data_url or "", re.S)
    if not m:
        raise PdfFillError("An image edit is not a PNG or JPEG data URL.")
    raw = base64.b64decode(m.group(2), validate=False)
    if len(raw) > MAX_IMAGE_BYTES:
        raise PdfFillError("An image is larger than 3 MB.")
    return ImageReader(io.BytesIO(raw))


def _full_name(annot: Any) -> str:
    parts, node = [], annot
    while node is not None:
        t = node.get("/T")
        if t is not None:
            parts.append(str(t))
        node = node.get("/Parent")
        node = node.get_object() if node is not None else None
    return ".".join(reversed(parts))


def _draw_field(c: canvas.Canvas, e: dict[str, Any], x: float, by: float, w: float, h: float) -> None:
    """A value typed into a form field: drawn inside the field's own rectangle so it lines up with the printed boxes.

    Comb fields (``comb`` = number of cells) get one character centred in each cell. Any printed hint text under the
    value ("First Name", "D D M M Y Y Y Y") is covered with white, inset so the box borders and dividers survive.
    """
    text = str(e.get("text") or "")[:2000]
    if not text:
        return
    font = fonts.BODY_FONT
    size = min(max(float(e.get("size") or 0) or min(11.0, h * 0.7), 4), 72)
    c.setFillColorRGB(*_rgb(e.get("color")))
    comb = int(e.get("comb") or 0)
    if comb > 0:
        cell = w / comb
        size = min(size, cell * 0.9)
        c.setFont(font, size)
        asc, desc = pdfmetrics.getAscentDescent(font, size)
        base = by + h / 2 - (asc + desc) / 2
        for i, ch in enumerate(text[:comb]):
            c.saveState(); c.setFillColorRGB(1, 1, 1); c.rect(x + i * cell + 1, by + 1, cell - 2, h - 2, stroke=0, fill=1); c.restoreState()
            c.setFillColorRGB(*_rgb(e.get("color")))
            c.drawCentredString(x + (i + 0.5) * cell, base, ch)
        return
    c.saveState(); c.setFillColorRGB(1, 1, 1); c.rect(x + 0.8, by + 0.8, w - 1.6, h - 1.6, stroke=0, fill=1); c.restoreState()
    c.setFillColorRGB(*_rgb(e.get("color")))
    c.setFont(font, size)
    asc, desc = pdfmetrics.getAscentDescent(font, size)
    if e.get("multiline"):
        line = size * 1.2
        for i, t in enumerate(text.split("\n")):
            c.drawString(x + 2, by + h - 2 - asc - i * line, t)
        return
    base = by + h / 2 - (asc + desc) / 2
    align = int(e.get("align") or 0)
    if align == 1:
        c.drawCentredString(x + w / 2, base, text)
    elif align == 2:
        c.drawRightString(x + w - 2, base, text)
    else:
        c.drawString(x + 2, base, text)


def _draw(c: canvas.Canvas, e: dict[str, Any], page_h: float) -> None:
    """Draw one edit. x/y/w/h are top-left based; reportlab is bottom-left based."""
    kind = e.get("type")
    x, y, w, h = (float(e.get(k) or 0) for k in ("x", "y", "w", "h"))
    by = page_h - y - h  # bottom edge
    if kind == "field":
        _draw_field(c, e, x, by, w, h)
    elif kind in ("text", "date"):
        size = min(max(float(e.get("size") or 11), 4), 72)
        font = fonts.BOLD_FONT if e.get("bold") else fonts.BODY_FONT
        asc, desc = pdfmetrics.getAscentDescent(font, size)
        line = size * 1.2
        c.setFillColorRGB(*_rgb(e.get("color")))
        c.setFont(font, size)
        for i, text in enumerate(str(e.get("text") or "")[:2000].split("\n")):
            c.drawString(x, page_h - (y + i * line + (line - (asc - desc)) / 2 + asc), text)
    elif kind in ("check", "cross", "dot", "circle"):
        c.setStrokeColorRGB(*_rgb(e.get("color")))
        c.setFillColorRGB(*_rgb(e.get("color")))
        c.setLineWidth(max(1.0, min(w, h) / 9))
        c.setLineCap(1)
        if kind == "check":
            c.lines([(x + w * .12, by + h * .5, x + w * .4, by + h * .18), (x + w * .4, by + h * .18, x + w * .9, by + h * .85)])
        elif kind == "cross":
            c.lines([(x + w * .15, by + h * .15, x + w * .85, by + h * .85), (x + w * .15, by + h * .85, x + w * .85, by + h * .15)])
        elif kind == "dot":
            c.circle(x + w / 2, by + h / 2, min(w, h) * .3, stroke=0, fill=1)
        else:
            c.ellipse(x + 1, by + 1, x + w - 1, by + h - 1, stroke=1, fill=0)
    elif kind in ("image", "signature"):
        c.drawImage(_image(e.get("dataUrl")), x, by, w, h, mask="auto", preserveAspectRatio=True, anchor="sw")
    elif kind == "whiteout":
        c.setFillColorRGB(1, 1, 1)
        c.rect(x, by, w, h, stroke=0, fill=1)
    else:
        raise PdfFillError(f"Unknown edit type: {kind!r}")


def apply_edits(src: bytes, edits: list[dict[str, Any]], drop_fields: list[str] | None = None) -> bytes:
    """Return ``src`` with ``edits`` drawn on top. Form fields named in ``drop_fields`` are removed (their typed values
    arrive as text/mark edits), so the result looks the same in every viewer."""
    fonts.register()
    if len(edits) > MAX_EDITS:
        raise PdfFillError("Too many edits on one document.")
    try:
        reader = PdfReader(io.BytesIO(src))
        if reader.is_encrypted and not reader.decrypt(""):
            raise PdfFillError("This PDF is password protected. Remove the password first.")
        writer = PdfWriter(clone_from=reader)
    except PdfFillError:
        raise
    except Exception as exc:  # noqa: BLE001 - pypdf raises many types on a corrupt file
        raise PdfFillError("This file is not a readable PDF.") from exc

    by_page: dict[int, list[dict[str, Any]]] = {}
    for e in edits:
        by_page.setdefault(int(e.get("page", -1)), []).append(e)
    if any(p < 0 or p >= len(writer.pages) for p in by_page):
        raise PdfFillError("An edit points to a page that does not exist.")

    drop = set(drop_fields or [])
    for n, page in enumerate(writer.pages):
        if drop and "/Annots" in page:
            page[NameObject("/Annots")] = ArrayObject([a for a in page["/Annots"] if _full_name(a.get_object()) not in drop])
        items = by_page.get(n)
        if not items:
            continue
        if int(page.get("/Rotate", 0)) % 360:
            raise PdfFillError(f"Page {n + 1} is rotated; editing rotated pages is not supported.")
        crop, media = page.cropbox, page.mediabox
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(float(media.width), float(media.height)))
        c.translate(float(crop.left) - float(media.left), float(crop.bottom) - float(media.bottom))
        for e in items:
            _draw(c, e, float(crop.height))
        c.save()
        overlay = PdfReader(io.BytesIO(buf.getvalue())).pages[0]
        page.merge_transformed_page(overlay, Transformation().translate(float(media.left), float(media.bottom)))

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
