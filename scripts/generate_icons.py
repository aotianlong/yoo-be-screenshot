#!/usr/bin/env python3
"""Generate extension icons (16 / 48 / 128)."""
from pathlib import Path
from math import ceil

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent / "icons"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_bg(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    top = (37, 99, 235)
    bottom = (29, 78, 216)
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        col = lerp(top, bottom, t)
        for x in range(size):
            px[x, y] = (*col, 255)
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_icon(size: int) -> Image.Image:
    pad = max(1, round(size * 0.08))
    radius = max(2, round(size * 0.22))
    img = gradient_bg(size)
    mask = rounded_mask(size, radius)
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg.paste(img, mask=mask)

    draw = ImageDraw.Draw(bg)
    white = (255, 255, 255, 255)
    white_soft = (255, 255, 255, 210)

    inner = pad + max(1, round(size * 0.06))
    screen_r = max(2, round(size * 0.12))
    screen_box = [inner, inner, size - inner - 1, size - inner - 1]
    draw.rounded_rectangle(
        screen_box,
        radius=screen_r,
        fill=(255, 255, 255, 42),
        outline=(255, 255, 255, 95),
        width=max(1, size // 32),
    )

    corner_inset = inner + max(2, round(size * 0.05))
    corner_len = max(3, round(size * 0.18))
    stroke = max(2, ceil(size * 0.075))
    if size <= 20:
        stroke = max(1, stroke - 1)
        corner_len = max(2, round(size * 0.22))

    left = corner_inset
    right = size - corner_inset - 1
    top = corner_inset
    bottom = size - corner_inset - 1

    def corners():
        draw.line([left, top, left + corner_len, top], fill=white, width=stroke)
        draw.line([left, top, left, top + corner_len], fill=white, width=stroke)
        draw.line([right - corner_len, top, right, top], fill=white, width=stroke)
        draw.line([right, top, right, top + corner_len], fill=white, width=stroke)
        draw.line([left, bottom, left + corner_len, bottom], fill=white, width=stroke)
        draw.line([left, bottom - corner_len, left, bottom], fill=white, width=stroke)
        draw.line([right - corner_len, bottom, right, bottom], fill=white, width=stroke)
        draw.line([right, bottom - corner_len, right, bottom], fill=white, width=stroke)

    corners()

    cx = cy = size // 2
    r_outer = max(2, round(size * 0.11))
    r_inner = max(1, round(size * 0.055))
    draw.ellipse(
        [cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer],
        fill=white,
        outline=white_soft,
        width=max(1, size // 48),
    )
    draw.ellipse(
        [cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner],
        fill=(37, 99, 235, 255),
    )

    shine_r = max(1, round(size * 0.09))
    sx = inner + shine_r
    sy = inner + shine_r
    draw.ellipse(
        [sx - shine_r, sy - shine_r, sx + shine_r, sy + shine_r],
        fill=(255, 255, 255, 55),
    )

    if size >= 48:
        bg = bg.filter(ImageFilter.SMOOTH_MORE)
    return bg


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        out = ROOT / f"icon{size}.png"
        draw_icon(size).save(out, optimize=True)
        print("wrote", out)


if __name__ == "__main__":
    main()
