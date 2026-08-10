from __future__ import annotations

import io
import logging

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Standard credit-card proportions at 2x so it stays crisp on phone screens.
CARD_WIDTH = 1012
CARD_HEIGHT = 638
RADIUS = 48

INK = (18, 16, 16)
MUTED = (120, 113, 108)
ACCENT = (194, 65, 12)
CARD_BG = (255, 251, 247)
BAND_TOP = (28, 25, 23)


# Pillow's bundled face has no Turkish glyphs — "ü" and "ı" come out as empty
# boxes — so the image installs DejaVu and we load it explicitly.
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _font(size: int, *, bold: bool = False) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)
    except OSError:
        # Missing font must not take the card down; the caller degrades to the
        # plain-text code instead.
        logger.warning("membership_card.font_missing path=%s", FONT_REGULAR)
        return ImageFont.load_default(size=size)


def _fit(
    draw: ImageDraw.ImageDraw, text: str, size: int, max_width: int, *, bold: bool = False
) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    """Shrink until the text fits, so a long business name never overflows."""
    while size > 14:
        font = _font(size, bold=bold)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return _font(14, bold=bold)


def render_membership_card(
    *,
    business_name: str,
    program_name: str,
    member_name: str,
    member_code: str,
    progress_target: int,
) -> bytes:
    """Render the customer's loyalty card as a PNG.

    The code is the point of the card — a cashier reads it off the customer's
    phone — so it gets the most weight and the widest letter spacing.
    """
    image = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), CARD_BG)
    draw = ImageDraw.Draw(image)

    # Rounded card body with a dark header band.
    draw.rounded_rectangle(
        (0, 0, CARD_WIDTH - 1, CARD_HEIGHT - 1), radius=RADIUS, fill=CARD_BG
    )
    draw.rounded_rectangle((0, 0, CARD_WIDTH - 1, 210), radius=RADIUS, fill=BAND_TOP)
    draw.rectangle((0, 150, CARD_WIDTH - 1, 210), fill=BAND_TOP)

    name_font = _fit(draw, business_name, 46, CARD_WIDTH - 130, bold=True)
    draw.text((64, 58), business_name, font=name_font, fill=(255, 255, 255))
    draw.text((64, 128), program_name.upper(), font=_font(24), fill=(214, 211, 209))

    draw.text((64, 268), "ÜYELİK KODU", font=_font(22, bold=True), fill=MUTED)

    # Letter-spaced by hand: Pillow has no tracking control, and the spacing is
    # what makes a code readable at arm's length.
    code_font = _font(96, bold=True)
    x = 64
    for character in member_code:
        draw.text((x, 306), character, font=code_font, fill=ACCENT)
        x += int(draw.textlength(character, font=code_font)) + 14

    member_font = _fit(draw, member_name, 34, CARD_WIDTH - 130, bold=True)
    draw.text((64, 452), member_name, font=member_font, fill=INK)

    if progress_target > 0:
        draw.text(
            (64, 508),
            f"{progress_target} ziyarette ödül kazanırsınız",
            font=_font(24),
            fill=MUTED,
        )

    # Progress pips give the card something to grow into.
    if 0 < progress_target <= 12:
        pip_x = 64
        for _ in range(progress_target):
            draw.ellipse((pip_x, 560, pip_x + 26, 586), outline=ACCENT, width=3)
            pip_x += 40

    draw.text(
        (CARD_WIDTH - 200, CARD_HEIGHT - 68), "dixora", font=_font(26), fill=MUTED
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def safe_render_membership_card(**kwargs: object) -> bytes | None:
    """Never let card rendering break the enrolment it belongs to."""
    try:
        return render_membership_card(**kwargs)  # type: ignore[arg-type]
    except Exception:
        logger.warning("loyalty.card_render_failed", exc_info=True)
        return None
