"""A black, slightly rounded square with the slash inside. Variations in
slash weight, cap style, tint, corner radius and the black itself.

Writes SVGs and an HTML sheet to assets/logo/black/; PNGs via Playwright.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo" / "black"

# the icon's slash: from (29.4, 23.75) to (60.6, 75.8) on a 100 tile; centred here
X1, Y1, X2, Y2 = 34.4, 24.0, 65.6, 76.0

BLACK = "#0B0A0C"
MAUVE_950 = "oklch(14.5% 0.008 326)"
WHITE = "#FFFFFF"
MAUVE_100 = "oklch(96% 0.003 325.6)"
MAUVE_300 = "oklch(86.5% 0.012 325.68)"
MAUVE_T = "oklch(78% 0.055 325)"


def grain_filter(amount: float) -> str:
    inter = 0.5 - 0.5 * amount
    return (
        '<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
        '<feTurbulence type="fractalNoise" baseFrequency="4.2" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>'
        '<feColorMatrix in="n" type="saturate" values="0" result="g"/>'
        f'<feComponentTransfer in="g" result="c"><feFuncR type="linear" slope="{amount}" intercept="{inter}"/>'
        f'<feFuncG type="linear" slope="{amount}" intercept="{inter}"/><feFuncB type="linear" slope="{amount}" intercept="{inter}"/>'
        '<feFuncA type="table" tableValues="1 1"/></feComponentTransfer>'
        '<feComposite in="c" in2="SourceGraphic" operator="in" result="ci"/>'
        '<feBlend in="ci" in2="SourceGraphic" mode="overlay"/></filter>'
    )


def icon(*, black=BLACK, ink=WHITE, width=10.0, cap="round", radius=16.0, grain=0.0, bleed=False, mac=True) -> str:
    """mac=True: 824 tile on a 1024 canvas with the Dock shadow. mac=False: full-bleed square."""
    if bleed:
        # extend the slash past the square along its own direction
        dx, dy = X2 - X1, Y2 - Y1
        x1, y1, x2, y2 = X1 - dx * 0.6, Y1 - dy * 0.6, X2 + dx * 0.6, Y2 + dy * 0.6
    else:
        x1, y1, x2, y2 = X1, Y1, X2, Y2
    slash = f'<path d="M{x1:.2f} {y1:.2f} L{x2:.2f} {y2:.2f}" stroke="{ink}" stroke-width="{width}" stroke-linecap="{cap}" fill="none"/>'
    g = f'<rect width="100" height="100" rx="{radius}" fill="{black}" filter="url(#grain)"/>' if grain else ""
    defs = (grain_filter(grain) if grain else "") + f'<clipPath id="clip"><rect width="100" height="100" rx="{radius}"/></clipPath>'
    if mac:
        defs += '<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="1.2" stdDeviation="0.6" flood-color="#000" flood-opacity="0.3"/></filter>'
        return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 124 124" width="1024" height="1024">
<defs>{defs}</defs>
<g transform="translate(12 12)">
<rect width="100" height="100" rx="{radius}" fill="{black}" filter="url(#shadow)"/>{g}
<g clip-path="url(#clip)">{slash}</g>
</g></svg>
"""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">
<defs>{defs}</defs>
<rect width="100" height="100" rx="{radius}" fill="{black}"/>{g}
<g clip-path="url(#clip)">{slash}</g>
</svg>
"""


VARIANTS = {
    "a-base": dict(),
    "b-thin": dict(width=7),
    "c-bold": dict(width=14),
    "d-square-caps": dict(cap="butt", width=11),
    "e-bleed": dict(bleed=True, width=12),
    "f-mauve-black": dict(black=MAUVE_950, ink=MAUVE_100),
    "g-tinted-slash": dict(black=MAUVE_950, ink=MAUVE_T),
    "h-grain": dict(black=MAUVE_950, ink=MAUVE_100, grain=0.9),
    "i-tighter-radius": dict(radius=10),
    "j-softer-radius": dict(radius=23.33),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cells = []
    for name, kw in VARIANTS.items():
        (OUT / f"{name}.svg").write_text(icon(**kw))
        (OUT / f"{name}-flat.svg").write_text(icon(mac=False, **kw))
        cells.append(
            f'<div class="cell"><img src="{name}.svg" style="width:200px"><div class="small">'
            f'<img src="{name}.svg" style="width:96px"><img src="{name}.svg" style="width:48px"><img src="{name}.svg" style="width:32px"><img src="{name}-flat.svg" style="width:16px"></div><p>{name}</p></div>'
        )
    html = f"""<!doctype html><meta charset="utf-8"><title>Polemic icon: black square, slash</title>
<style>
body{{margin:0;padding:24px;background:#F3F2F4;font:13px/1.4 Inter,system-ui,sans-serif;color:#333}}
.grid{{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}}
.cell{{background:#fff;border-radius:12px;padding:10px;text-align:center}}
.small{{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin-top:4px}}
p{{margin:6px 0 0;font-weight:600}}
</style>
<h1 style="font-size:16px;margin:0 0 12px">Polemic icon — black square with slash</h1>
<div class="grid">{''.join(cells)}</div>
"""
    (OUT / "sheet.html").write_text(html)
    print(f"wrote {len(VARIANTS) * 2} SVGs to {OUT}")


if __name__ == "__main__":
    main()
