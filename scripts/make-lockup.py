"""Polemic logo lockup: the outlined mark (assets/logo/polemic-mark.svg) next to
"Polemic" in Nunito Bold, both in the black tint (mauve 950,
oklch(14.5% 0.008 326) = #0C090C). Nunito's rounded terminals echo the round
caps of the slash; its Bold stem is close to the mark's stroke.

Writes assets/logo/polemic-lockup.svg and polemic-lockup-white.svg, text
converted to outlines so no font is needed to display them.

Run with: uv run --with fonttools --with uharfbuzz scripts/make-lockup.py
Needs npm on PATH: Nunito (OFL) is fetched from @fontsource/nunito.
"""

from __future__ import annotations

import importlib.util
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


def main() -> None:
    ml.FONTS["nunito-bold"] = str(nunito())
    (OUT / "polemic-lockup.svg").write_text(lockup(INK))
    (OUT / "polemic-lockup-white.svg").write_text(lockup("#FFFFFF"))


if __name__ == "__main__":
    main()
