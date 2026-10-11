"""Generates the README illustrations (SVG). Style follows Ian's "Xiaohei" illustration guide
(https://github.com/helloianneo/ian-xiaohei-illustrations, MIT): white background, thin wobbly black
line, a small solid-black character with white eyes, sparse red / orange / blue handwritten notes.
Render to PNG with render.mjs. Run: python3 build.py
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "images"
K, R, O, B = "#111", "#D93025", "#EE7B14", "#1A6FE0"
FONT = "'Bradley Hand','Segoe Print','Comic Sans MS','Marker Felt',cursive"

DEFS = f"""<defs>
<filter id="w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="4"/>
<feDisplacementMap in="SourceGraphic" scale="4"/></filter>
<marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round"/></marker>
</defs>"""


def svg(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">'
            f'<rect width="1600" height="900" fill="#fff"/>{DEFS}{body}</svg>')


def t(x, y, s, color=K, size=34, anchor="middle", weight="bold", rot=0):
    r = f' transform="rotate({rot} {x} {y})"' if rot else ""
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (f'<text x="{x}" y="{y}" fill="{color}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" text-anchor="{anchor}"{r}>{s}</text>')


def line(x1, y1, x2, y2, c=K, w=3.5, arrow=False):
    m = ' marker-end="url(#ah)"' if arrow else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{w}" stroke-linecap="round"{m}/>'


def path(d, c=K, w=3.5, fill="none", arrow=False):
    m = ' marker-end="url(#ah)"' if arrow else ""
    return f'<path d="{d}" fill="{fill}" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"{m}/>'


def box(x, y, w, h, c=K, rx=10, fill="#fff", sw=3.5):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{c}" stroke-width="{sw}"/>'


def paper(x, y, w=70, h=88, lines=3):
    s = box(x, y, w, h, rx=4, sw=3)
    for i in range(lines):
        s += line(x + 12, y + 24 + i * 20, x + w - 12, y + 24 + i * 20, w=2.5)
    return s


def xh(x, y, s=1.0, eyes=(0, 0), mouth="flat"):
    """Xiaohei: solid black blob, white eyes with dot pupils, thin legs. (x, y) = feet centre."""
    ex, ey = eyes
    m = {"flat": '<line x1="-9" y1="6" x2="9" y2="6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
         "o": '<ellipse cx="0" cy="8" rx="6" ry="8" fill="#fff"/>',
         "sad": '<path d="M-10 12 Q0 2 10 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'}[mouth]
    return (f'<g transform="translate({x} {y}) scale({s})">'
            f'<line x1="-24" y1="-72" x2="-26" y2="0" stroke="{K}" stroke-width="5" stroke-linecap="round"/>'
            f'<line x1="24" y1="-72" x2="26" y2="0" stroke="{K}" stroke-width="5" stroke-linecap="round"/>'
            f'<path d="M-62 -178 C-74 -150 -78 -110 -58 -72 L58 -72 C80 -110 74 -150 62 -178 C20 -192 -20 -192 -62 -178 Z" fill="{K}"/>'
            f'<g transform="translate(0 -128)"><circle cx="-22" cy="0" r="12" fill="#fff"/><circle cx="22" cy="0" r="12" fill="#fff"/>'
            f'<circle cx="{-22 + ex}" cy="{ey}" r="4.5" fill="{K}"/><circle cx="{22 + ex}" cy="{ey}" r="4.5" fill="{K}"/>{m}</g></g>')


def ground(x1, x2, y):
    return "".join(line(x1 + i * 46, y, x1 + i * 46 + 18, y, w=2.2) for i in range((x2 - x1) // 46))


def wob(s):
    return f'<g filter="url(#w)">{s}</g>'


def save(name, body):
    (OUT / name).write_text(svg(body), encoding="utf-8")


# 1. hero: inputs -> Xiaohei -> plan
def hero():
    d = ""
    for i, (lab, y) in enumerate([("income & spending", 250), ("your goals", 430), ("10 risk answers", 610)]):
        d += paper(335, y - 44, 76, 88)
        d += paper(345, y - 54, 76, 88)
        d += t(320, y + 4, lab, K, 30, "end")
        d += line(450, y - 8, 590, 450 + (y - 430) * 0.3, O, 4, True)
    d += xh(800, 700, 1.7, (0, 2)) + ground(640, 980, 702)
    for i, (lab, y) in enumerate([("suggested allocation", 250), ("fund shortlist", 430), ("monthly SIP plan", 610)]):
        d += line(1010, 450 + (y - 430) * 0.3, 1230, y - 8, O, 4, True)
        d += box(1240, y - 52, 300, 90, K, 12) + t(1390, y + 8, lab, K, 31)
    d += t(800, 150, "numbers, not vibes", R, 54) + path("M 580 168 Q 800 188 1020 168", R, 4)
    d += line(800, 190, 800, 300, R, 4, True)
    d += t(1040, 760, "same inputs → same plan", B, 34, rot=-3)
    return wob(d)


# 2. final = lower of capacity and tolerance
def minrule():
    d = ground(120, 1500, 760)
    d += box(250, 230, 120, 530, K, 6) + box(250, 230, 120, 0, K) + "<rect x='250' y='230' width='120' height='530' fill='#e8eef7'/>" + box(250, 230, 120, 530, K, 6)
    d += box(520, 540, 120, 220, K, 6) + "<rect x='520' y='540' width='120' height='220' fill='#fdeedd'/>" + box(520, 540, 120, 220, K, 6)
    d += t(310, 800, "capacity 84", K, 34) + t(580, 800, "comfort 30", K, 34)
    d += xh(930, 760, 1.5, (-3, 0), "o")
    d += f'<line x1="230" y1="540" x2="670" y2="540" stroke="{R}" stroke-width="5" stroke-dasharray="16 10"/>'
    d += t(930, 330, "take the lower one", R, 54) + path("M 700 345 Q 930 370 1160 345", R, 4)
    d += path("M 930 380 L 930 450", R, 4, arrow=True)
    d += path("M 990 600 Q 1120 650 1200 600", O, 4, arrow=True)
    d += box(1220, 520, 320, 110, K, 14) + t(1380, 570, "Moderately", K, 34) + t(1380, 610, "Conservative", K, 34)
    d += t(310, 190, "can afford", B, 32) + t(580, 505, "can stomach", B, 32)
    d += path("M 400 250 Q 520 300 480 520", B, 3.5, arrow=True)
    d += t(1360, 700, "gap > 25 points?", B, 32) + t(1360, 740, "say which one binds", B, 32)
    return wob(d)


# 3. horizon glide path
def glide():
    steps = [("10y +", 85, 140, 250), ("7-9y", 70, 120, 400), ("5-6y", 50, 100, 550), ("3-4y", 30, 80, 700), ("1-2y", 0, 60, 850)]
    d = ""
    base = 760
    for i, (lab, eq, _, _) in enumerate(steps):
        x = 150 + i * 270
        top = 330 + i * 85
        d += f'<rect x="{x}" y="{top}" width="270" height="{800 - top}" fill="#fff" stroke="{K}" stroke-width="3.5"/>'
        d += t(x + 135, top + 55, lab, K, 36)
        # balloon sized by equity %
        r = max(22, 12 + eq * 0.55)
        cx, cy = x + 135, top - 60 - r
        d += f'<ellipse cx="{cx}" cy="{cy}" rx="{r}" ry="{r*1.1}" fill="{"#fff"}" stroke="{B}" stroke-width="3.5"/>'
        d += line(cx, cy + r * 1.1, cx, top, B, 2.5)
        d += t(cx, cy + 10, f"{eq}%", B, 30 if eq else 28)
    d += xh(1215, 330 + 3 * 85, 0.62, (4, 1), "flat")
    d += t(800, 130, "shorter goal  →  less equity", R, 54) + path("M 420 150 Q 800 175 1180 150", R, 4)
    d += t(1240, 250, "a cap, not a target", B, 34, rot=-4)
    d += t(760, 300, "equity cap per goal", O, 34, rot=3)
    return wob(d)


def glide_final():
    body = glide()
    # character walking down the steps (drawn separately so the filter wobble stays light)
    return body + wob(xh(1410, 330 + 4 * 85 + 0, 0.0) if False else "")


# 4. deterministic engine
def engine():
    d = ground(120, 1500, 760)
    d += box(560, 300, 480, 380, K, 20) + t(800, 380, "pure functions", K, 44)
    d += t(800, 430, "engine/", O, 34)
    for cx, cy, r in [(680, 560, 50), (800, 520, 36), (900, 580, 44)]:
        d += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#fff" stroke="{K}" stroke-width="3.5" stroke-dasharray="14 9"/><circle cx="{cx}" cy="{cy}" r="9" fill="{K}"/>'
    d += paper(260, 400, 90, 110) + t(305, 380, "inputs", K, 32) + line(370, 450, 550, 450, O, 4, True)
    d += paper(1100, 360, 90, 110) + paper(1220, 360, 90, 110) + t(1210, 520, "identical", R, 38) + t(1210, 560, "every time", R, 38)
    d += line(1050, 450, 1090, 420, O, 4, True)
    d += xh(380, 760, 1.2, (4, 0))
    d += line(420, 640, 520, 600, K, 7)
    d += path("M 1330 150 q 80 -10 120 40 q 8 70 -60 80 l -20 40 l -10 -40 q -80 -10 -50 -90 q 0 -30 20 -30 z", K, 3.5)
    d += t(1390, 215, "LLM maths", K, 28) + line(1300, 130, 1470, 290, R, 7) + line(1470, 130, 1300, 290, R, 7)
    d += t(800, 190, "the maths is plain code", R, 56) + path("M 500 210 Q 800 235 1100 210", R, 4)
    d += t(800, 820, "an LLM may explain a result, never calculate it", B, 34) + t(800, 862, "Monte Carlo is seeded: 5,000 paths, repeatable", O, 28)
    return wob(d)


# 5. stress test
def stress():
    d = ground(120, 1500, 800)
    d += path("M 140 560 C 260 520 330 560 430 500 C 520 450 600 480 700 420 C 800 360 840 400 900 380 "
              "C 960 360 990 580 1040 640 C 1070 670 1100 540 1180 480 C 1260 420 1360 380 1470 300", K, 5)
    d += f'<ellipse cx="1040" cy="652" rx="46" ry="14" fill="none" stroke="{R}" stroke-width="4" stroke-dasharray="10 8"/>'
    d += t(1040, 740, "Feb – Mar 2020", R, 44)
    d += line(1040, 700, 1040, 680, R, 4, True)
    d += xh(600, 800, 1.0, (4, -2))  # standing on the ground, looking at the chart
    d += path("M 700 620 Q 860 560 960 650", O, 4, arrow=True)
    d += t(790, 540, "replay it on your mix", O, 36, rot=-6)
    d += t(1220, 250, "₹10 lakh invested", K, 34) + t(1220, 290, "in the suggested funds", K, 34)
    d += t(250, 220, "month-end NAVs only,", B, 32) + t(250, 258, "so intra-month lows", B, 32) + t(250, 296, "are missed", B, 32)
    d += path("M 250 320 Q 300 380 330 470", B, 3.5, arrow=True)
    return wob(d)


# 6. shortlist funnel
def funnel():
    d = ground(120, 1500, 800)
    import random
    random.seed(7)
    for i in range(34):
        x, y = 160 + random.random() * 340, 190 + random.random() * 300
        d += f'<rect x="{x:.0f}" y="{y:.0f}" width="26" height="34" rx="3" fill="#fff" stroke="{K}" stroke-width="2.5"/>'
    d += t(330, 550, "1,723 eligible funds", K, 36)
    d += path("M 560 300 L 1000 300 L 860 500 L 700 500 Z", K, 4) + t(780, 270, "score within category", O, 34)
    d += line(500, 380, 560, 400, O, 4, True) + line(780, 500, 780, 580, O, 4, True)
    d += xh(780, 800, 1.2, (0, -3), "o")
    for i in range(5):
        d += box(1180 + (i % 3) * 120, 320 + (i // 3) * 120, 100, 90, K, 8) + t(1230 + (i % 3) * 120, 375 + (i // 3) * 120, f"#{i+1}", K, 34)
    d += line(1020, 400, 1160, 400, O, 4, True)
    d += t(1300, 580, "top 1 per category,", K, 34) + t(1300, 620, "8 funds at most", K, 34)
    d += box(150, 640, 330, 120, R, 10, "#fff", 3) + t(315, 690, "Direct · segregated", R, 32) + t(315, 730, "stale · demat-only", R, 32)
    d += line(700, 480, 480, 690, R, 3.5, True)
    d += t(800, 130, "filter first, rank second", R, 54)
    d += t(1300, 740, "max 2 funds per AMC", B, 34, rot=-3)
    return wob(d)


# 7. old vs new regime fork
def taxfork():
    d = ground(120, 1500, 800)
    # two roads diverging from the character
    d += path("M 800 640 C 800 520 600 470 470 400", K, 4, arrow=True)
    d += path("M 800 640 C 800 520 1000 470 1130 400", K, 4, arrow=True)
    # left signboard: old regime
    d += box(230, 250, 330, 150, K, 12) + t(395, 305, "old regime", K, 42)
    for i, tag in enumerate(["80C", "NPS", "80D", "HRA"]):
        d += box(255 + i * 76, 330, 66, 44, O, 8, "#fff", 3) + t(288 + i * 76, 361, tag, O, 26)
    d += t(395, 450, "more deductions", B, 32) + t(395, 488, "higher slab rates", B, 32)
    # right signboard: new regime
    d += box(1040, 250, 330, 150, K, 12) + t(1205, 305, "new regime", K, 42)
    d += box(1070, 330, 270, 44, O, 8, "#fff", 3) + t(1205, 361, "nil tax up to 12.75 L", O, 25)
    d += t(1205, 450, "fewer deductions", B, 32) + t(1205, 488, "lower slab rates", B, 32)
    d += xh(800, 800, 1.15, (0, -3), "o")
    d += t(800, 150, "work out both, then choose", R, 54) + path("M 430 172 Q 800 195 1170 172", R, 4)
    d += t(800, 215, "the code does the sums; you pick", O, 32)
    d += t(395, 575, "example: ₹3.11 L", K, 30) + t(1205, 575, "example: ₹2.05 L", K, 30)
    return wob(d)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    save("01-overview.svg", hero())
    save("02-take-the-lower.svg", minrule())
    save("03-glide-path.svg", glide())
    save("04-pure-engine.svg", engine())
    save("05-stress-test.svg", stress())
    save("06-shortlist-funnel.svg", funnel())
    save("07-tax-fork.svg", taxfork())
    print("ok")
