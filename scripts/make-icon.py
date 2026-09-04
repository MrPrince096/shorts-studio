#!/usr/bin/env python3
"""Generate Shorts Studio app icon (.icns + .png) — gradient squircle + play + shorts frame."""
import math, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

S = 1024
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)


def squircle_mask(size, radius_frac=0.225):
    """Apple-style rounded-rect mask (supersampled)."""
    ss = size * 4
    m = Image.new("L", (ss, ss), 0)
    d = ImageDraw.Draw(m)
    r = int(ss * radius_frac)
    d.rounded_rectangle([0, 0, ss - 1, ss - 1], radius=r, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def vgrad(size, top, bottom):
    base = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        base.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base.resize((size, size))


def diag_grad(size, c1, c2):
    """Diagonal gradient (top-left c1 -> bottom-right c2)."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img


def build():
    # Brand gradient: deep indigo -> violet -> pink (matches app accent #7c5cff)
    bg = diag_grad(S, (79, 70, 229), (219, 39, 119))  # indigo -> pink
    # soft radial glow top-left
    glow = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-S * 0.3, -S * 0.35, S * 0.65, S * 0.6], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.12))
    white = Image.new("RGB", (S, S), (255, 255, 255))
    bg = Image.composite(white, bg, glow.point(lambda v: int(v * 0.28)))

    draw = ImageDraw.Draw(bg, "RGBA")

    # Shorts portrait frame (rounded vertical rectangle), subtle glassy white
    fw, fh = int(S * 0.40), int(S * 0.56)
    fx, fy = (S - fw) // 2, (S - fh) // 2
    draw.rounded_rectangle([fx, fy, fx + fw, fy + fh], radius=int(fw * 0.22),
                           fill=(255, 255, 255, 38), outline=(255, 255, 255, 150), width=int(S * 0.012))

    # Play triangle (centered), crisp white with soft shadow
    cx, cy = S // 2, S // 2
    tw = int(S * 0.135)
    th = int(tw * 1.15)
    tri = [(cx - tw * 0.55, cy - th), (cx - tw * 0.55, cy + th), (cx + tw * 1.05, cy)]
    # shadow
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.polygon([(p[0], p[1] + S * 0.012) for p in tri], fill=(0, 0, 0, 90))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.02))
    bg = Image.alpha_composite(bg.convert("RGBA"), sh)
    draw = ImageDraw.Draw(bg, "RGBA")
    draw.polygon(tri, fill=(255, 255, 255, 255))

    # sparkle accent (top-right of frame)
    def sparkle(cx, cy, r, a=235):
        pts = []
        for i in range(8):
            ang = math.pi / 4 * i
            rr = r if i % 2 == 0 else r * 0.36
            pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
        draw.polygon(pts, fill=(255, 255, 255, a))
    sparkle(fx + fw * 0.96, fy + fh * 0.12, S * 0.045)
    sparkle(fx + fw * 1.02, fy + fh * 0.22, S * 0.022, 180)

    # apply squircle mask
    mask = squircle_mask(S)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    return out


def main():
    icon = build()
    png = os.path.join(BUILD, "icon.png")
    icon.save(png)
    print("wrote", png)

    # Build .iconset -> .icns
    iset = os.path.join(BUILD, "icon.iconset")
    os.makedirs(iset, exist_ok=True)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for s in sizes:
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(iset, f"icon_{s}x{s}.png"))
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(iset, f"icon_{s//2}x{s//2}@2x.png"))
    # canonical names iconutil expects
    name_map = {
        "icon_16x16.png": 16, "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
    }
    for f in os.listdir(iset):
        os.remove(os.path.join(iset, f))
    for fname, s in name_map.items():
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(iset, fname))
    icns = os.path.join(BUILD, "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", iset, "-o", icns], check=True)
    print("wrote", icns)


if __name__ == "__main__":
    main()
