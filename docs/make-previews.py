"""Build README preview images from the two captured screenshots.

Crops each popover card out of its screenshot, scales it 2x, adds rounded
corners and a soft shadow, and composes a labelled side-by-side figure.
Run: python make-previews.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)

# Source screenshots (read-only attachments), copied first.
SOURCES = {
    "zh": Path(r"C:\Users\slren\.dsh\attachments\v1\objects\80\8005694f2cd793888689427a80c8029234fbd9429092e6023b60d5fe67d718d6"),
    "en": Path(r"C:\Users\slren\.dsh\attachments\v1\objects\a5\a5f9bb45f5d52af4a3f35cb755c097546d4e9a421e2fb9cca0b14f60b539a968"),
}

# The composer status row, where the chip actually lives, with a highlight
# rectangle around it: (source, crop box, highlight box inside the crop).
LOCATION = (
    Path(r"C:\Users\slren\.dsh\attachments\v1\objects\f2\f29951cb65a39367a939de77b68471de1100eb58bb756381b077c9169ee6e764"),
    (6, 4, 757, 143),
    (488, 112, 578, 137),
)

# Crop boxes inside each screenshot: (left, top, right, bottom).
# Measured from the card border/shadow, so the composer behind is excluded.
CROPS = {
    "zh": (339, 11, 666, 254),
    "en": (345, 16, 672, 259),
}

FONT_ZH = r"C:\Windows\Fonts\msyh.ttc"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"

def load(path: Path) -> Image.Image:
    if not path.exists():
        raise SystemExit(f"missing source: {path}")
    return Image.open(path).convert("RGB")


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def with_shadow(card: Image.Image, pad: int = 28) -> Image.Image:
    canvas = Image.new("RGBA", (card.width + pad * 2, card.height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    silhouette = Image.new("RGBA", card.size, (20, 30, 40, 70))
    shadow.paste(silhouette, (pad, pad + 10), card.split()[-1])
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(card, (pad, pad))
    return canvas


def label(text: str, font_path: str, size: int = 26) -> Image.Image:
    font = ImageFont.truetype(font_path, size)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    box = probe.textbbox((0, 0), text, font=font)
    img = Image.new("RGBA", (box[2] - box[0] + 4, box[3] - box[1] + 6), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((-box[0] + 2, -box[1] + 2), text, font=font, fill=(72, 84, 96, 255))
    return img


def build() -> None:
    panels = {}
    for key, source in SOURCES.items():
        img = load(source)
        box = CROPS[key]
        card = img.crop(box)
        card = card.resize((card.width * 2, card.height * 2), Image.LANCZOS)
        card = rounded(card, 24)
        panels[key] = with_shadow(card)

    cap_zh = label("中文", FONT_ZH)
    cap_en = label("English", FONT_EN)

    gap = 56
    margin = 48
    top = margin + 44
    width = margin * 2 + panels["zh"].width + gap + panels["en"].width
    height = top + max(panels["zh"].height, panels["en"].height) + margin

    bg = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    # Soft vertical gradient so the cards separate from the page.
    gradient = Image.new("RGB", (1, height))
    for y in range(height):
        t = y / max(1, height - 1)
        gradient.putpixel((0, y), (int(246 - 8 * t), int(248 - 8 * t), int(251 - 6 * t)))
    bg.paste(gradient.resize((width, height)), (0, 0))

    x = margin
    for key, caption in (("zh", cap_zh), ("en", cap_en)):
        panel = panels[key]
        bg.alpha_composite(panel, (x, top))
        bg.alpha_composite(caption, (x + (panel.width - caption.width) // 2, top - 42))
        x += panel.width + gap

    out = bg.convert("RGB")
    out.save(DOCS / "preview.png", optimize=True)
    for key in panels:
        panels[key].save(DOCS / f"preview-{key}.png", optimize=True)
    print("wrote", DOCS / "preview.png", out.size)

    build_location()


def build_location() -> None:
    """The composer status row, with a spotlight on where the chip lives.

    Dimming the surroundings reads better than a hand-drawn box: the chip keeps
    its real colours and nothing appears misaligned at a glance.
    """
    source, box, highlight = LOCATION
    shot = load(source).crop(box)
    shot = shot.resize((int(shot.width * 1.6), int(shot.height * 1.6)), Image.LANCZOS)

    pad = 18
    base = Image.new("RGBA", (shot.width + pad * 2, shot.height + pad * 2), (246, 248, 251, 255))
    base.paste(shot, (pad, pad))

    x0, y0, x1, y1 = (int(v * 1.6) for v in highlight)
    hole = [pad + x0 - 7, pad + y0 - 5, pad + x1 + 7, pad + y1 + 5]

    veil = Image.new("RGBA", base.size, (247, 249, 252, 185))
    ImageDraw.Draw(veil).rounded_rectangle(hole, radius=15, fill=(0, 0, 0, 0))
    out = Image.alpha_composite(base, veil)

    # A hairline edge so the bright area still reads as a defined region.
    ImageDraw.Draw(out).rounded_rectangle(hole, radius=15, outline=(63, 174, 114, 90), width=2)

    out.convert("RGB").save(DOCS / "location.png", optimize=True)
    print("wrote", DOCS / "location.png", out.size)


if __name__ == "__main__":
    sys.exit(build())
