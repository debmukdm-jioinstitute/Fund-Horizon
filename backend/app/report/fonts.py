from __future__ import annotations
"""Typography for generated documents: Google Sans only (PDF text and matplotlib chart labels)."""

from pathlib import Path
from app.db.d1 import on_workers
from fastapi import HTTPException

FONT_DIR = Path(__file__).resolve().parent / "fonts"
REGULAR_TTF = FONT_DIR / "GoogleSans-Regular.ttf"
BOLD_TTF = FONT_DIR / "GoogleSans-Bold.ttf"

BODY_FONT = "GS"
BOLD_FONT = "GS-B"
MATPLOTLIB_FAMILY = "Google Sans"

if not on_workers():
    try:
        import matplotlib
        from matplotlib import font_manager
        from reportlab import rl_config
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus.tables import CellStyle
    except ImportError:
        pass


def register() -> None:
    """Idempotently register Google Sans with reportlab and make it matplotlib default family."""
    if on_workers():
        raise HTTPException(503, detail={"error": "runs_offline"})

    if BODY_FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(BODY_FONT, str(REGULAR_TTF)))
        pdfmetrics.registerFont(TTFont(BOLD_FONT, str(BOLD_TTF)))
        pdfmetrics.registerFontFamily(BODY_FONT, normal=BODY_FONT, bold=BOLD_FONT, italic=BODY_FONT, boldItalic=BOLD_FONT)

    rl_config.canvas_basefontname = BODY_FONT
    ParagraphStyle.defaults["fontName"] = BODY_FONT
    ParagraphStyle.defaults["bulletFontName"] = BODY_FONT
    CellStyle.fontname = BODY_FONT
    for ttf in (REGULAR_TTF, BOLD_TTF):
        font_manager.fontManager.addfont(str(ttf))
    matplotlib.rcParams["font.family"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["font.sans-serif"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["font.serif"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["font.monospace"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["axes.unicode_minus"] = False


if not on_workers():
    try:
        register()
    except Exception:
        pass
