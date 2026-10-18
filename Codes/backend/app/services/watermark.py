"""AI-generated labelling for stills (brief 6.4 / 7, IT Rules 2021 r.3(3)).

Embeds the label in PNG text metadata and EXIF, plus a light invisible
watermark (a keyed LSB pattern in the blue channel) that `detect()` finds
again. Stills are stored as lossless PNG so the watermark survives. Videos carry container
metadata (see av.tag_ai_generated); visible labels are always shown in the UI
and burned into exports.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
from PIL import Image

LABEL = "AI-generated recreation (Miss You). Not a real photograph."
_SEED = int(hashlib.sha256(b"missyou-watermark-v1").hexdigest()[:8], 16)


def _pattern(shape: tuple[int, int]) -> np.ndarray:
    rng = np.random.default_rng(_SEED)
    return rng.integers(0, 2, size=shape, dtype=np.uint8)


def mark_image(path: Path) -> Path:
    """Watermark + label; writes `<path>.png` and returns that path."""
    from PIL import PngImagePlugin
    with Image.open(path) as im:
        rgb = np.array(im.convert("RGB"))
    pat = _pattern(rgb.shape[:2])
    b = rgb[:, :, 2]
    rgb[:, :, 2] = (b & 0xFE) | pat
    out = Image.fromarray(rgb)
    exif = Image.Exif()
    exif[0x010E] = LABEL            # ImageDescription
    exif[0x0131] = "Miss You AI"    # Software
    exif[0x013B] = "AI-generated"   # Artist
    info = PngImagePlugin.PngInfo()
    info.add_text("Description", LABEL)
    info.add_text("Software", "Miss You AI")
    info.add_text("AI-Generated", "true")
    dest = path.with_suffix(".png")
    out.save(dest, "PNG", pnginfo=info, exif=exif.tobytes(), optimize=True)
    return dest


def detect(path: Path) -> float:
    """Fraction of agreeing LSBs (≈0.5 random, higher = watermark present)."""
    with Image.open(path) as im:
        rgb = np.array(im.convert("RGB"))
    pat = _pattern(rgb.shape[:2])
    return float(np.mean((rgb[:, :, 2] & 1) == pat))


def has_label(path: Path) -> bool:
    with Image.open(path) as im:
        return LABEL in str(getattr(im, "text", {}).get("Description", "")) or \
            LABEL in str(im.getexif().get(0x010E, ""))
