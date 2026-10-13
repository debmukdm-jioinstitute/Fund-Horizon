"""Typography for generated documents: Google Sans only (PDF text and matplotlib chart labels).

The static TTFs in ``fonts/`` are built from the OFL-licensed Google Sans variable font by
``scripts/build_google_sans_ttf.py``. Import this module before building any PDF or chart so that the font names
``GS`` / ``GS-B`` are registered with reportlab and matplotlib defaults to Google Sans.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib
from matplotlib import font_manager
from reportlab import rl_config
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus.tables import CellStyle
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = Path(__file__).resolve().parent / "fonts"
REGULAR_TTF = FONT_DIR / "GoogleSans-Regular.ttf"
BOLD_TTF = FONT_DIR / "GoogleSans-Bold.ttf"

BODY_FONT = "GS"
BOLD_FONT = "GS-B"
MATPLOTLIB_FAMILY = "Google Sans"


def register() -> None:
    """Idempotently register Google Sans with reportlab and make it matplotlib's default family."""
    if BODY_FONT not in pdfmetrics.getRegisteredFontNames():
        # A missing font file must fail loudly: silently falling back would break the site-wide typeface rule.
        pdfmetrics.registerFont(TTFont(BODY_FONT, str(REGULAR_TTF)))
        pdfmetrics.registerFont(TTFont(BOLD_FONT, str(BOLD_TTF)))
        pdfmetrics.registerFontFamily(BODY_FONT, normal=BODY_FONT, bold=BOLD_FONT, italic=BODY_FONT, boldItalic=BOLD_FONT)
    # reportlab otherwise declares Helvetica as the document's initial font even when no text uses it.
    rl_config.canvas_basefontname = BODY_FONT
    ParagraphStyle.defaults["fontName"] = BODY_FONT
    ParagraphStyle.defaults["bulletFontName"] = BODY_FONT
    CellStyle.fontname = BODY_FONT  # table cells (e.g. image-only cells) default to Helvetica otherwise
    for ttf in (REGULAR_TTF, BOLD_TTF):
        font_manager.fontManager.addfont(str(ttf))
    matplotlib.rcParams["font.family"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["font.sans-serif"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["font.serif"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["font.monospace"] = [MATPLOTLIB_FAMILY]
    matplotlib.rcParams["axes.unicode_minus"] = False  # plain "-" exists in the font; U+2212 is not needed


register()
