import io

import numpy as np
import pytest
from PIL import Image

from app.services import faces, ingest


def _jpeg_with_gps(path):
    im = Image.new("RGB", (64, 48), (200, 120, 90))
    exif = Image.Exif()
    exif[0x8825] = {2: (22.0, 34.0, 12.0), 1: "N"}  # GPSInfo
    exif[0x010F] = "PhoneMaker"
    im.save(path, "JPEG", exif=exif.tobytes())


def test_photo_normalise_strips_exif(tmp_path):
    src, dst = tmp_path / "a.jpg", tmp_path / "b.jpg"
    _jpeg_with_gps(src)
    assert Image.open(src).getexif()
    ingest.normalise_photo(src, dst)
    assert not dict(Image.open(dst).getexif())


def test_magic_bytes_not_extension(tmp_path):
    fake = tmp_path / "evil.jpg"
    fake.write_bytes(b"#!/bin/sh\necho hi\n")
    with pytest.raises(ingest.RejectedUpload):
        ingest.sniff(fake, "evil.jpg")
    png = tmp_path / "photo.txt"
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, "PNG")
    png.write_bytes(buf.getvalue())
    assert ingest.sniff(png, "photo.txt").kind == "photo"


def test_clustering_separates_people():
    rng = np.random.default_rng(0)
    a, b = rng.normal(size=512), rng.normal(size=512)
    embs = [x / np.linalg.norm(x) for x in [a + rng.normal(scale=0.3, size=512) for _ in range(4)] +
            [b + rng.normal(scale=0.3, size=512) for _ in range(3)]]
    labels = faces.cluster(np.stack(embs).astype(np.float32))
    assert len(set(labels[:4])) == 1 and len(set(labels[4:])) == 1 and labels[0] != labels[4]


def test_minor_rule():
    assert faces.is_minor([9, 11, 10])
    assert not faces.is_minor([34, 41, 38])
    assert not faces.is_minor([])


def test_watermark_detectable(tmp_path):
    from app.services.watermark import detect, has_label, mark_image
    p = tmp_path / "s.jpg"
    Image.fromarray((np.random.default_rng(1).random((80, 60, 3)) * 255).astype("uint8")).save(p)
    out = mark_image(p)
    assert detect(out) > 0.99 and has_label(out)
    assert detect(p) < 0.6


def test_llm_minor_signal():
    assert faces.llm_says_minor({"apparent_age": 8, "looks_under_18": True})
    assert faces.llm_says_minor({"apparent_age": 12})
    assert not faces.llm_says_minor({"apparent_age": 35, "looks_under_18": False})
    assert not faces.llm_says_minor({"unavailable": True})
