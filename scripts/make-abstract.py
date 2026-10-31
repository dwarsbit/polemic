"""Abstract, monochrome icon studies built from the slash and the caret.

Translucent slabs at the slash's angle and the caret's vertical, in tints of
the website's mauve, combined with mix-blend-modes on the grained tile.
Writes SVGs plus an HTML sheet to assets/logo/abstract/; PNGs are exported
with Playwright (see the bottom of this file).

Run: uv run scripts/make-abstract.py
"""

from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo" / "abstract"

# website mauve scale
M = {
    50: "oklch(98.5% 0 0)",
    100: "oklch(96% 0.003 325.6)",
    200: "oklch(92.2% 0.005 325.62)",
    300: "oklch(86.5% 0.012 325.68)",
    400: "oklch(71.1% 0.019 323.02)",
    500: "oklch(54.2% 0.034 322.5)",
    600: "oklch(43.5% 0.029 321.78)",
    700: "oklch(36.4% 0.029 323.89)",
    800: "oklch(26.3% 0.024 320.12)",
    900: "oklch(21.2% 0.019 322.12)",
    950: "oklch(14.5% 0.008 326)",
}
# monochrome tint ramp around the wallpaper hue, with enough chroma to stay mauve
T = {
    95: "oklch(95% 0.02 325)",
    88: "oklch(88% 0.035 325)",
    78: "oklch(78% 0.055 325)",
    65: "oklch(65% 0.07 325)",
    50: "oklch(50% 0.075 325)",
    35: "oklch(35% 0.065 325)",
    22: "oklch(22% 0.045 325)",
    12: "oklch(12% 0.025 325)",
}
WALL = ("#7b627d", "#8f6976")
WALL_DARK = ("#412c42", "#3c1a26")

# slash direction from the icon (31° from vertical)
UX, UY = 31.25, 52.08
L = math.hypot(UX, UY)
UX, UY = UX / L, UY / L
NX, NY = -UY, UX

TILE_R = 23.33


def band(cx: float, cy: float, half_w: float, ux=UX, uy=UY, nx=NX, ny=NY, length: float = 200.0) -> str:
    """Polygon of a slab through (cx, cy) along (ux, uy), half-width half_w."""
    pts = [
        (cx + ux * length + nx * half_w, cy + uy * length + ny * half_w),
        (cx + ux * length - nx * half_w, cy + uy * length - ny * half_w),
        (cx - ux * length - nx * half_w, cy - uy * length - ny * half_w),
        (cx - ux * length + nx * half_w, cy - uy * length + ny * half_w),
    ]
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)


def seg(cx: float, cy: float, half_w: float, half_len: float, ux=UX, uy=UY, nx=NX, ny=NY) -> str:
    return band(cx, cy, half_w, ux, uy, nx, ny, half_len)


def poly(points: str, fill: str, blend: str = "normal", opacity: float = 1.0, extra: str = "") -> str:
    return f'<polygon points="{points}" fill="{fill}" style="mix-blend-mode:{blend}" opacity="{opacity}" {extra}/>'


def rect(x, y, w, h, fill, blend="normal", opacity=1.0, rx=0.0, extra=""):
    return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{rx:.2f}" fill="{fill}" style="mix-blend-mode:{blend}" opacity="{opacity}" {extra}/>'


def circle(cx, cy, r, fill, blend="normal", opacity=1.0):
    return f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{fill}" style="mix-blend-mode:{blend}" opacity="{opacity}"/>'


def grain_filter() -> str:
    slope = 0.8
    intercept = 0.5 - 0.5 * slope
    return (
        '<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
        '<feTurbulence type="fractalNoise" baseFrequency="4.2" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>'
        '<feColorMatrix in="n" type="saturate" values="0" result="g"/>'
        f'<feComponentTransfer in="g" result="c"><feFuncR type="linear" slope="{slope}" intercept="{intercept}"/>'
        f'<feFuncG type="linear" slope="{slope}" intercept="{intercept}"/><feFuncB type="linear" slope="{slope}" intercept="{intercept}"/>'
        '<feFuncA type="table" tableValues="1 1"/></feComponentTransfer>'
        '<feComposite in="c" in2="SourceGraphic" operator="in" result="ci"/>'
        '<feBlend in="ci" in2="SourceGraphic" mode="overlay"/></filter>'
    )


def icon(body: str, bg=WALL, extra_defs: str = "", grain: bool = True) -> str:
    """100-unit tile on a 124-unit canvas, with the mac shadow and highlight."""
    g = '<rect x="12" y="12" width="100" height="100" rx="23.33" fill="url(#bg)" filter="url(#grain)"/>' if grain else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 124 124" width="1024" height="1024">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{bg[0]}"/><stop offset="1" stop-color="{bg[1]}"/></linearGradient>
<linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="1.2" stdDeviation="0.6" flood-color="#000" flood-opacity="0.3"/></filter>
<clipPath id="clip"><rect x="12" y="12" width="100" height="100" rx="23.33"/></clipPath>
{grain_filter()}{extra_defs}
</defs>
<rect x="12" y="12" width="100" height="100" rx="23.33" fill="url(#bg)" filter="url(#shadow)"/>
{g}
<g clip-path="url(#clip)" style="isolation:isolate"><g transform="translate(12 12)">{body}</g></g>
<rect x="12" y="12" width="100" height="100" rx="23.33" fill="none" stroke="url(#hl)" stroke-width="1" clip-path="url(#clip)"/>
</svg>
"""


# ---------------------------------------------------------------- studies
# All coordinates in the 100-unit tile. The original slash runs from
# (29.4, 23.75) to (60.6, 75.8); its centre is (45, 49.8). The caret sits at x≈73.

C = (45.0, 49.8)


def s_split() -> str:
    """The tile cut along the slash: one half screened lighter, the other
    multiplied darker. The caret crosses the cut and takes a different tint
    on each side."""
    far = 300
    upper = f"{C[0] + UX * far:.2f},{C[1] + UY * far:.2f} {C[0] - UX * far:.2f},{C[1] - UY * far:.2f} {C[0] - UX * far - NX * far:.2f},{C[1] - UY * far - NY * far:.2f} {C[0] + UX * far - NX * far:.2f},{C[1] + UY * far - NY * far:.2f}"
    lower = f"{C[0] + UX * far:.2f},{C[1] + UY * far:.2f} {C[0] - UX * far:.2f},{C[1] - UY * far:.2f} {C[0] - UX * far + NX * far:.2f},{C[1] - UY * far + NY * far:.2f} {C[0] + UX * far + NX * far:.2f},{C[1] + UY * far + NY * far:.2f}"
    return (
        poly(upper, T[78], "screen", 0.55)
        + poly(lower, T[22], "multiply", 0.6)
        + rect(64, 24, 11, 54, T[95], "overlay", 0.9, rx=5.5)
        + rect(64, 24, 11, 54, T[88], "screen", 0.3, rx=5.5)
    )


def s_slabs() -> str:
    """Three translucent slabs at the slash angle, multiplied, so each overlap
    steps a tint darker. The caret is screened across them."""
    body = ""
    for off in (-14, 0, 14):
        body += poly(seg(C[0] + NX * off, C[1] + NY * off, 9.5, 34), T[50], "multiply", 0.6)
    body += rect(69, 30, 8, 46, T[88], "screen", 0.7, rx=4)
    return body


def s_echo() -> str:
    """The slash echoed: five screened slabs fading to the left; the caret
    multiplied, solid and dark."""
    body = ""
    for i in range(5):
        off = -i * 11
        body += poly(seg(C[0] + NX * off, C[1] + NY * off, 5, 28), T[88], "screen", 0.85 - i * 0.17)
    body += rect(70, 31, 7, 45, T[12], "multiply", 0.8, rx=3.5)
    return body


def s_cross() -> str:
    """One wide slash slab and one wide vertical slab crossing: a light screen
    and a dark multiply, the overlap being the deepest tint."""
    return (
        poly(band(C[0] - NX * 2, C[1] - NY * 2, 15), T[88], "screen", 0.75)
        + rect(52, -10, 22, 130, T[12], "multiply", 0.55)
    )


def s_fold() -> str:
    """Slash and caret as full-height slabs, both screened lighter; where they
    cross, a multiplied cut folds the tint back below the ground."""
    bpts = band(C[0], C[1], 11)
    return (
        poly(bpts, T[78], "screen", 0.8)
        + rect(66, -10, 13, 130, T[78], "screen", 0.8)
        + f'<clipPath id="caretclip"><rect x="66" y="-10" width="13" height="130"/></clipPath>'
        + f'<g clip-path="url(#caretclip)">{poly(bpts, T[12], "multiply", 0.85)}</g>'
    )


def s_lens() -> str:
    """A screened disc with the slash multiplied through it and the caret as a
    thin screened line."""
    return (
        circle(50, 50, 33, T[78], "screen", 0.6)
        + poly(seg(C[0], C[1], 8, 36), T[22], "multiply", 0.6)
        + rect(70, 30, 5.5, 44, T[95], "screen", 0.95, rx=2.75)
    )


def s_misprint() -> str:
    """A misregistered print: the mark printed twice, once screened and offset
    up-left, once multiplied and offset down-right. Where the two passes
    register, the tint returns to the ground."""
    body = poly(seg(C[0] - 2.6, C[1] - 2.6, 6, 30), T[88], "screen", 0.9)
    body += rect(67.4, 28.4, 7, 46, T[88], "screen", 0.9, rx=3.5)
    body += poly(seg(C[0] + 2.6, C[1] + 2.6, 6, 30), T[12], "multiply", 0.7)
    body += rect(72.6, 33.6, 7, 46, T[12], "multiply", 0.7, rx=3.5)
    return body


def s_hatch() -> str:
    """The slash as hatching: thin screened strokes, the caret as two
    multiplied strokes. Typographic and quiet."""
    body = ""
    for i in range(6):
        off = -22 + i * 6.5
        body += poly(seg(C[0] + NX * off, C[1] + NY * off, 1.4, 24 + 4 * math.sin(i)), T[95], "screen", 0.9)
    body += rect(69, 30, 3, 46, T[12], "multiply", 0.75, rx=1.5)
    body += rect(75, 30, 3, 46, T[12], "multiply", 0.45, rx=1.5)
    return body


STUDIES = {
    "split": s_split,
    "slabs": s_slabs,
    "echo": s_echo,
    "cross": s_cross,
    "fold": s_fold,
    "lens": s_lens,
    "misprint": s_misprint,
    "hatch": s_hatch,
}

BACKGROUNDS = {"purple": WALL, "dark": WALL_DARK}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cells = []
    for bname, bg in BACKGROUNDS.items():
        for name, fn in STUDIES.items():
            fname = f"{name}-{bname}.svg"
            (OUT / fname).write_text(icon(fn(), bg))
            cells.append(
                f'<div class="cell"><img src="{fname}" style="width:220px"><div class="small">'
                f'<img src="{fname}" style="width:96px"><img src="{fname}" style="width:48px"><img src="{fname}" style="width:32px"></div><p>{name} · {bname}</p></div>'
            )
    html = f"""<!doctype html><meta charset="utf-8"><title>Polemic icon: abstract, monochrome</title>
<style>
body{{margin:0;padding:24px;background:#F3F2F4;font:13px/1.4 Inter,system-ui,sans-serif;color:#333}}
.grid{{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}}
.cell{{background:#fff;border-radius:12px;padding:10px;text-align:center}}
.small{{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin-top:4px}}
p{{margin:6px 0 0;font-weight:600}}
</style>
<h1 style="font-size:16px;margin:0 0 12px">Polemic icon — abstract, monochrome, from the slash and caret</h1>
<div class="grid">{''.join(cells)}</div>
"""
    (OUT / "sheet.html").write_text(html)
    print(f"wrote {len(STUDIES) * len(BACKGROUNDS)} SVGs to {OUT}")


if __name__ == "__main__":
    main()
