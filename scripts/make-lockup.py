"""Polemic logo: the outlined mark (assets/logo/polemic-mark.svg) next to
"POLEMIC" in caps, both in the black tint (mauve 950, oklch(14.5% 0.008 326)).

Writes assets/logo/lockup/*.svg (text as outlines) and a preview sheet.

Run with: uv run --with fonttools --with uharfbuzz scripts/make-lockup.py
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("make_logo", ROOT / "scripts" / "make-logo.py")
ml = importlib.util.module_from_spec(spec)
sys.modules["make_logo"] = ml
spec.loader.exec_module(ml)

OUT = ROOT / "assets" / "logo" / "lockup"
INK = "#0C090C"  # oklch(14.5% 0.008 326), mauve 950

# Mark geometry on a 100 grid (polemic-mark.svg): stroke 8, centred on the edge.
MARK = '<rect x="4" y="4" width="92" height="92" rx="14"/><path d="M35.33 25.54 L64.67 74.46"/>'


def lockup(font: str, tracking: float, mark_to_cap: float, gap: float, color: str = INK) -> str:
    """Mark height = mark_to_cap x cap height; gap in mark heights."""
    size = 100.0
    t = ml.text_path("POLEMIC", font, size, tracking)
    m = t.cap * mark_to_cap
    s = m / 100
    pad = 0.0
    tx = m + gap * m
    # Centre the cap height on the mark.
    base = m / 2 + t.cap / 2
    w, h = tx + t.width, m
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.0f}" height="{h:.0f}">\n'
        f'<g transform="scale({s:.5f})" fill="none" stroke="{color}" stroke-width="8" '
        f'stroke-linecap="round" stroke-linejoin="round">{MARK}</g>\n'
        f'<path transform="translate({tx:.2f} {base:.2f})" fill="{color}" d="{t.d}"/>\n'
        "</svg>\n"
    )


VARIANTS = {
    "a-semibold": ("inter-display-semibold", 0.04, 1.45, 0.38),
    "b-medium": ("inter-display-medium", 0.06, 1.45, 0.38),
    "c-semibold-wide": ("inter-display-semibold", 0.14, 1.45, 0.42),
    "d-semibold-cap": ("inter-display-semibold", 0.04, 1.0, 0.32),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cards = []
    for name, args in VARIANTS.items():
        (OUT / f"{name}.svg").write_text(lockup(*args))
        (OUT / f"{name}-white.svg").write_text(lockup(*args, color="#FFFFFF"))
        cards.append(
            f'<div class="c"><div class="row"><img src="{name}.svg" style="height:56px">'
            f'<img src="{name}.svg" style="height:28px"></div>'
            f'<div class="row dark"><img src="{name}-white.svg" style="height:56px"></div><p>{name}</p></div>'
        )
    (OUT / "sheet.html").write_text(
        "<!doctype html><meta charset=utf-8><style>body{margin:0;padding:24px;background:#F3F2F4;"
        "font:13px/1.4 Inter,system-ui,sans-serif;color:#333}.g{display:grid;grid-template-columns:1fr 1fr;gap:16px}"
        ".c{background:#fff;border-radius:12px;padding:28px}.row{display:flex;gap:40px;align-items:center;padding:12px}"
        ".dark{background:#0C090C;border-radius:8px;margin-top:12px}p{margin:12px 0 0;font-weight:600}</style>"
        '<h1 style="font-size:16px;margin:0 0 12px">Polemic logo — mark + POLEMIC, black tint</h1>'
        f'<div class="g">{"".join(cards)}</div>'
    )


if __name__ == "__main__":
    main()
