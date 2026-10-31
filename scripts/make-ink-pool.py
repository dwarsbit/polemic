"""Render the Polemic icon as an ink pool with ripples (raster, PNG).

A glossy pool of dark ink on the mauve, grained tile from the website, lit
from the top-left so the ripples catch the light. Rendered at 2x with numpy
and downsampled. Run: uv run --with numpy --with pillow scripts/make-ink-pool.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo" / "ink-pool"

S = 2048  # render size, downsampled to 1024
TILE = 824 * 2
INSET = 100 * 2
RADIUS = 185.4 * 2


def hex_rgb(h: str) -> np.ndarray:
    return np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rounded_rect_sdf(yy, xx, cx, cy, half, r):
    qx = np.abs(xx - cx) - (half - r)
    qy = np.abs(yy - cy) - (half - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def grain(shape, rng, amount, sigma=0.9):
    n = rng.normal(0, 1, shape).astype(np.float32)
    img = Image.fromarray(np.clip(n * 40 + 128, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
    n = (np.asarray(img).astype(np.float32) - 128) / 40
    return n * amount


def background(top, bottom, rng, grain_amount=11.0):
    t = np.linspace(0, 1, S, dtype=np.float32)[:, None]
    bg = hex_rgb(top)[None, None, :] * (1 - t[..., None]) + hex_rgb(bottom)[None, None, :] * t[..., None]
    bg = np.broadcast_to(bg, (S, S, 3)).copy()
    g = grain((S, S), rng, grain_amount)
    return bg + g[..., None]


def pool_radius(theta, r0, rng, harmonics=(2, 3, 4, 5, 6), wobble=0.07):
    r = np.ones_like(theta)
    for k in harmonics:
        a = rng.uniform(0.4, 1.0) * wobble / (k - 1)
        r += a * np.cos(k * theta + rng.uniform(0, 2 * np.pi))
    return r0 * r


def render(
    name: str,
    *,
    top="#7b627d",
    bottom="#8f6976",
    ink="#161218",
    env="#e9dde6",
    pool_frac=0.36,
    pool_center=(0.5, 0.52),
    impact=(0.0, 0.0),  # offset of the ripple centre, in pool radii
    wavelength=0.26,  # in pool radii, at the centre
    amplitude=6.0,  # height units (px at 2x)
    decay=0.45,  # in pool radii
    rings_phase=1.5708,  # a dip at the impact point
    meniscus=3.5,
    gloss=1.0,
    droplet=None,  # (x, y, r) in pool radii, or None
    wobble=0.07,
    seed=3,
    light=(-0.45, -0.6, 0.66),
):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    cx = cy = S / 2
    half = TILE / 2

    tile_sdf = rounded_rect_sdf(yy, xx, cx, cy, half, RADIUS)
    tile_a = smoothstep(0.8, -0.8, tile_sdf)

    bg = background(top, bottom, rng)
    # top highlight edge like the vector icon
    edge = smoothstep(-6, 0, tile_sdf) * np.clip(1 - (yy - INSET) / (TILE * 0.4), 0, 1)
    bg += (edge * 55)[..., None]

    # ---- pool shape
    R0 = pool_frac * TILE
    pcx, pcy = INSET + pool_center[0] * TILE, INSET + pool_center[1] * TILE
    dx, dy = xx - pcx, yy - pcy
    theta = np.arctan2(dy, dx)
    rr = np.hypot(dx, dy)
    R = pool_radius(theta, R0, rng, wobble=wobble)
    d = rr - R  # <0 inside
    pool_a = smoothstep(1.2, -1.2, d)

    # ---- height field: thin liquid film with a soft meniscus, plus a few
    # damped rings spreading from the impact point (longer waves travel further)
    inside = np.clip(-d, 0, None)
    h = meniscus * smoothstep(0, meniscus * 3.0, inside)
    icx, icy = pcx + impact[0] * R0, pcy + impact[1] * R0
    ir = np.hypot(xx - icx, yy - icy) / R0
    lam = wavelength * (1 + 0.55 * ir)  # dispersion: rings widen outwards
    phase = 2 * np.pi * ir / lam - rings_phase
    wave = np.sin(phase)
    env_w = np.exp(-ir / decay) * smoothstep(0, 0.3, inside / R0)
    h = h + amplitude * wave * env_w
    if droplet:
        ddx, ddy, dr = droplet
        h -= amplitude * 0.5 * np.exp(-((np.hypot(xx - (pcx + ddx * R0), yy - (pcy + ddy * R0)) / (dr * R0 * 1.6)) ** 2))

    gy, gx = np.gradient(h)
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)
    nx, ny = -gx * nz, -gy * nz
    L = np.array(light, dtype=np.float32); L /= np.linalg.norm(L)
    H = L + np.array([0, 0, 1], dtype=np.float32); H /= np.linalg.norm(H)
    ndl = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    ndh = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1)
    # a near-black mirror: reflections are high contrast. A tight key
    # highlight plus a broader one, both from the top-left, so ring slopes
    # facing the light become bright arcs on black. Flat ink stays dark.
    spec_sharp = ndh ** 320 * 1.6 * gloss
    spec_broad = ndh ** 28 * 0.45 * gloss
    # a soft window reflection top-left of the pool, broken up by the rings
    wx, wy = pcx - 0.42 * R0, pcy - 0.48 * R0
    window = np.exp(-((xx - wx) ** 2 + (yy - wy) ** 2) / (2 * (0.32 * R0) ** 2)) * 0.14 * gloss * (0.25 + 0.75 * ndh ** 10)
    fresnel = 0.02 + 0.5 * (1 - nz) ** 1.2
    sky = np.clip(-ny * 5, 0, 1) * 0.25 * gloss
    refl = spec_sharp + spec_broad + fresnel + sky + window
    refl = np.asarray(Image.fromarray(np.clip(refl * 120, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32) / 120
    ink_c = hex_rgb(ink)[None, None, :]
    env_c = hex_rgb(env)[None, None, :]
    pool = ink_c * (0.85 + 0.15 * ndl)[..., None] + env_c * refl[..., None]
    # faint mirror of the lighter sky in the top half of the pool
    pool += env_c * (smoothstep(0.1, -1.0, dy / R0) * 0.05 * gloss)[..., None]

    # ---- composite: contact shadow under the pool, then the pool
    sh = Image.fromarray((pool_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14))
    shadow = np.roll(np.asarray(sh).astype(np.float32) / 255, 6, axis=0) * 0.18
    img = bg * (1 - shadow[..., None])
    img = img * (1 - pool_a[..., None]) + pool * pool_a[..., None]

    if droplet:
        ddx, ddy, dr = droplet
        dcx, dcy, drad = pcx + ddx * R0, pcy + ddy * R0, dr * R0
        sd = np.hypot(xx - dcx, yy - dcy)
        da = smoothstep(1.2, -1.2, sd - drad)
        z = np.sqrt(np.clip(1 - (sd / drad) ** 2, 0, 1))
        snx, sny = (xx - dcx) / drad, (yy - dcy) / drad
        sndl = np.clip(snx * L[0] + sny * L[1] + z * L[2], 0, 1)
        sndh = np.clip(snx * H[0] + sny * H[1] + z * H[2], 0, 1)
        sphere = ink_c * (0.6 + 0.4 * sndl)[..., None] + env_c * (sndh ** 90 * 1.0 + 0.03 + 0.4 * (1 - z) ** 2)[..., None]
        # its shadow on the pool / tile
        dsh = Image.fromarray((da * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
        dshadow = np.roll(np.asarray(dsh).astype(np.float32) / 255, int(drad * 1.2), axis=0) * 0.35
        img = img * (1 - dshadow[..., None])
        img = img * (1 - da[..., None]) + sphere * da[..., None]

    # ---- tile mask, drop shadow, transparent corners
    rgb = np.clip(img, 0, 255)
    ts = Image.fromarray((tile_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
    tshadow = np.roll(np.asarray(ts).astype(np.float32) / 255, 20, axis=0) * 0.3
    alpha = np.clip(tile_a + tshadow * (1 - tile_a), 0, 1)
    out = np.zeros((S, S, 4), dtype=np.float32)
    out[..., :3] = rgb * (tile_a / np.maximum(alpha, 1e-6))[..., None]
    out[..., 3] = alpha * 255
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA").resize((1024, 1024), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / f"{name}.png")
    return im


VARIANTS = {
    "pool-centred": dict(),
    "pool-offcentre-drop": dict(impact=(0.2, -0.12), droplet=(0.2, -0.95, 0.1), pool_center=(0.5, 0.56)),
    "pool-more-rings": dict(wavelength=0.18, amplitude=5.0, decay=0.7),
    "pool-strong-rings": dict(wavelength=0.3, amplitude=11.0, decay=0.55, pool_frac=0.4),
    "pool-large": dict(pool_frac=0.47, wavelength=0.2, amplitude=6.0, decay=0.6, wobble=0.05),
    "pool-matte": dict(gloss=0.4, ink="#1b1620"),
    "pool-dark-tile": dict(top="#412c42", bottom="#3c1a26", ink="#0f0b11", env="#d9c7d4"),
    "pool-pink-ink": dict(ink="#8f1f5a", env="#ffd9ec", gloss=0.9),
}


def main() -> None:
    ims = {name: render(name, **kw) for name, kw in VARIANTS.items()}
    # contact sheet
    cell = 300
    sheet = Image.new("RGB", (cell * 4, (cell + 120) * 2), (243, 242, 244))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(ims.items()):
        x0, y0 = (i % 4) * cell, (i // 4) * (cell + 120)
        big = im.resize((256, 256), Image.LANCZOS)
        sheet.paste(big, (x0 + 22, y0 + 10), big)
        xs = x0 + 22
        for sz in (96, 48, 32, 16):
            small = im.resize((sz, sz), Image.LANCZOS)
            sheet.paste(small, (xs, y0 + 270 + (96 - sz)), small)
            xs += sz + 12
        draw.text((x0 + 22, y0 + 372), name, fill=(60, 55, 60))
    sheet.save(OUT / "sheet.png")
    print(f"wrote {len(ims)} icons to {OUT}")


if __name__ == "__main__":
    main()
