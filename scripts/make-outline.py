"""An outlined, slightly rounded square with the slash inside, border and
slash in the same stroke weight. No tile background.

Writes SVGs and an HTML sheet to assets/logo/outline/; PNGs via Playwright.
"""

from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo" / "outline"

# slash direction from the icon (31° from vertical)
UX, UY = 31.25, 52.08
L = math.hypot(UX, UY)
UX, UY = UX / L, UY / L


def mark(*, w=8.0, radius=18.0, slash_len=0.62, cap="round", color="#0B0A0C", bleed=False, touch=False, inset=0.0) -> str:
    """100-unit canvas. The square's outer edge is inset `inset` from the
    canvas; its stroke is centred on the path, so the path sits w/2 inside."""
    s0 = inset + w / 2
    size = 100 - 2 * s0
    cx = cy = 50.0
    if touch:
        # slash reaches the inner edge of the border at both ends (corner to corner diagonal
        # would be 45°; we keep the icon's angle and stop at the top and bottom inner edges)
        inner = size / 2 - w / 2
        half = inner / UY  # distance along the slash to reach the top/bottom inner edge
        half -= 0 if cap == "butt" else w / 2
    elif bleed:
        half = 80.0
    else:
        half = slash_len * size / 2
    x1, y1 = cx - UX * half, cy - UY * half
    x2, y2 = cx + UX * half, cy + UY * half
    clip = f'<clipPath id="c"><rect x="{inset}" y="{inset}" width="{100 - 2 * inset}" height="{100 - 2 * inset}" rx="{radius}"/></clipPath>' if bleed else ""
    slash = f'<path d="M{x1:.2f} {y1:.2f} L{x2:.2f} {y2:.2f}" stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}" fill="none"{' clip-path="url(#c)"' if bleed else ""}/>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">
<defs>{clip}</defs>
<rect x="{s0:.2f}" y="{s0:.2f}" width="{size:.2f}" height="{size:.2f}" rx="{max(radius - w / 2, 0):.2f}" fill="none" stroke="{color}" stroke-width="{w}"/>
{slash}
</svg>
"""


VARIANTS = {
    "a-base": dict(),
    "b-thin": dict(w=6),
    "c-bold": dict(w=11),
    "d-square-caps": dict(cap="butt"),
    "e-short": dict(slash_len=0.5),
    "f-long": dict(slash_len=0.74),
    "g-touch": dict(touch=True),
    "h-bleed": dict(bleed=True),
    "i-tight-radius": dict(radius=10),
    "j-soft-radius": dict(radius=26),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cells = []
    for name, kw in VARIANTS.items():
        (OUT / f"{name}.svg").write_text(mark(**kw))
        (OUT / f"{name}-white.svg").write_text(mark(color="#FFFFFF", **kw))
        (OUT / f"{name}-mauve.svg").write_text(mark(color="oklch(14.5% 0.008 326)", **kw))
        cells.append(
            f'<div class="cell"><div class="row"><img src="{name}.svg" style="width:160px">'
            f'<div class="dark"><img src="{name}-white.svg" style="width:160px"></div></div>'
            f'<div class="small"><img src="{name}.svg" style="width:64px"><img src="{name}.svg" style="width:32px"><img src="{name}.svg" style="width:16px">'
            f'<span class="dark"><img src="{name}-white.svg" style="width:64px"><img src="{name}-white.svg" style="width:32px"><img src="{name}-white.svg" style="width:16px"></span></div><p>{name}</p></div>'
        )
    html = f"""<!doctype html><meta charset="utf-8"><title>Polemic mark: outlined square, slash</title>
<style>
body{{margin:0;padding:24px;background:#F3F2F4;font:13px/1.4 Inter,system-ui,sans-serif;color:#333}}
.grid{{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}}
.cell{{background:#fff;border-radius:12px;padding:10px;text-align:center}}
.row{{display:flex;gap:8px;justify-content:center}}
.dark{{background:#141216;border-radius:8px;padding:8px;display:inline-flex;gap:10px;align-items:flex-end}}
.small{{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin-top:8px}}
p{{margin:6px 0 0;font-weight:600}}
</style>
<h1 style="font-size:16px;margin:0 0 12px">Polemic mark — outlined square with slash, one stroke weight</h1>
<div class="grid">{''.join(cells)}</div>
"""
    (OUT / "sheet.html").write_text(html)
    print(f"wrote {len(VARIANTS) * 3} SVGs to {OUT}")


if __name__ == "__main__":
    main()
