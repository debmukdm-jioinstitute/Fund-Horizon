"""Rebuild the static Google Sans TTFs used by the PDF reports and matplotlib charts.

Source: @fontsource-variable/google-sans (OFL-1.1) variable woff2 subsets in frontend/node_modules.
Output: backend/app/report/fonts/GoogleSans-{Regular,Bold}.ttf (latin + latin-ext, so the rupee sign is included).
Requires: fonttools, brotli.   Usage: python scripts/build_google_sans_ttf.py
"""
from __future__ import annotations

from pathlib import Path

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend/node_modules/@fontsource-variable/google-sans/files"
OUT = Path(__file__).resolve().parents[1] / "app/report/fonts"
SUBSETS = ("latin", "latin-ext")
WEIGHTS = {"Regular": 400, "Bold": 700}


def build(style: str, wght: int) -> None:
    parts = []
    for sub in SUBSETS:
        font = TTFont(SRC / f"google-sans-{sub}-wght-normal.woff2")
        inst = instantiateVariableFont(font, {"wght": wght}, inplace=False)
        inst.flavor = None
        tmp = OUT / f".{sub}-{style}.ttf"
        inst.save(tmp)
        parts.append(tmp)
    merged = Merger().merge([str(p) for p in parts])
    for rec in merged["name"].names:  # give the merged font a clean, unique identity
        if rec.nameID in (1, 16):
            rec.string = "Google Sans"
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 4:
            rec.string = f"Google Sans {style}"
        elif rec.nameID == 6:
            rec.string = f"GoogleSans-{style}"
    merged.save(OUT / f"GoogleSans-{style}.ttf")
    for p in parts:
        p.unlink()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for style, w in WEIGHTS.items():
        build(style, w)
    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.ttf"))))
