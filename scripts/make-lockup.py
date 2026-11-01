"""Polemic logo lockup: the outlined mark (assets/logo/polemic-mark.svg) next to
"Polemic" in Nunito Bold, both in the black tint (mauve 950,
oklch(14.5% 0.008 326) = #0C090C). Nunito's rounded terminals echo the round
caps of the slash; its Bold stem is close to the mark's stroke.

Writes assets/logo/polemic-lockup(-white).svg (mark + name) and
polemic-lockup-icon-{horizontal,vertical}(-white).svg (the plum app icon from
polemic-logo-flat.svg + name), text converted to outlines so no font is
needed to display them.

Run with: uv run --with fonttools --with uharfbuzz scripts/make-lockup.py
Needs npm on PATH: Nunito (OFL) is fetched from @fontsource/nunito.
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
import tarfile
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("make_logo", ROOT / "scripts" / "make-logo.py")
ml = importlib.util.module_from_spec(spec)
sys.modules["make_logo"] = ml
spec.loader.exec_module(ml)

OUT = ROOT / "assets" / "logo"
INK = "#0C090C"  # oklch(14.5% 0.008 326), mauve 950
CACHE = Path("/tmp/polemic-fonts")

# Mark geometry on a 100 grid (polemic-mark.svg): stroke 8, centred on the edge.
MARK = '<rect x="4" y="4" width="92" height="92" rx="14"/><path d="M35.33 25.54 L64.67 74.46"/>'

TRACKING = 0.01  # em
MARK_TO_CAP = 1.45  # mark height / cap height
GAP = 0.32  # space between mark and text, in mark heights


def nunito() -> Path:
    """Fetch Nunito Bold from npm and convert the latin WOFF to TTF (HarfBuzz needs sfnt)."""
    ttf = CACHE / "nunito-700.ttf"
    if not ttf.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        name = subprocess.run(
            ["npm", "pack", "-q", "@fontsource/nunito@5"], cwd=CACHE, check=True, capture_output=True, text=True
        ).stdout.split()[-1]
        member = "package/files/nunito-latin-700-normal.woff"
        with tarfile.open(CACHE / name) as tar:
            data = tar.extractfile(member)
            font = TTFont(data)
        font.flavor = None
        font.save(ttf)
    return ttf


def lockup(color: str) -> str:
    t = ml.text_path("Polemic", "nunito-bold", 100.0, TRACKING)
    m = t.cap * MARK_TO_CAP
    tx = m * (1 + GAP)
    base = m / 2 + t.cap / 2  # cap height centred on the mark
    w, h = tx + t.width, m
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.0f}" height="{h:.0f}">\n'
        f"<title>Polemic</title>\n"
        f'<g transform="scale({m / 100:.5f})" fill="none" stroke="{color}" stroke-width="8" '
        f'stroke-linecap="round" stroke-linejoin="round">{MARK}</g>\n'
        f'<path transform="translate({tx:.2f} {base:.2f})" fill="{color}" d="{t.d}"/>\n'
        "</svg>\n"
    )


TILE_SRC = OUT / "polemic-logo-flat.svg"  # the full-bleed plum app icon, 100 x 100


def tile(x: float, y: float, size: float) -> str:
    """The plum tile from polemic-logo-flat.svg, nested at (x, y), size x size."""
    src = TILE_SRC.read_text()
    inner = re.sub(r"<!--.*?-->", "", src[src.index(">", src.index("<svg")) + 1 : src.rindex("</svg>")], flags=re.S)
    return f'<svg x="{x:.2f}" y="{y:.2f}" width="{size:.2f}" height="{size:.2f}" viewBox="0 0 100 100">{inner.strip()}</svg>\n'


def tile_lockup_h(color: str) -> str:
    """App icon + name side by side: tile 1.6 x cap height, cap centred on it."""
    t = ml.text_path("Polemic", "nunito-bold", 100.0, TRACKING)
    m = t.cap * 1.6
    tx = m * 1.28
    w, h = tx + t.width, m
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.0f}" height="{h:.0f}">\n'
        "<title>Polemic</title>\n"
        + tile(0, 0, m)
        + f'<path transform="translate({tx:.2f} {m / 2 + t.cap / 2:.2f})" fill="{color}" d="{t.d}"/>\n'
        "</svg>\n"
    )


def tile_lockup_v(color: str) -> str:
    """App icon above the name, centred: name as wide as 1.5 x the tile."""
    t = ml.text_path("Polemic", "nunito-bold", 100.0, TRACKING)
    m = t.width / 1.5
    gap = m * 0.22
    w = t.width
    h = m + gap + t.cap
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.0f}" height="{h:.0f}">\n'
        "<title>Polemic</title>\n"
        + tile((w - m) / 2, 0, m)
        + f'<path transform="translate(0 {h:.2f})" fill="{color}" d="{t.d}"/>\n'
        "</svg>\n"
    )


def main() -> None:
    ml.FONTS["nunito-bold"] = str(nunito())
    (OUT / "polemic-lockup.svg").write_text(lockup(INK))
    (OUT / "polemic-lockup-white.svg").write_text(lockup("#FFFFFF"))
    (OUT / "polemic-lockup-icon-horizontal.svg").write_text(tile_lockup_h(INK))
    (OUT / "polemic-lockup-icon-horizontal-white.svg").write_text(tile_lockup_h("#FFFFFF"))
    (OUT / "polemic-lockup-icon-vertical.svg").write_text(tile_lockup_v(INK))
    (OUT / "polemic-lockup-icon-vertical-white.svg").write_text(tile_lockup_v("#FFFFFF"))


if __name__ == "__main__":
    main()
