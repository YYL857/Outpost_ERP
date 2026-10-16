# -*- coding: utf-8 -*-
"""Compose vivid v3 Noon store kits at exact upload sizes from AI logo + banner BG."""
from __future__ import annotations

from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ASSETS = Path(r"C:\Users\admin\.cursor\projects\d-Outpost-ERP\assets")
OUT = Path(r"d:\Outpost_ERP\assets\noon-store-visuals\v3")
BANNER = (1440, 240)

EN_NAME = "Bait Al Um Wal Tifl"
EN_SLOGAN = "CARE FOR LITTLE ONES"
AR_NAME = "بيت الأم والطفل"
AR_SLOGAN = "رعاية الأم والطفل"

FONT_EN_B = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_EN = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_AR = Path(r"C:\Windows\Fonts\tahoma.ttf")
FONT_AR_B = Path(r"C:\Windows\Fonts\tahomabd.ttf")


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def ar(s: str) -> str:
    return get_display(arabic_reshaper.reshape(s))


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def fit_font(path: Path, text: str, max_w: int, start: int, mn: int = 16) -> ImageFont.FreeTypeFont:
    size = start
    while size >= mn:
        f = font(path, size)
        b = f.getbbox(text)
        if b[2] - b[0] <= max_w:
            return f
        size -= 1
    return font(path, mn)


def find_logo(stem: str) -> Path:
    for ext in (".jpg", ".png", ".jpeg", ".webp"):
        p = ASSETS / f"{stem}{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(stem)


def prep_logo_square(src: Path, size: int, brand: tuple[int, int, int]) -> Image.Image:
    """Center-crop to square, resize; optional thin brand edge for trademark punch."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    im = im.crop((left, top, left + side, top + side)).resize((size, size), Image.Resampling.LANCZOS)
    # boost saturation slightly for punch on listings
    rgb = im.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(1.15)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.05)
    return rgb


def crop_banner_strip(src: Path) -> Image.Image:
    """Take 16:9 (or any) image and center-crop to exact 1440x240 (6:1)."""
    im = Image.open(src).convert("RGB")
    tw, th = BANNER
    target_ratio = tw / th
    w, h = im.size
    if w / h > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        im = im.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        im = im.crop((0, top, w, top + new_h))
    return im.resize(BANNER, Image.Resampling.LANCZOS)


def soften_center(img: Image.Image, strength: float = 0.72) -> Image.Image:
    """Whitish soft panel in center so text/logo stay readable over busy sides."""
    w, h = img.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    # soft rounded white band
    margin_x = int(w * 0.18)
    d.rounded_rectangle(
        [margin_x, 8, w - margin_x, h - 8],
        radius=40,
        fill=(255, 255, 255, int(255 * strength)),
    )
    blurred = overlay.filter(ImageFilter.GaussianBlur(10))
    return Image.alpha_composite(img.convert("RGBA"), blurred).convert("RGB")


def circular_logo(logo: Image.Image, diameter: int) -> Image.Image:
    logo = logo.resize((diameter, diameter), Image.Resampling.LANCZOS)
    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, diameter - 1, diameter - 1], fill=255)
    out = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    out.paste(logo, (0, 0))
    out.putalpha(mask)
    # white ring
    ring_d = diameter + 8
    ring = Image.new("RGBA", (ring_d, ring_d), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([0, 0, ring_d - 1, ring_d - 1], fill=(255, 255, 255, 255))
    ImageDraw.Draw(ring).ellipse([2, 2, ring_d - 3, ring_d - 3], outline=(255, 255, 255, 255), width=2)
    ring.paste(out, (4, 4), out)
    return ring


def make_banner(bg: Image.Image, logo_sq: Image.Image, lang: str, brand: tuple[int, int, int], text_c: tuple[int, int, int]) -> Image.Image:
    img = soften_center(bg, 0.78)
    # slight color boost on sides already in bg
    d = ImageDraw.Draw(img)
    logo_r = circular_logo(logo_sq, 88)

    if lang == "en":
        name, slogan = EN_NAME, EN_SLOGAN
        name_f = fit_font(FONT_EN_B, name, 700, 42, 24)
        slogan_f = font(FONT_EN_B, 17)
        logo_left = True
    else:
        name, slogan = ar(AR_NAME), ar(AR_SLOGAN)
        name_f = fit_font(FONT_AR_B if FONT_AR_B.exists() else FONT_AR, name, 700, 38, 22)
        slogan_f = font(FONT_AR_B if FONT_AR_B.exists() else FONT_AR, 16)
        logo_left = False

    nb = name_f.getbbox(name)
    sb = slogan_f.getbbox(slogan)
    nw, nh = nb[2] - nb[0], nb[3] - nb[1]
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]
    gap = 16
    lw, lh = logo_r.size
    lock_w = lw + gap + max(nw, sw)
    lock_h = max(lh, nh + 8 + sh)
    w, h = img.size
    lx0 = (w - lock_w) // 2
    ly0 = (h - lock_h) // 2
    text_h = nh + 8 + sh
    ty = ly0 + (lock_h - text_h) // 2

    if logo_left:
        logo_x = lx0
        tx = lx0 + lw + gap
        slogan_x = tx
    else:
        logo_x = lx0 + lock_w - lw
        tx = logo_x - gap - nw
        slogan_x = logo_x - gap - sw

    rgba = img.convert("RGBA")
    rgba.alpha_composite(logo_r, (logo_x, ly0 + (lock_h - lh) // 2))
    img = rgba.convert("RGB")
    d = ImageDraw.Draw(img)
    d.text((tx, ty), name, font=name_f, fill=text_c)
    d.text((slogan_x, ty + nh + 8), slogan, font=slogan_f, fill=brand)
    # bright accent bar bottom
    d.rectangle([0, h - 5, w, h], fill=brand)
    return img


def listing_preview(logo100: Image.Image, brand: tuple[int, int, int]) -> Image.Image:
    logo_s, bar_h, text_w = 64, 64, 430
    bar = Image.new("RGB", (logo_s + text_w, bar_h), brand)
    bar.paste(logo100.resize((logo_s, logo_s), Image.Resampling.LANCZOS), (0, 0))
    d = ImageDraw.Draw(bar)
    line = "BAIT AL UM WAL TIFL OFFICIAL STORE"
    f = fit_font(FONT_EN_B, line, text_w - 20, 18, 11)
    b = f.getbbox(line)
    d.text((logo_s + 12, (bar_h - (b[3] - b[1])) // 2 - 2), line, font=f, fill=(255, 255, 255))
    card = Image.new("RGB", (520, 520), (245, 245, 245))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([16, 16, 504, 504], radius=18, fill=(255, 255, 255))
    cd.ellipse([150, 110, 370, 330], fill=(235, 235, 235))
    cd.text((200, 205), "Product", font=font(FONT_EN, 22), fill=(190, 190, 190))
    card.paste(bar, (30, 520 - 30 - bar_h))
    return card


KITS = [
    {
        "id": "K1_coral_home",
        "label": "Vivid Coral Home",
        "logo": "v3-k1-logo",
        "bg": "v3-k1-banner-bg",
        "brand": hex_rgb("#FF5C7A"),
        "text": hex_rgb("#2B1A1F"),
    },
    {
        "id": "K2_teal_family",
        "label": "Teal Mother & Child",
        "logo": "v3-k2-logo",
        "bg": "v3-k2-banner-bg",
        "brand": hex_rgb("#2BBBAD"),
        "text": hex_rgb("#1A2E2C"),
    },
    {
        "id": "K3_sunny_cradle",
        "label": "Sunny Cradle",
        "logo": "v3-k3-logo",
        "bg": "v3-k3-banner-bg",
        "brand": hex_rgb("#FF9F1A"),
        "text": hex_rgb("#2A2110"),
    },
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for kit in KITS:
        folder = OUT / kit["id"]
        folder.mkdir(parents=True, exist_ok=True)
        logo_src = find_logo(kit["logo"])
        bg_src = find_logo(kit["bg"])
        logo100 = prep_logo_square(logo_src, 100, kit["brand"])
        logo400 = prep_logo_square(logo_src, 400, kit["brand"])
        logo100.save(folder / "logo_100x100.png", "PNG", optimize=True)
        logo400.save(folder / "logo_preview_400.png", "PNG", optimize=True)

        bg = crop_banner_strip(bg_src)
        # boost banner color a bit
        bg = ImageEnhance.Color(bg).enhance(1.2)
        bg = ImageEnhance.Brightness(bg).enhance(1.05)

        en = make_banner(bg, logo400, "en", kit["brand"], kit["text"])
        ar_b = make_banner(bg, logo400, "ar", kit["brand"], kit["text"])
        en.save(folder / "banner_en_1440x240.png", "PNG", optimize=True)
        ar_b.save(folder / "banner_ar_1440x240.png", "PNG", optimize=True)
        listing_preview(logo100, kit["brand"]).save(folder / "listing_badge_preview.png", "PNG", optimize=True)

        for name, exp in [
            ("logo_100x100.png", (100, 100)),
            ("banner_en_1440x240.png", BANNER),
            ("banner_ar_1440x240.png", BANNER),
        ]:
            p = folder / name
            assert Image.open(p).size == exp
            assert p.stat().st_size < 2 * 1024 * 1024
        print("OK", kit["id"])
    print("Done", OUT)


if __name__ == "__main__":
    main()
