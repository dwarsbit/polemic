"""Generate the Polemic app icon (first version).

Renders a rounded-square indigo gradient background with a white page
(document, folded corner) and an indigo "P" on it. Drawn at 4x and
downscaled with Lanczos for smooth antialiasing.

Run with: uv run --with pillow scripts/make-icon.py
"""

from PIL import Image, ImageDraw

SIZE = 1024
SCALE = 4
BIG = SIZE * SCALE

# Colors
TOP = (79, 70, 229)  # indigo-600
BOTTOM = (30, 27, 75)  # indigo-950-ish
PAGE = (250, 250, 250)
FOLD = (211, 211, 236)
LETTER = (49, 46, 129)  # indigo-900


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def main() -> None:
    # Gradient background on a rounded square with transparent corners.
    bg = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (BIG, BIG))
    for y in range(BIG):
        color = lerp(TOP, BOTTOM, y / BIG)
        for x in range(0, BIG, 64):
            ImageDraw.Draw(gradient).rectangle(
                [x, y, min(x + 64, BIG), y], fill=color
            )
    bg.paste(gradient, (0, 0))

    mask = Image.new("L", (BIG, BIG), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, BIG - 1, BIG - 1], radius=180 * SCALE, fill=255
    )
    canvas = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    canvas.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)

    # Page: white sheet with a folded top-right corner.
    left, top, right, bottom = 272 * SCALE, 208 * SCALE, 752 * SCALE, 816 * SCALE
    fold = 96 * SCALE
    radius = 28 * SCALE
    page_points = [
        (left + radius, top),
        (right - fold, top),
        (right, top + fold),
        (right, bottom - radius),
        (right - radius, bottom),
        (left + radius, bottom),
        (left, bottom - radius),
        (left, top + radius),
    ]
    draw.polygon(page_points, fill=PAGE)
    # Fold triangle (paper fold slightly darker than the page).
    draw.polygon(
        [
            (right - fold, top),
            (right - fold, top + fold),
            (right, top + fold),
        ],
        fill=FOLD,
    )

    # The letter P: stem plus a half-annulus bowl, in indigo on the page.
    p = draw
    stem_left = 352 * SCALE
    stem_right = 448 * SCALE
    stem_top = 368 * SCALE
    stem_bottom = 672 * SCALE
    bowl_r_outer = 132 * SCALE
    bowl_r_inner = 76 * SCALE
    bowl_cx = stem_right
    bowl_cy = stem_top + bowl_r_outer

    # Bowl: right half-disc, then cut the inner circle with the page color,
    # then draw the stem on top so the cutout does not erase it.
    p.pieslice(
        [
            bowl_cx - bowl_r_outer,
            bowl_cy - bowl_r_outer,
            bowl_cx + bowl_r_outer,
            bowl_cy + bowl_r_outer,
        ],
        start=270,
        end=90,
        fill=LETTER,
    )
    p.ellipse(
        [
            bowl_cx - bowl_r_inner,
            bowl_cy - bowl_r_inner,
            bowl_cx + bowl_r_inner,
            bowl_cy + bowl_r_inner,
        ],
        fill=PAGE,
    )
    p.rectangle(
        [stem_left, stem_top, stem_right, stem_bottom], fill=LETTER
    )

    icon = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    icon.save("assets/icon-source.png")
    print("wrote assets/icon-source.png")


if __name__ == "__main__":
    main()
