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
# Caret: option D from caret-sheet.html. 80% of the slash's vertical extent
# (round caps included, 18.75..80.83), bottom-aligned with it, weight 7.
CURSOR = (70.2, 31.17, 7.0, 49.67)  # x y w h
CURSOR_R = 3.5

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


# ---------------------------------------------------------------- mauve icons
# Tints from polemic-website/app/global.css (mauve scale) and the purple
# wallpaper gradient in components/elements/wallpaper.tsx, with the same
# feTurbulence grain the site uses.

MAUVE = {
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

ICON_BACKGROUNDS = [
    # name, top colour, bottom colour, slash, caret
    ("wallpaper-purple", "#7b627d", "#8f6976", "#FFFFFF", PINK),
    ("wallpaper-purple-dark", "#412c42", "#3c1a26", "#FFFFFF", PINK),
    ("mauve-500-600", MAUVE[500], MAUVE[600], "#FFFFFF", PINK),
    ("mauve-600-800", MAUVE[600], MAUVE[800], "#FFFFFF", PINK),
    ("mauve-800-950", MAUVE[800], MAUVE[950], "#FFFFFF", PINK),
    ("mauve-900-950", MAUVE[900], MAUVE[950], MAUVE[100], PINK),
    ("mauve-200-300-light", MAUVE[200], MAUVE[300], MAUVE[950], PINK),
    ("mauve-500-600-muted-caret", MAUVE[500], MAUVE[600], "#FFFFFF", MAUVE[300]),
]


def grain_filter(fid: str, freq: float, amount: float) -> str:
    """Zero-bias monochrome grain blended over the source with 'overlay'.

    Noise is centred on 50% grey (overlay-neutral) and scaled by `amount`,
    so it textures without shifting the overall brightness.
    """
    slope = amount
    intercept = 0.5 - 0.5 * slope
    return (
        f'<filter id="{fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
        f'<feTurbulence type="fractalNoise" baseFrequency="{freq}" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>'
        '<feColorMatrix in="n" type="saturate" values="0" result="g"/>'
        '<feComponentTransfer in="g" result="c">'
        f'<feFuncR type="linear" slope="{slope}" intercept="{intercept:.4f}"/>'
        f'<feFuncG type="linear" slope="{slope}" intercept="{intercept:.4f}"/>'
        f'<feFuncB type="linear" slope="{slope}" intercept="{intercept:.4f}"/>'
        '<feFuncA type="table" tableValues="1 1"/>'
        "</feComponentTransfer>"
        '<feComposite in="c" in2="SourceGraphic" operator="in" result="ci"/>'
        '<feBlend in="ci" in2="SourceGraphic" mode="overlay"/>'
        "</filter>"
    )


def icon_svg(top: str, bottom: str, slash: str, caret: str, grain: float = 0.8, freq: float = 0.5) -> str:
    """1024 canvas in the macOS layout of assets/app-icon.svg: tile 824, rx 185.4."""
    s = 8.24
    x = y = 100
    body = [
        '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>',
        grain_filter("grain", freq, grain),
        '<filter id="tileShadow" x="-10%" y="-10%" width="120%" height="125%">'
        '<feDropShadow dx="0" dy="10" stdDeviation="5" flood-color="#000000" flood-opacity="0.3"/></filter>',
        '<linearGradient id="highlight" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/><stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>',
        f'<rect id="tile" x="{x}" y="{y}" width="824" height="824" rx="185.4"/>',
        '<clipPath id="tileClip"><use href="#tile"/></clipPath>',
    ]
    defs = "".join(body)
    content = (
        '<use href="#tile" fill="url(#bg)" filter="url(#tileShadow)"/>'
        '<g clip-path="url(#tileClip)"><use href="#tile" fill="url(#bg)" filter="url(#grain)"/></g>'
        '<use href="#tile" fill="none" stroke="url(#highlight)" stroke-width="8" clip-path="url(#tileClip)"/>'
        f'<path d="{slash_path(x, y, s)}" fill="none" stroke="{slash}" stroke-width="{SLASH_W * s:.1f}" stroke-linecap="round"/>'
        f"{cursor_rect(x, y, s, caret)}"
    )
    return svg(1024, 1024, [defs], content)


def write_icons() -> None:
    cells = []
    for name, top, bottom, slash, caret in ICON_BACKGROUNDS:
        fname = f"icon-{name}.svg"
        (OUT / fname).write_text(icon_svg(top, bottom, slash, caret))
        cells.append(
            f'<div class="cell"><img src="{fname}" style="width:256px"><div class="small">'
            f'<img src="{fname}" style="width:128px"><img src="{fname}" style="width:64px"><img src="{fname}" style="width:32px"></div>'
            f"<p>{name}</p></div>"
        )
    html = f"""<!doctype html><meta charset="utf-8"><title>Polemic icon: mauve backgrounds</title>
<style>
body{{margin:0;padding:24px;background:#F3F2F4;font:13px/1.4 Inter,system-ui,sans-serif;color:#333}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}}
.cell{{background:#fff;border-radius:12px;padding:12px;text-align:center}}
.small{{display:flex;align-items:flex-end;justify-content:center;gap:12px;margin-top:4px}}
p{{margin:8px 0 0;font-weight:600}}
</style>
<h1 style="font-size:16px;margin:0 0 12px">Polemic icon — mauve tints with grain</h1>
<div class="grid">{''.join(cells)}</div>
"""
    (OUT / "icon-mauve-sheet.html").write_text(html)
    print(f"wrote {len(ICON_BACKGROUNDS)} icons")


if __name__ == "__main__":
    write_icons()


# ---------------------------------------------------------------- ink marks
# Alternatives to the slash + caret, drawn as ink on the mauve tiles.
# Instrument Serif comes from the website (npm pack @fontsource/instrument-serif).

import math
import random

FONTS["instrument-italic"] = "/tmp/instr/package/files/instrument-serif-latin-400-italic.ttf"
FONTS["instrument"] = "/tmp/instr/package/files/instrument-serif-latin-400-normal.ttf"

INK_DARK = "oklch(14.5% 0.008 326)"  # mauve-950
INK_LIGHT = "oklch(96% 0.003 325.6)"  # mauve-100


def rough_filter(fid: str, s: float, scale: float = 1.4, freq: float = 0.018) -> str:
    """Ragged ink edge: displace the shape with low-frequency noise."""
    return (
        f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
        f'<feTurbulence type="fractalNoise" baseFrequency="{freq / s * 8.24:.4f}" numOctaves="3" seed="3" result="n"/>'
        f'<feDisplacementMap in="SourceGraphic" in2="n" scale="{scale * s:.2f}" xChannelSelector="R" yChannelSelector="G"/>'
        "</filter>"
    )


def bleed_filter(fid: str, s: float) -> str:
    """Wet ink soaking into paper: swell, blur, re-threshold, then roughen."""
    return (
        f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
        f'<feMorphology in="SourceGraphic" operator="dilate" radius="{0.25 * s:.2f}" result="d"/>'
        f'<feGaussianBlur in="d" stdDeviation="{0.9 * s:.2f}" result="b"/>'
        '<feComponentTransfer in="b" result="t"><feFuncA type="table" tableValues="0 0 0.2 1 1"/></feComponentTransfer>'
        f'<feTurbulence type="fractalNoise" baseFrequency="{0.03 / s * 8.24:.4f}" numOctaves="3" seed="5" result="n"/>'
        f'<feDisplacementMap in="t" in2="n" scale="{2.2 * s:.2f}" xChannelSelector="R" yChannelSelector="G"/>'
        "</filter>"
    )


def goo_filter(fid: str, s: float) -> str:
    """Blur + alpha contrast: merges circles into one organic blob."""
    return (
        f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
        f'<feGaussianBlur in="SourceGraphic" stdDeviation="{1.6 * s:.2f}" result="b"/>'
        '<feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="g"/>'
        f'<feTurbulence type="fractalNoise" baseFrequency="{0.02 / s * 8.24:.4f}" numOctaves="2" seed="9" result="n"/>'
        f'<feDisplacementMap in="g" in2="n" scale="{1.5 * s:.2f}" xChannelSelector="R" yChannelSelector="G"/>'
        "</filter>"
    )


def brush_stroke_path(x, y, s, p0, p1, w0, bow=1.5, taper=0.55, swell=0.15):
    """Closed outline of a brush stroke from p0 to p1 (tile units): round
    loaded start, slight swell, tapering to a point, slightly bowed."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    n = 36
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        cx = x0 + dx * t + nx * bow * math.sin(math.pi * t)
        cy = y0 + dy * t + ny * bow * math.sin(math.pi * t)
        h = w0 / 2 * (1 - t) ** taper * (1 - swell + swell * min(1.0, t / 0.2))
        left.append((cx + nx * h, cy + ny * h))
        right.append((cx - nx * h, cy - ny * h))
    r = w0 / 2 * (1 - swell)
    cap = []
    for i in range(1, 12):
        a = math.pi * i / 12
        cap.append((x0 - nx * r * math.cos(a) - ux * r * math.sin(a), y0 - ny * r * math.cos(a) - uy * r * math.sin(a)))
    pts = left + right[::-1] + cap
    return " ".join(f"{'M' if i == 0 else 'L'}{x + px * s:.2f} {y + py * s:.2f}" for i, (px, py) in enumerate(pts)) + " Z"


def splatter(x, y, s, cx, cy, ink, seed, n=7, spread=9.0, size=1.0):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(3, spread)
        r = rnd.uniform(0.8, 2.6) * size * (1 - d / (spread * 1.8))
        out.append(f'<circle cx="{x + (cx + math.cos(a) * d) * s:.2f}" cy="{y + (cy + math.sin(a) * d) * s:.2f}" r="{max(r, 0.5) * s:.2f}" fill="{ink}"/>')
    return "".join(out)


def mark_brush(x, y, s, defs, ink, accent):
    fid = uid("rough"); defs.append(rough_filter(fid, s))
    d = brush_stroke_path(x, y, s, (31, 23), (64, 80), 16)
    return f'<g filter="url(#{fid})"><path d="{d}" fill="{ink}"/>{splatter(x, y, s, 62, 78, ink, 1, n=5, spread=11, size=0.9)}</g>'


def mark_brush_pair(x, y, s, defs, ink, accent):
    """The icon's slash and caret, both as brush strokes."""
    fid = uid("rough"); defs.append(rough_filter(fid, s))
    d = brush_stroke_path(x, y, s, (28, 23), (60, 80), 16)
    c = brush_stroke_path(x, y, s, (73.5, 33), (72, 74), 9.5, bow=0.6, taper=0.45)
    return f'<g filter="url(#{fid})"><path d="{d}" fill="{ink}"/><path d="{c}" fill="{accent}"/></g>'


def mark_brush_dot(x, y, s, defs, ink, accent):
    fid = uid("rough"); defs.append(rough_filter(fid, s))
    d = brush_stroke_path(x, y, s, (27, 23), (59, 80), 16)
    dot = f'<circle cx="{x + 73 * s:.2f}" cy="{y + 72 * s:.2f}" r="{6.5 * s:.2f}" fill="{accent}"/>'
    return f'<g filter="url(#{fid})"><path d="{d}" fill="{ink}"/>{dot}</g>'


def mark_bleed(x, y, s, defs, ink, accent):
    fid = uid("bleed"); defs.append(bleed_filter(fid, s))
    return (
        f'<g filter="url(#{fid})">'
        f'<path d="{slash_path(x, y, s)}" stroke="{ink}" stroke-width="{SLASH_W * s:.2f}" stroke-linecap="round" fill="none"/>'
        f"{cursor_rect(x, y, s, accent)}</g>"
    )


def mark_drip(x, y, s, defs, ink, accent):
    """Brush slash, and ink running down from the top edge where the caret was."""
    fid = uid("rough"); defs.append(rough_filter(fid, s, scale=1.0))
    d = brush_stroke_path(x, y, s, (27, 23), (59, 80), 16)
    cx = 72
    drip = (
        f'<path d="M{x + (cx - 4) * s:.2f} {y - 2 * s:.2f} L{x + (cx + 4) * s:.2f} {y - 2 * s:.2f} '
        f'C{x + (cx + 4) * s:.2f} {y + 22 * s:.2f} {x + (cx + 2.2) * s:.2f} {y + 40 * s:.2f} {x + (cx + 2.4) * s:.2f} {y + 58 * s:.2f} '
        f'A{6.2 * s:.2f} {6.2 * s:.2f} 0 1 1 {x + (cx - 2.4) * s:.2f} {y + 58 * s:.2f} '
        f'C{x + (cx - 2.2) * s:.2f} {y + 40 * s:.2f} {x + (cx - 4) * s:.2f} {y + 22 * s:.2f} {x + (cx - 4) * s:.2f} {y - 2 * s:.2f} Z" fill="{accent}"/>'
    )
    return f'<g filter="url(#{fid})"><path d="{d}" fill="{ink}"/>{drip}</g>'


def mark_splat(x, y, s, defs, ink, accent):
    fid = uid("rough"); defs.append(rough_filter(fid, s, scale=1.2))
    gid = uid("goo"); defs.append(goo_filter(gid, s))
    d = brush_stroke_path(x, y, s, (27, 19), (55, 66), 14, taper=0.3)
    rnd = random.Random(4)
    blobs = [f'<circle cx="{x + 58 * s:.2f}" cy="{y + 72 * s:.2f}" r="{10.5 * s:.2f}" fill="{ink}"/>']
    for _ in range(12):
        a = rnd.uniform(0, 2 * math.pi); dd = rnd.uniform(7, 17)
        blobs.append(f'<circle cx="{x + (58 + math.cos(a) * dd) * s:.2f}" cy="{y + (72 + math.sin(a) * dd * 0.75) * s:.2f}" r="{rnd.uniform(1.6, 4.6) * s:.2f}" fill="{ink}"/>')
    return (
        f'<g filter="url(#{fid})"><path d="{d}" fill="{ink}"/></g>'
        f'<g filter="url(#{gid})">{"".join(blobs)}</g>'
        f'{splatter(x, y, s, 70, 68, accent, 11, n=7, spread=16, size=1.1)}'
    )


def mark_drop(x, y, s, defs, ink, accent):
    fid = uid("rough"); defs.append(rough_filter(fid, s, scale=0.6))
    d = (
        f'M{x + 50 * s:.2f} {y + 20 * s:.2f} '
        f'C{x + 50 * s:.2f} {y + 20 * s:.2f} {x + 29 * s:.2f} {y + 49 * s:.2f} {x + 29 * s:.2f} {y + 61 * s:.2f} '
        f'A{21 * s:.2f} {21 * s:.2f} 0 0 0 {x + 71 * s:.2f} {y + 61 * s:.2f} '
        f'C{x + 71 * s:.2f} {y + 49 * s:.2f} {x + 50 * s:.2f} {y + 20 * s:.2f} {x + 50 * s:.2f} {y + 20 * s:.2f} Z'
    )
    hl = f'<ellipse cx="{x + 41 * s:.2f}" cy="{y + 64 * s:.2f}" rx="{3.2 * s:.2f}" ry="{5.5 * s:.2f}" transform="rotate(25 {x + 41 * s:.2f} {y + 64 * s:.2f})" fill="{accent}"/>'
    return f'<g filter="url(#{fid})"><path d="{d}" fill="{ink}"/></g>{hl}'


def mark_nib(x, y, s, defs, ink, accent):
    cx, cy = x + 50 * s, y + 50 * s
    k = s * 0.92
    return (
        f'<g transform="translate({cx:.2f} {cy:.2f}) rotate(-31) scale({k:.3f})">'
        f'<path d="M0 34 L-12 8 C-15 2 -16 -8 -14 -20 C-13 -30 -8 -34 0 -34 C8 -34 13 -30 14 -20 C16 -8 15 2 12 8 Z" fill="{ink}"/>'
        f'<circle cx="0" cy="4" r="3.4" fill="{accent}"/>'
        f'<path d="M0 4 L0 31" stroke="{accent}" stroke-width="1.8" stroke-linecap="round"/>'
        "</g>"
    )


def mark_spill(x, y, s, defs, ink, accent):
    """One organic ink spill with a few satellite drops."""
    gid = uid("goo"); defs.append(goo_filter(gid, s))
    rnd = random.Random(31)
    blobs = []
    for _ in range(9):
        a = rnd.uniform(0, 2 * math.pi); dd = rnd.uniform(0, 12)
        blobs.append(f'<circle cx="{x + (49 + math.cos(a) * dd) * s:.2f}" cy="{y + (50 + math.sin(a) * dd) * s:.2f}" r="{rnd.uniform(9, 17) * s:.2f}" fill="{ink}"/>')
    hl = f'<ellipse cx="{x + 41 * s:.2f}" cy="{y + 42 * s:.2f}" rx="{3 * s:.2f}" ry="{5 * s:.2f}" transform="rotate(35 {x + 41 * s:.2f} {y + 42 * s:.2f})" fill="{accent}"/>'
    return f'<g filter="url(#{gid})">{"".join(blobs)}</g>{splatter(x, y, s, 72, 70, ink, 5, n=5, spread=12, size=1.2)}{hl}'


def mark_serif_p(x, y, s, defs, ink, accent):
    fid = uid("rough"); defs.append(rough_filter(fid, s, scale=1.1))
    txt = text_path("P", "instrument-italic", 78 * s)
    tx = x + (50 * s) - txt.width / 2 - 2 * s
    ty = y + 50 * s + txt.cap / 2
    return (
        f'<g filter="url(#{fid})"><path transform="translate({tx:.2f} {ty:.2f})" d="{txt.d}" fill="{ink}"/></g>'
        f'{splatter(x, y, s, 69, 72, accent, 8, n=5, spread=10, size=1.4)}'
    )


INK_MARKS = {
    "brush": mark_brush,
    "brush-pair": mark_brush_pair,
    "brush-dot": mark_brush_dot,
    "bleed": mark_bleed,
    "drip": mark_drip,
    "splat": mark_splat,
    "drop": mark_drop,
    "nib": mark_nib,
    "spill": mark_spill,
    "serif-p": mark_serif_p,
}

INK_TILES = [
    # name, top, bottom, ink, accent
    ("purple-dark-ink", "#7b627d", "#8f6976", INK_DARK, PINK),
    ("purple-light-ink", "#7b627d", "#8f6976", INK_LIGHT, PINK),
    ("dark-light-ink", MAUVE[800], MAUVE[950], INK_LIGHT, PINK),
    ("light-dark-ink", MAUVE[200], MAUVE[300], INK_DARK, PINK),
]


def ink_icon_svg(top: str, bottom: str, mark, ink: str, accent: str, grain: float = 0.8, freq: float = 0.5) -> str:
    s = 8.24
    x = y = 100
    defs = [
        '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>',
        grain_filter("grain", freq, grain),
        '<filter id="tileShadow" x="-10%" y="-10%" width="120%" height="125%">'
        '<feDropShadow dx="0" dy="10" stdDeviation="5" flood-color="#000000" flood-opacity="0.3"/></filter>',
        '<linearGradient id="highlight" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/><stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>',
        f'<rect id="tile" x="{x}" y="{y}" width="824" height="824" rx="185.4"/>',
        '<clipPath id="tileClip"><use href="#tile"/></clipPath>',
    ]
    body = mark(x, y, s, defs, ink, accent)
    content = (
        '<use href="#tile" fill="url(#bg)" filter="url(#tileShadow)"/>'
        '<g clip-path="url(#tileClip)"><use href="#tile" fill="url(#bg)" filter="url(#grain)"/></g>'
        '<use href="#tile" fill="none" stroke="url(#highlight)" stroke-width="8" clip-path="url(#tileClip)"/>'
        f'<g clip-path="url(#tileClip)">{body}</g>'
    )
    return svg(1024, 1024, defs, content)


def write_ink_icons() -> None:
    rows = []
    for tname, top, bottom, ink, accent in INK_TILES:
        cells = []
        for mname, fn in INK_MARKS.items():
            fname = f"ink-{mname}-{tname}.svg"
            (OUT / fname).write_text(ink_icon_svg(top, bottom, fn, ink, accent))
            cells.append(f'<td><img src="{fname}" style="width:200px"><div class="small"><img src="{fname}" style="width:64px"><img src="{fname}" style="width:32px"></div></td>')
        rows.append(f"<tr><th>{tname}</th>{''.join(cells)}</tr>")
    head = "".join(f"<th>{m}</th>" for m in INK_MARKS)
    html = f"""<!doctype html><meta charset="utf-8"><title>Polemic icon: ink marks</title>
<style>
body{{margin:0;padding:24px;background:#F3F2F4;font:13px/1.4 Inter,system-ui,sans-serif;color:#333}}
table{{border-collapse:separate;border-spacing:8px}}
th{{font-weight:600;text-align:left;white-space:nowrap}}
td{{background:#fff;border-radius:12px;padding:10px;text-align:center;vertical-align:top}}
.small{{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin-top:4px}}
</style>
<h1 style="font-size:16px;margin:0 0 12px">Polemic icon — ink marks</h1>
<table><tr><th></th>{head}</tr>{''.join(rows)}</table>
"""
    (OUT / "ink-sheet.html").write_text(html)
    print(f"wrote {len(INK_TILES) * len(INK_MARKS)} ink icons")


if __name__ == "__main__":
    write_ink_icons()
