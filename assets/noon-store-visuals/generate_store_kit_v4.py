# -*- coding: utf-8 -*-
"""v4 banners: seamless integration — no floating white card."""
from __future__ import annotations

from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ASSETS = Path(r"C:\Users\admin\.cursor\projects\d-Outpost-ERP\assets")
OUT = Path(r"d:\Outpost_ERP\assets\noon-store-visuals\v4")
V3 = Path(r"d:\Outpost_ERP\assets\noon-store-visuals\v3")
BANNER = (1440, 240)

EN_NAME = "Bait Al Um Wal Tifl"
EN_SLOGAN = "CARE FOR LITTLE ONES"
AR_NAME = "بيت الأم والطفل"
AR_SLOGAN = "رعاية الأم والطفل"

FONT_EN_B = Path(r"C:\Windows\Fonts\segoeuib.ttf")
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


def find_asset(stem: str) -> Path:
    for ext in (".jpg", ".png", ".jpeg", ".webp"):
        p = ASSETS / f"{stem}{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(stem)


def crop_banner_strip(src: Path) -> Image.Image:
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


def soft_center_wash(img: Image.Image, peak: float = 0.55) -> Image.Image:
    """Gentle horizontal fade — brightens mid without a hard card/panel edge."""
    w, h = img.size
    wash = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = wash.load()
    mid = (w - 1) / 2
    # cosine falloff from center; no rounded rect silhouette
    for x in range(w):
        t = abs(x - mid) / mid  # 0 center → 1 edge
        # keep sides almost untouched; only soft lift in middle third
        if t < 0.35:
            a = peak * (1 - (t / 0.35) ** 1.6)
        else:
            a = 0.0
        alpha = int(255 * a)
        for y in range(h):
            # slight vertical softness too
            vy = abs(y - (h - 1) / 2) / ((h - 1) / 2)
            aa = int(alpha * (1 - 0.25 * vy))
            px[x, y] = (255, 252, 248, aa)
    wash = wash.filter(ImageFilter.GaussianBlur(18))
    return Image.alpha_composite(img.convert("RGBA"), wash).convert("RGB")


def circular_logo(logo: Image.Image, diameter: int) -> Image.Image:
    logo = logo.resize((diameter, diameter), Image.Resampling.LANCZOS)
    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, diameter - 1, diameter - 1], fill=255)
    out = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    out.paste(logo.convert("RGB"), (0, 0))
    out.putalpha(mask)
    # thin soft white rim (subtle, not a card)
    ring = Image.new("RGBA", (diameter + 6, diameter + 6), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([0, 0, diameter + 5, diameter + 5], fill=(255, 255, 255, 220))
    ring.paste(out, (3, 3), out)
    return ring


def text_with_soft_halo(
    base: Image.Image,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
) -> None:
    """Tiny soft halo for readability — still flat on canvas, not a box."""
    x, y = xy
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1)):
        ld.text((x + dx, y + dy), text, font=fnt, fill=(255, 255, 255, 140))
    layer = layer.filter(ImageFilter.GaussianBlur(1.2))
    ld = ImageDraw.Draw(layer)
    ld.text((x, y), text, font=fnt, fill=(*fill, 255))
    out = Image.alpha_composite(base.convert("RGBA"), layer)
    base.paste(out.convert("RGB"))


def make_banner(bg: Image.Image, logo_sq: Image.Image, lang: str, brand: tuple[int, int, int], text_c: tuple[int, int, int]) -> Image.Image:
    img = soft_center_wash(bg, peak=0.50)
    img = ImageEnhance.Color(img).enhance(1.12)
    logo_r = circular_logo(logo_sq, 92)

    if lang == "en":
        name, slogan = EN_NAME, EN_SLOGAN
        name_f = fit_font(FONT_EN_B, name, 720, 44, 24)
        slogan_f = font(FONT_EN_B, 18)
        logo_left = True
    else:
        name, slogan = ar(AR_NAME), ar(AR_SLOGAN)
        name_f = fit_font(FONT_AR_B if FONT_AR_B.exists() else FONT_AR, name, 720, 40, 22)
        slogan_f = font(FONT_AR_B if FONT_AR_B.exists() else FONT_AR, 17)
        logo_left = False

    nb = name_f.getbbox(name)
    sb = slogan_f.getbbox(slogan)
    nw, nh = nb[2] - nb[0], nb[3] - nb[1]
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]
    gap = 18
    lw, lh = logo_r.size
    lock_w = lw + gap + max(nw, sw)
    lock_h = max(lh, nh + 10 + sh)
    w, h = img.size
    lx0 = (w - lock_w) // 2
    ly0 = (h - lock_h) // 2
    text_h = nh + 10 + sh
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
    text_with_soft_halo(img, (tx, ty), name, name_f, text_c)
    text_with_soft_halo(img, (slogan_x, ty + nh + 10), slogan, slogan_f, brand)
    # thin brand accent line at bottom — continuous with design, not a card
    d = ImageDraw.Draw(img)
    d.rectangle([0, h - 4, w, h], fill=brand)
    return img


KITS = [
    {
        "id": "K1_coral_home",
        "logo_dir": "K1_coral_home",
        "bg": "v4-k1-banner-bg",
        "brand": hex_rgb("#FF5C7A"),
        "text": hex_rgb("#2B1A1F"),
    },
    {
        "id": "K2_teal_family",
        "logo_dir": "K2_teal_family",
        "bg": "v4-k2-banner-bg",
        "brand": hex_rgb("#2BBBAD"),
        "text": hex_rgb("#1A2E2C"),
    },
    {
        "id": "K3_sunny_cradle",
        "logo_dir": "K3_sunny_cradle",
        "bg": "v4-k3-banner-bg",
        "brand": hex_rgb("#FF9F1A"),
        "text": hex_rgb("#2A2110"),
    },
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for kit in KITS:
        folder = OUT / kit["id"]
        folder.mkdir(parents=True, exist_ok=True)
        # reuse vivid logos from v3
        logo100 = Image.open(V3 / kit["logo_dir"] / "logo_100x100.png").convert("RGB")
        logo400 = Image.open(V3 / kit["logo_dir"] / "logo_preview_400.png").convert("RGB")
        logo100.save(folder / "logo_100x100.png", "PNG", optimize=True)
        logo400.save(folder / "logo_preview_400.png", "PNG", optimize=True)
        Image.open(V3 / kit["logo_dir"] / "listing_badge_preview.png").save(
            folder / "listing_badge_preview.png", "PNG"
        )

        bg = crop_banner_strip(find_asset(kit["bg"]))
        en = make_banner(bg, logo400, "en", kit["brand"], kit["text"])
        ar_b = make_banner(bg, logo400, "ar", kit["brand"], kit["text"])
        en.save(folder / "banner_en_1440x240.png", "PNG", optimize=True)
        ar_b.save(folder / "banner_ar_1440x240.png", "PNG", optimize=True)

        for name, exp in [
            ("logo_100x100.png", (100, 100)),
            ("banner_en_1440x240.png", BANNER),
            ("banner_ar_1440x240.png", BANNER),
        ]:
            p = folder / name
            assert Image.open(p).size == exp, (p, Image.open(p).size)
        print("OK", kit["id"])
    print("Done", OUT)


if __name__ == "__main__":
    main()
