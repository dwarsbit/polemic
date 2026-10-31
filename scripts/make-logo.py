"""Generate Polemic logo explorations from the app icon.

Writes SVGs (text converted to outlines) to assets/logo/ and a contact
sheet (HTML + PNG via Playwright) for review.

Run with: uv run --with fonttools --with uharfbuzz scripts/make-logo.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo"

FONTS = {
    "inter-display-semibold": "/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf",
    "inter-display-medium": "/usr/share/fonts/opentype/inter/InterDisplay-Medium.otf",
    "inter-semibold": "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
    "mono-medium": "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf",
    "mono-regular": "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
    "mono-semibold": "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-SemiBold.ttf",
}

# ---------------------------------------------------------------- text → paths

_font_cache: dict[str, tuple[TTFont, hb.Font]] = {}


def _load(key: str) -> tuple[TTFont, hb.Font]:
    if key not in _font_cache:
        path = FONTS[key]
        tt = TTFont(path)
        blob = hb.Blob.from_file_path(path)
        face = hb.Face(blob)
        font = hb.Font(face)
        _font_cache[key] = (tt, font)
    return _font_cache[key]


@dataclass
class Text:
    d: str  # path data, baseline at y=0, y grows downwards
    width: float
    cap: float  # cap height in output units
    xh: float  # x-height in output units


def text_path(text: str, key: str, size: float, tracking: float = 0.0) -> Text:
    """Shape `text` with HarfBuzz (kerning on) and return outlines at `size` px.

    `tracking` is extra letter spacing in em.
    """
    tt, font = _load(key)
    upem = tt["head"].unitsPerEm
    scale = size / upem
    glyph_set = tt.getGlyphSet()
    os2 = tt["OS/2"]

    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False})

    pen = SVGPathPen(glyph_set)
    x = 0.0
    track = tracking * upem
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = tt.getGlyphName(info.codepoint)
        gx = x + pos.x_offset
        gy = pos.y_offset
        tpen = TransformPen(pen, (scale, 0, 0, -scale, gx * scale, -gy * scale))
        glyph_set[name].draw(tpen)
        x += pos.x_advance + track
    x -= track  # no trailing tracking
    return Text(
        d=pen.getCommands(),
        width=x * scale,
        cap=os2.sCapHeight * scale,
        xh=os2.sxHeight * scale,
    )


# ---------------------------------------------------------------- the mark

# Geometry of assets/polemic-logo.svg normalised to a 100-unit tile.
TILE_R = 23.33
SLASH = (29.375, 23.75, 60.625, 75.83)  # x1 y1 x2 y2 (centre line)
SLASH_W = 10.0
CURSOR = (70.2, 44.58, 5.42, 31.25)  # x y w h
CURSOR_R = 2.71

GRADIENT = ("#4F46E5", "#7C3AED", "#C026D3")
PINK = "#EC4899"


@dataclass
class Treatment:
    name: str
    bg: str  # preview background
    text: str  # wordmark colour
    tile: str | None  # fill for the tile (None → knockout style not applicable)
    tile_grad: tuple[str, str, str] | None
    slash_on_tile: str  # slash colour on the tile ("knockout" → mask)
    cursor_on_tile: str
    slash_bare: str  # slash colour when drawn without a tile ("gradient" allowed)
    cursor_bare: str
    outline: str


TREATMENTS = [
    Treatment("color", "#FFFFFF", "#1E1B4B", None, GRADIENT, "#FFFFFF", PINK, "gradient", PINK, "#4F46E5"),
    Treatment("color-dark", "#0F0D1A", "#FFFFFF", None, GRADIENT, "#FFFFFF", PINK, "gradient", PINK, "#8B5CF6"),
    Treatment("gray", "#FFFFFF", "#27272A", None, ("#71717A", "#3F3F46", "#18181B"), "#FFFFFF", "#A1A1AA", "#3F3F46", "#A1A1AA", "#3F3F46"),
    Treatment("gray-dark", "#18181B", "#E4E4E7", None, ("#D4D4D8", "#A1A1AA", "#71717A"), "#18181B", "#52525B", "#D4D4D8", "#71717A", "#A1A1AA"),
    Treatment("mono-black", "#FFFFFF", "#111111", "#111111", None, "knockout", "knockout", "#111111", "#111111", "#111111"),
    Treatment("mono-white", "#111111", "#FFFFFF", "#FFFFFF", None, "knockout", "knockout", "#FFFFFF", "#FFFFFF", "#FFFFFF"),
    Treatment("mono-indigo", "#FFFFFF", "#4F46E5", "#4F46E5", None, "knockout", "knockout", "#4F46E5", "#4F46E5", "#4F46E5"),
]

_uid = 0


def uid(prefix: str) -> str:
    global _uid
    _uid += 1
    return f"{prefix}{_uid}"


def slash_path(x: float, y: float, s: float) -> str:
    x1, y1, x2, y2 = SLASH
    return f"M{x + x1 * s:.2f} {y + y1 * s:.2f} L{x + x2 * s:.2f} {y + y2 * s:.2f}"


def cursor_rect(x: float, y: float, s: float, fill: str, cursor=None) -> str:
    cx, cy, cw, ch = cursor or CURSOR
    return (
        f'<rect x="{x + cx * s:.2f}" y="{y + cy * s:.2f}" width="{cw * s:.2f}" '
        f'height="{ch * s:.2f}" rx="{cw * s / 2:.2f}" fill="{fill}"/>'
    )


def tile_mark(t: Treatment, x: float, y: float, s: float, defs: list[str]) -> str:
    """The app icon tile (no shadow) at (x, y), tile size 100*s."""
    parts = []
    if t.tile_grad:
        gid = uid("g")
        a, b, c = t.tile_grad
        defs.append(
            f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="0.55" stop-color="{b}"/>'
            f'<stop offset="1" stop-color="{c}"/></linearGradient>'
        )
        fill = f"url(#{gid})"
    else:
        fill = t.tile or "#000"
    rect = f'<rect x="{x:.2f}" y="{y:.2f}" width="{100 * s:.2f}" height="{100 * s:.2f}" rx="{TILE_R * s:.2f}"'
    if t.slash_on_tile == "knockout":
        mid = uid("m")
        defs.append(
            f'<mask id="{mid}">{rect} fill="#fff"/>'
            f'<path d="{slash_path(x, y, s)}" stroke="#000" stroke-width="{SLASH_W * s:.2f}" stroke-linecap="round" fill="none"/>'
            f"{cursor_rect(x, y, s, '#000')}</mask>"
        )
        parts.append(f'{rect} fill="{fill}" mask="url(#{mid})"/>')
    else:
        parts.append(f'{rect} fill="{fill}"/>')
        parts.append(
            f'<path d="{slash_path(x, y, s)}" stroke="{t.slash_on_tile}" stroke-width="{SLASH_W * s:.2f}" stroke-linecap="round" fill="none"/>'
        )
        parts.append(cursor_rect(x, y, s, t.cursor_on_tile))
    return "".join(parts)


def outline_mark(t: Treatment, x: float, y: float, s: float, stroke_w: float) -> str:
    inset = stroke_w / 2
    return (
        f'<rect x="{x + inset:.2f}" y="{y + inset:.2f}" width="{100 * s - stroke_w:.2f}" height="{100 * s - stroke_w:.2f}" '
        f'rx="{TILE_R * s - inset:.2f}" fill="none" stroke="{t.outline}" stroke-width="{stroke_w:.2f}"/>'
        f'<path d="{slash_path(x, y, s)}" stroke="{t.outline}" stroke-width="{SLASH_W * s:.2f}" stroke-linecap="round" fill="none"/>'
        f"{cursor_rect(x, y, s, t.outline)}"
    )


def bare_mark(t: Treatment, x: float, y: float, s: float, defs: list[str], cursor=None) -> str:
    """Slash + cursor without the tile, same geometry as on the tile."""
    x1, y1, x2, y2 = SLASH
    if t.slash_bare == "gradient":
        gid = uid("g")
        a, b, c = GRADIENT
        defs.append(
            f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" '
            f'x1="{x + x1 * s:.2f}" y1="{y + y1 * s:.2f}" x2="{x + x2 * s:.2f}" y2="{y + y2 * s:.2f}">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="0.55" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient>'
        )
        stroke = f"url(#{gid})"
    else:
        stroke = t.slash_bare
    return (
        f'<path d="{slash_path(x, y, s)}" stroke="{stroke}" stroke-width="{SLASH_W * s:.2f}" stroke-linecap="round" fill="none"/>'
        f"{cursor_rect(x, y, s, t.cursor_bare, cursor)}"
    )


def svg(w: float, h: float, defs: list[str], body: str) -> str:
    d = f"<defs>{''.join(defs)}</defs>" if defs else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.2f}" height="{h:.2f}">'
        f"{d}{body}</svg>\n"
    )


# ---------------------------------------------------------------- variants

PAD = 12


def v_lockup_tile(t: Treatment) -> str:
    """App tile + "Polemic" in Inter Display."""
    s = 1.0  # tile 100
    txt = text_path("Polemic", "inter-display-semibold", 76, tracking=-0.015)
    gap = 26
    defs: list[str] = []
    body = tile_mark(t, PAD, PAD, s, defs)
    tx = PAD + 100 + gap
    baseline = PAD + 50 + txt.cap / 2
    body += f'<path transform="translate({tx:.2f} {baseline:.2f})" d="{txt.d}" fill="{t.text}"/>'
    return svg(tx + txt.width + PAD, 100 + 2 * PAD, defs, body)


def v_lockup_bare(t: Treatment) -> str:
    """Slash + cursor without the tile, then the wordmark."""
    s = 1.12
    txt = text_path("Polemic", "inter-display-semibold", 76, tracking=-0.015)
    defs: list[str] = []
    # mark bbox: x ≈ 24.4..75.6, y ≈ 18.75..80.8 (slash caps included)
    mx = PAD - 24.4 * s
    my = PAD + 50 - 49.8 * s  # centre of mark bbox on tile centre line
    body = bare_mark(t, mx, my, s, defs)
    tx = PAD + (75.6 - 24.4) * s + 30
    baseline = PAD + 50 + txt.cap / 2
    body += f'<path transform="translate({tx:.2f} {baseline:.2f})" d="{txt.d}" fill="{t.text}"/>'
    return svg(tx + txt.width + PAD, 100 + 2 * PAD, defs, body)


def v_command(t: Treatment) -> str:
    r"""\polemic as a LaTeX command: the icon's slash, JetBrains Mono, cursor."""
    size = 84
    txt = text_path("polemic", "mono-medium", size)
    defs: list[str] = []
    # Slash spans from cap height to the baseline, using the icon's angle.
    x1, y1, x2, y2 = SLASH
    slash_h = txt.cap * 1.02
    s = slash_h / (y2 - y1)
    baseline = PAD + 100 - 14
    # position so the slash's lower cap sits at the baseline
    my = baseline - y2 * s
    mx = PAD + SLASH_W * s / 2 - x1 * s
    stroke_w = SLASH_W * s
    if t.slash_bare == "gradient":
        gid = uid("g")
        a, b, c = GRADIENT
        defs.append(
            f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{mx + x1 * s:.2f}" y1="{my + y1 * s:.2f}" '
            f'x2="{mx + x2 * s:.2f}" y2="{my + y2 * s:.2f}"><stop offset="0" stop-color="{a}"/>'
            f'<stop offset="0.55" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient>'
        )
        stroke = f"url(#{gid})"
    else:
        stroke = t.slash_bare
    body = (
        f'<path d="{slash_path(mx, my, s)}" stroke="{stroke}" stroke-width="{stroke_w:.2f}" stroke-linecap="round" fill="none"/>'
    )
    tx = mx + x2 * s + stroke_w / 2 + size * 0.08
    body += f'<path transform="translate({tx:.2f} {baseline:.2f})" d="{txt.d}" fill="{t.text}"/>'
    # cursor: x-height tall, sits on the baseline
    cw = CURSOR[2] * s
    ch = txt.xh
    cx = tx + txt.width + size * 0.12
    body += f'<rect x="{cx:.2f}" y="{baseline - ch:.2f}" width="{cw:.2f}" height="{ch:.2f}" rx="{cw / 2:.2f}" fill="{t.cursor_bare}"/>'
    return svg(cx + cw + PAD, 100 + 2 * PAD, defs, body)


def v_stacked(t: Treatment) -> str:
    """Tile above the wordmark, centred (splash screen / README)."""
    txt = text_path("Polemic", "inter-display-medium", 44, tracking=-0.01)
    tile = 100
    gap = 26
    w = max(tile, txt.width) + 2 * PAD
    defs: list[str] = []
    body = tile_mark(t, (w - tile) / 2, PAD, 1.0, defs)
    baseline = PAD + tile + gap + txt.cap
    body += f'<path transform="translate({(w - txt.width) / 2:.2f} {baseline:.2f})" d="{txt.d}" fill="{t.text}"/>'
    return svg(w, baseline + PAD, defs, body)


def v_outline(t: Treatment) -> str:
    """Line version: outlined tile, for print, embroidery, mono favicons."""
    txt = text_path("Polemic", "inter-display-medium", 76, tracking=-0.01)
    gap = 26
    body = outline_mark(t, PAD, PAD, 1.0, 7)
    tx = PAD + 100 + gap
    baseline = PAD + 50 + txt.cap / 2
    body += f'<path transform="translate({tx:.2f} {baseline:.2f})" d="{txt.d}" fill="{t.text}"/>'
    return svg(tx + txt.width + PAD, 100 + 2 * PAD, [], body)


def v_wordmark(t: Treatment) -> str:
    """Wordmark only, with the cursor as the last glyph."""
    size = 92
    txt = text_path("Polemic", "inter-display-semibold", size, tracking=-0.02)
    baseline = PAD + 50 + txt.cap / 2
    body = f'<path transform="translate({PAD:.2f} {baseline:.2f})" d="{txt.d}" fill="{t.text}"/>'
    cw = size * 0.075
    ch = txt.cap
    cx = PAD + txt.width + size * 0.1
    body += f'<rect x="{cx:.2f}" y="{baseline - ch:.2f}" width="{cw:.2f}" height="{ch:.2f}" rx="{cw / 2:.2f}" fill="{t.cursor_bare}"/>'
    return svg(cx + cw + PAD, 100 + 2 * PAD, [], body)


def v_pill(t: Treatment) -> str:
    """The tile stretched into a pill, wordmark knocked out next to the slash."""
    size = 60
    txt = text_path("Polemic", "inter-display-semibold", size, tracking=-0.01)
    h = 100
    s = 1.0
    defs: list[str] = []
    x1, y1, x2, y2 = SLASH
    mark_w = (75.6 - 24.4) * s
    gap = 22
    tx = PAD + 22 + mark_w + gap
    w = tx + txt.width + 30
    pw = w - PAD
    baseline = PAD + 50 + txt.cap / 2
    rect = f'<rect x="{PAD}" y="{PAD}" width="{pw - PAD:.2f}" height="{h}" rx="{TILE_R * s:.2f}"'
    mx = PAD + 22 - 24.4 * s
    my = PAD + 50 - 49.8 * s
    slash = f'<path d="{slash_path(mx, my, s)}" stroke="{{c}}" stroke-width="{SLASH_W * s:.2f}" stroke-linecap="round" fill="none"/>'
    word = f'<path transform="translate({tx:.2f} {baseline:.2f})" d="{txt.d}" fill="{{c}}"/>'
    if t.tile_grad:
        gid = uid("g")
        a, b, c = t.tile_grad
        defs.append(
            f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="0.55" stop-color="{b}"/>'
            f'<stop offset="1" stop-color="{c}"/></linearGradient>'
        )
        fill = f"url(#{gid})"
    else:
        fill = t.tile or "#000"
    if t.slash_on_tile == "knockout":
        mid = uid("m")
        defs.append(
            f'<mask id="{mid}">{rect} fill="#fff"/>'
            + slash.format(c="#000") + cursor_rect(mx, my, s, "#000") + word.format(c="#000")
            + "</mask>"
        )
        body = f'{rect} fill="{fill}" mask="url(#{mid})"/>'
    else:
        body = f'{rect} fill="{fill}"/>' + slash.format(c=t.slash_on_tile)
        body += cursor_rect(mx, my, s, t.cursor_on_tile) + word.format(c=t.slash_on_tile)
    return svg(w, h + 2 * PAD, defs, body)


def v_ligature(t: Treatment) -> str:
    """Wordmark where the icon's slash stands in for the "l"."""
    size = 92
    left = text_path("Po", "inter-display-semibold", size, tracking=-0.02)
    right = text_path("emic", "inter-display-semibold", size, tracking=-0.02)
    defs: list[str] = []
    baseline = PAD + 50 + left.cap / 2
    body = f'<path transform="translate({PAD:.2f} {baseline:.2f})" d="{left.d}" fill="{t.text}"/>'
    # slash spans ascender height (the "l" height) down to the baseline, at the icon's angle
    x1, y1, x2, y2 = SLASH
    asc = left.cap * 1.02
    s = asc / (y2 - y1)
    stroke_w = size * 0.115  # match the stem weight of Inter Display SemiBold
    sw_units = stroke_w / s
    mx = PAD + left.width + size * 0.02 - x1 * s + stroke_w / 2
    my = baseline - y2 * s
    if t.slash_bare == "gradient":
        gid = uid("g")
        a, b, c = GRADIENT
        defs.append(
            f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{mx + x1 * s:.2f}" y1="{my + y1 * s:.2f}" '
            f'x2="{mx + x2 * s:.2f}" y2="{my + y2 * s:.2f}"><stop offset="0" stop-color="{a}"/>'
            f'<stop offset="0.55" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient>'
        )
        stroke = f"url(#{gid})"
    else:
        stroke = t.slash_bare
    body += f'<path d="{slash_path(mx, my, s)}" stroke="{stroke}" stroke-width="{stroke_w:.2f}" stroke-linecap="round" fill="none"/>'
    tx = mx + x2 * s + stroke_w / 2 + size * 0.03
    body += f'<path transform="translate({tx:.2f} {baseline:.2f})" d="{right.d}" fill="{t.text}"/>'
    cw = size * 0.075
    ch = left.cap
    cx = tx + right.width + size * 0.1
    body += f'<rect x="{cx:.2f}" y="{baseline - ch:.2f}" width="{cw:.2f}" height="{ch:.2f}" rx="{cw / 2:.2f}" fill="{t.cursor_bare}"/>'
    return svg(cx + cw + PAD, 100 + 2 * PAD, defs, body)


VARIANTS = {
    "lockup-tile": ("Lockup: app tile + Inter Display", v_lockup_tile),
    "lockup-mark": ("Lockup: bare mark + Inter Display", v_lockup_bare),
    "command": ("Command: \\polemic in JetBrains Mono", v_command),
    "outline": ("Outline: line tile + Inter Display", v_outline),
    "wordmark": ("Wordmark: Inter Display + cursor", v_wordmark),
    "pill": ("Pill: wordmark inside the tile", v_pill),
    "ligature": ("Ligature: slash as the l", v_ligature),
    "stacked": ("Stacked: tile over wordmark", v_stacked),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for vkey, (title, fn) in VARIANTS.items():
        cells = []
        for t in TREATMENTS:
            content = fn(t)
            name = f"{vkey}-{t.name}.svg"
            (OUT / name).write_text(content)
            cells.append(
                f'<td style="background:{t.bg}"><img src="{name}" alt="{name}"></td>'
            )
        rows.append(f"<tr><th>{title}</th>{''.join(cells)}</tr>")
    head = "".join(f"<th>{t.name}</th>" for t in TREATMENTS)
    html = f"""<!doctype html><meta charset="utf-8"><title>Polemic logo explorations</title>
<style>
body{{margin:0;padding:24px;background:#E7E5EC;font:13px/1.4 Inter,system-ui,sans-serif;color:#333}}
table{{border-collapse:separate;border-spacing:10px}}
th{{font-weight:600;text-align:left;padding:4px 6px;white-space:nowrap}}
td{{padding:22px;border-radius:12px;vertical-align:middle;text-align:center}}
td img{{height:72px;display:block;margin:0 auto}}
tr:last-child td img{{height:150px}}
</style>
<h1 style="font-size:16px;margin:0 0 12px">Polemic — logo explorations</h1>
<table><tr><th></th>{head}</tr>{''.join(rows)}</table>
"""
    (OUT / "contact-sheet.html").write_text(html)
    print(f"wrote {len(VARIANTS) * len(TREATMENTS)} SVGs to {OUT}")


if __name__ == "__main__":
    main()
