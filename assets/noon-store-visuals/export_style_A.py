# -*- coding: utf-8 -*-
"""Export Style A (storybook) to Noon upload sizes + listing preview."""
from __future__ import annotations

from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ASSETS = Path(r"C:\Users\admin\.cursor\projects\d-Outpost-ERP\assets")
OUT = Path(r"d:\Outpost_ERP\assets\noon-store-visuals\styleA_storybook")
BANNER = (1440, 240)

EN_NAME = "Bait Al Um Wal Tifl"
EN_SLOGAN = "Care for Little Ones"
AR_NAME = "بيت الأم والطفل"
AR_SLOGAN = "رعاية الأم والطفل"

FONT_EN_B = Path(r"C:\Windows\Fonts\georgia.ttf")
FONT_EN = Path(r"C:\Windows\Fonts\georgiai.ttf")
if not FONT_EN_B.exists():
    FONT_EN_B = Path(r"C:\Windows\Fonts\segoeuib.ttf")
    FONT_EN = Path(r"C:\Windows\Fonts\segoeuii.ttf")
FONT_AR_B = Path(r"C:\Windows\Fonts\tahomabd.ttf")
FONT_AR = Path(r"C:\Windows\Fonts\tahoma.ttf")


def ar(s: str) -> str:
    return get_display(arabic_reshaper.reshape(s))


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def fit_font(path: Path, text: str, max_w: int, start: int, mn: int = 14) -> ImageFont.FreeTypeFont:
    size = start
    while size >= mn:
        f = font(path, size)
        b = f.getbbox(text)
        if b[2] - b[0] <= max_w:
            return f
        size -= 1
    return font(path, mn)


def find(stem: str) -> Path:
    for ext in (".jpg", ".png", ".jpeg", ".webp"):
        p = ASSETS / f"{stem}{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(stem)


def square_logo(src: Path, size: int) -> Image.Image:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    side = min(w, h)
    # prefer center; for this logo the emblem is centered
    left = (w - side) // 2
    top = (h - side) // 2
    im = im.crop((left, top, left + side, top + side))
    im = im.resize((size, size), Image.Resampling.LANCZOS)
    im = ImageEnhance.Color(im).enhance(1.08)
    return im


def crop_6x1(src: Path) -> Image.Image:
    """Center-crop any image to exact 1440x240."""
    im = Image.open(src).convert("RGB")
    tw, th = BANNER
    ratio = tw / th
    w, h = im.size
    if w / h > ratio:
        nw = int(h * ratio)
        left = (w - nw) // 2
        im = im.crop((left, 0, left + nw, h))
    else:
        nh = int(w / ratio)
        # bias slightly upward to keep sky+emblem (avoid cutting logo)
        top = max(0, int((h - nh) * 0.35))
        im = im.crop((0, top, w, top + nh))
    return im.resize(BANNER, Image.Resampling.LANCZOS)


def soft_halo_text(base: Image.Image, xy, text, fnt, fill, halo=(255, 250, 240), halo_a=220):
    x, y = xy
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for dx, dy in (
        (-3, 0), (3, 0), (0, -3), (0, 3),
        (-2, -2), (2, 2), (-2, 2), (2, -2),
        (-1, 0), (1, 0), (0, -1), (0, 1),
    ):
        d.text((x + dx, y + dy), text, font=fnt, fill=(*halo, halo_a))
    layer = layer.filter(ImageFilter.GaussianBlur(1.8))
    d = ImageDraw.Draw(layer)
    d.text((x, y), text, font=fnt, fill=(*fill, 255))
    out = Image.alpha_composite(base.convert("RGBA"), layer)
    base.paste(out.convert("RGB"))


def circularize(logo: Image.Image, d: int) -> Image.Image:
    logo = logo.resize((d, d), Image.Resampling.LANCZOS)
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, d - 1, d - 1], fill=255)
    out = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    out.paste(logo, (0, 0))
    out.putalpha(mask)
    ring = Image.new("RGBA", (d + 6, d + 6), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([0, 0, d + 5, d + 5], fill=(255, 245, 230, 230))
    ring.paste(out, (3, 3), out)
    return ring


def compose_banner(
    blank: Image.Image,
    logo400: Image.Image,
    lang: str,
) -> Image.Image:
    """Full-bleed scenic + logo + correct text (EN or AR). No white card."""
    img = blank.copy()
    w, h = img.size
    # very light warm lift only for readability — still painted through
    wash = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = wash.load()
    mid = (w - 1) / 2.0
    for x in range(w):
        t = abs(x - mid) / mid
        a = int(70 * max(0, 1 - (t / 0.50) ** 1.7)) if t < 0.60 else 0
        for y in range(h):
            px[x, y] = (255, 246, 230, a)
    wash = wash.filter(ImageFilter.GaussianBlur(20))
    img = Image.alpha_composite(img.convert("RGBA"), wash).convert("RGB")

    if lang == "en":
        name, slogan = EN_NAME, EN_SLOGAN
        name_f = fit_font(FONT_EN_B, name, 900, 46, 24)
        slogan_f = font(FONT_EN if FONT_EN.exists() else FONT_EN_B, 18)
        logo_left = True
        name_c, slogan_c = (48, 28, 20), (196, 86, 64)
    else:
        name, slogan = ar(AR_NAME), ar(AR_SLOGAN)
        name_f = fit_font(FONT_AR_B if FONT_AR_B.exists() else FONT_AR, name, 900, 44, 24)
        slogan_f = font(FONT_AR if FONT_AR.exists() else FONT_AR_B, 18)
        logo_left = False
        name_c, slogan_c = (48, 28, 20), (196, 86, 64)

    nb = name_f.getbbox(name)
    sb = slogan_f.getbbox(slogan)
    nw, nh = nb[2] - nb[0], nb[3] - nb[1]
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]

    logo = circularize(logo400, 96)
    lw, lh = logo.size
    gap = 16
    lock_w = lw + gap + max(nw, sw)
    lock_h = max(lh, nh + 8 + sh)
    lx0 = (w - lock_w) // 2
    ly0 = (h - lock_h) // 2
    ty = ly0 + (lock_h - (nh + 8 + sh)) // 2

    if logo_left:
        logo_x = lx0
        tx = lx0 + lw + gap
        slogan_x = tx
    else:
        logo_x = lx0 + lock_w - lw
        tx = logo_x - gap - nw
        slogan_x = logo_x - gap - sw

    rgba = img.convert("RGBA")
    rgba.alpha_composite(logo, (logo_x, ly0 + (lock_h - lh) // 2))
    img = rgba.convert("RGB")
    soft_halo_text(img, (tx, ty), name, name_f, name_c)
    soft_halo_text(img, (slogan_x, ty + nh + 8), slogan, slogan_f, slogan_c)
    return img


def listing_preview(logo100: Image.Image) -> Image.Image:
    brand = (201, 112, 90)  # terracotta from palette
    logo_s, bar_h, text_w = 64, 64, 430
    bar = Image.new("RGB", (logo_s + text_w, bar_h), brand)
    bar.paste(logo100.resize((logo_s, logo_s), Image.Resampling.LANCZOS), (0, 0))
    d = ImageDraw.Draw(bar)
    line = "BAIT AL UM WAL TIFL OFFICIAL STORE"
    f = fit_font(Path(r"C:\Windows\Fonts\segoeuib.ttf"), line, text_w - 16, 17, 10)
    b = f.getbbox(line)
    d.text((logo_s + 10, (bar_h - (b[3] - b[1])) // 2 - 2), line, font=f, fill=(255, 248, 240))
    card = Image.new("RGB", (520, 520), (245, 245, 245))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([16, 16, 504, 504], radius=18, fill=(255, 255, 255))
    cd.ellipse([150, 110, 370, 330], fill=(235, 235, 235))
    cd.text((200, 205), "Product", font=font(Path(r"C:\Windows\Fonts\segoeui.ttf"), 22), fill=(190, 190, 190))
    card.paste(bar, (30, 520 - 30 - bar_h))
    return card


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    logo_src = find("final-A-logo-source")
    en_src = find("final-A-banner-en-source")
    scenic = find("final-A-banner-scenic")

    logo100 = square_logo(logo_src, 100)
    logo400 = square_logo(logo_src, 400)
    logo100.save(OUT / "logo_100x100.png", "PNG", optimize=True)
    logo400.save(OUT / "logo_preview_400.png", "PNG", optimize=True)

    blank = crop_6x1(scenic)
    en = compose_banner(blank, logo400, "en")
    ar_b = compose_banner(blank, logo400, "ar")
    en.save(OUT / "banner_en_1440x240.png", "PNG", optimize=True)
    ar_b.save(OUT / "banner_ar_1440x240.png", "PNG", optimize=True)

    # wide concept keep for reference
    Image.open(en_src).convert("RGB").save(OUT / "preview_concept_wide.jpg", quality=92)
    Image.open(scenic).convert("RGB").save(OUT / "preview_scenic_wide.jpg", quality=92)
    listing_preview(logo100).save(OUT / "listing_badge_preview.png", "PNG")

    for name, exp in [
        ("logo_100x100.png", (100, 100)),
        ("banner_en_1440x240.png", BANNER),
        ("banner_ar_1440x240.png", BANNER),
    ]:
        p = OUT / name
        assert Image.open(p).size == exp, (p, Image.open(p).size)
        print(name, Image.open(p).size, f"{p.stat().st_size // 1024}KB")
    print("Done", OUT)


if __name__ == "__main__":
    main()
