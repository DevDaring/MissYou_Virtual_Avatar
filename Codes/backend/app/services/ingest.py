"""Upload ingest: type validation by magic bytes, EXIF/GPS stripping, HEIC
conversion, and a light speaker-feature extractor for grouping voice clips."""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import filetype
import numpy as np
from PIL import Image, ImageOps

from . import av

PHOTO = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"}
VIDEO = {"video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/3gpp"}
AUDIO = {"audio/mpeg", "audio/x-wav", "audio/wav", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/ogg",
         "audio/opus", "audio/aac", "audio/webm", "audio/x-flac"}


class RejectedUpload(ValueError):
    pass


@dataclass
class Sniffed:
    kind: str  # photo | video | audio
    mime: str


def sniff(path: Path, filename: str = "") -> Sniffed:
    with open(path, "rb") as f:
        head = f.read(8192)
    g = filetype.guess(head)
    mime = g.mime if g else ""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if mime in PHOTO:
        return Sniffed("photo", mime)
    if mime in AUDIO or (mime in ("video/mp4",) and ext in ("m4a", "aac")):
        return Sniffed("audio", "audio/mp4" if mime == "video/mp4" else mime)
    if mime in VIDEO:
        return Sniffed("video", mime)
    if not mime and head[:4] == b"OggS":
        return Sniffed("audio", "audio/ogg")
    if not mime and (head[:3] == b"ID3" or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
        return Sniffed("audio", "audio/mpeg")
    raise RejectedUpload(f"unsupported or unrecognised file type ({mime or 'unknown'})")


def normalise_photo(src: Path, dest: Path, max_side: int = 2560) -> tuple[int, int]:
    """Re-encode to JPEG: applies orientation, drops ALL metadata (incl. GPS)."""
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except Exception:  # noqa: BLE001
        pass
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side))
        clean = Image.new("RGB", im.size)
        clean.paste(im)
        clean.save(dest, "JPEG", quality=90, optimize=True)
        return clean.size


def image_size(data: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as im:
        return im.size


async def normalise_video(src: Path, dest: Path) -> Path:
    return await av.strip_video_metadata(src, dest)


async def normalise_audio(src: Path, dest: Path) -> Path:
    await av.run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-map_metadata", "-1", "-ac", "1",
                 "-ar", "44100", "-b:a", "128k", str(dest))
    return dest


# --- speaker features (approximate diarization without a GPU) -------------

def _mel_filterbank(sr: int, n_fft: int, n_mels: int = 40) -> np.ndarray:
    def hz2mel(h: np.ndarray | float) -> np.ndarray:
        return 2595 * np.log10(1 + np.asarray(h) / 700.0)

    def mel2hz(m: np.ndarray) -> np.ndarray:
        return 700 * (10 ** (m / 2595.0) - 1)
    mels = np.linspace(hz2mel(60), hz2mel(sr / 2 - 200), n_mels + 2)
    bins = np.floor((n_fft + 1) * mel2hz(mels) / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for i in range(1, n_mels + 1):
        a, b, c = bins[i - 1], bins[i], bins[i + 1]
        for k in range(a, b):
            fb[i - 1, k] = (k - a) / max(b - a, 1)
        for k in range(b, c):
            fb[i - 1, k] = (c - k) / max(c - b, 1)
    return fb


def speaker_vector(wav: Path) -> np.ndarray | None:
    """Mean+std of MFCCs plus a pitch proxy — enough to group clips by voice so
    the user can confirm them (we never auto-match voice to face)."""
    import soundfile as sf
    try:
        y, sr = sf.read(str(wav), dtype="float32")
    except Exception:  # noqa: BLE001
        return None
    if y.ndim > 1:
        y = y.mean(axis=1)
    if len(y) < sr * 0.8:
        return None
    n_fft, hop = 512, 160
    y = np.append(y[0], y[1:] - 0.97 * y[:-1])
    frames = np.lib.stride_tricks.sliding_window_view(y, n_fft)[::hop] * np.hamming(n_fft)
    power = np.abs(np.fft.rfft(frames, n_fft)) ** 2 / n_fft
    energy = power.sum(axis=1)
    voiced = energy > np.percentile(energy, 40)
    if voiced.sum() < 20:
        return None
    mel = np.log(power[voiced] @ _mel_filterbank(sr, n_fft).T + 1e-10)
    n = mel.shape[1]
    dct = np.cos(np.pi / n * (np.arange(n)[:, None] + 0.5) * np.arange(20)[None, :])
    mfcc = mel @ dct
    mfcc = mfcc[:, 1:]
    # Pitch proxy: dominant autocorrelation lag in 70–400 Hz on voiced frames.
    ac_f0 = []
    for fr in frames[voiced][:: max(1, voiced.sum() // 60)]:
        ac = np.correlate(fr, fr, mode="full")[n_fft - 1:]
        lo, hi = int(sr / 400), int(sr / 70)
        lag = lo + int(np.argmax(ac[lo:hi]))
        ac_f0.append(sr / lag)
    f0 = np.median(ac_f0) if ac_f0 else 150.0
    vec = np.concatenate([mfcc.mean(axis=0), mfcc.std(axis=0), [np.log(f0) * 8]])
    vec = (vec - vec.mean()) / (vec.std() + 1e-9)
    return vec.astype(np.float32)


def group_speakers(vectors: list[np.ndarray], threshold: float = 0.35) -> list[int]:
    if not vectors:
        return []
    if len(vectors) == 1:
        return [0]
    from sklearn.cluster import AgglomerativeClustering
    labels = AgglomerativeClustering(n_clusters=None, metric="cosine", linkage="average",
                                     distance_threshold=threshold).fit_predict(np.stack(vectors))
    return [int(x) for x in labels]
