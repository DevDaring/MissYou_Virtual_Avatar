"""Face detection, embeddings, clustering, age / public-figure checks, anchors.

Local InsightFace (buffalo_l: SCRFD detector + ArcFace 512-d embeddings +
gender/age head) on CPU via onnxruntime. Embeddings are L2-normalised and
stored in pgvector.
"""
from __future__ import annotations

import base64
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from ..config import settings

log = logging.getLogger("missyou.faces")
_lock = threading.Lock()
_app: Any = None


def model() -> Any:
    global _app
    with _lock:
        if _app is None:
            from insightface.app import FaceAnalysis
            a = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"],
                             allowed_modules=["detection", "recognition", "genderage", "landmark_3d_68"])
            a.prepare(ctx_id=-1, det_size=(640, 640))
            _app = a
    return _app


@dataclass
class Face:
    bbox: list[float]
    det_score: float
    embedding: np.ndarray
    age: float | None
    gender: str
    quality: float
    thumb_jpeg: bytes
    crop_jpeg: bytes


def _sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _crop(img: np.ndarray, bbox: list[float], margin: float, size: int) -> bytes:
    h, w = img.shape[:2]
    x1, y1, x2, y2 = bbox
    bw, bh = x2 - x1, y2 - y1
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2 - bh * 0.05
    half = max(bw, bh) * (0.5 + margin)
    a, b = int(max(cx - half, 0)), int(max(cy - half, 0))
    c, d = int(min(cx + half, w)), int(min(cy + half, h))
    crop = img[b:d, a:c]
    if crop.size == 0:
        crop = img
    crop = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes() if ok else b""


def analyze_image(path: Path, max_side: int = 1600) -> list[Face]:
    img = cv2.imread(str(path))
    if img is None:
        return []
    h, w = img.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    faces = model().get(img)
    out: list[Face] = []
    for f in faces:
        x1, y1, x2, y2 = [float(v) for v in f.bbox]
        size = min(x2 - x1, y2 - y1)
        if f.det_score < 0.55 or size < 40:
            continue
        gray = cv2.cvtColor(img[max(int(y1), 0):int(y2), max(int(x1), 0):int(x2)], cv2.COLOR_BGR2GRAY)
        sharp = min(_sharpness(gray) / 300.0, 1.0) if gray.size else 0.0
        frontal = 1.0
        pose = getattr(f, "pose", None)
        if pose is not None:
            pitch, yaw, _roll = [float(v) for v in pose]
            frontal = max(0.0, 1.0 - (abs(yaw) / 60.0) - (abs(pitch) / 80.0))
        bright = float(np.mean(gray)) / 255.0 if gray.size else 0.5
        light = 1.0 - min(abs(bright - 0.5) * 1.6, 0.8)
        size_f = min(size / 220.0, 1.0)
        quality = float(f.det_score) * (0.35 + 0.65 * sharp) * (0.3 + 0.7 * frontal) * (0.4 + 0.6 * size_f) * light
        emb = np.asarray(f.normed_embedding, dtype=np.float32)
        gender = "m" if int(getattr(f, "gender", 1)) == 1 else "f"
        out.append(Face(bbox=[x1 / scale, y1 / scale, x2 / scale, y2 / scale], det_score=float(f.det_score),
                        embedding=emb, age=float(getattr(f, "age", 0) or 0) or None, gender=gender,
                        quality=round(quality, 4), thumb_jpeg=_crop(img, [x1, y1, x2, y2], 0.35, 256),
                        crop_jpeg=_crop(img, [x1, y1, x2, y2], 0.9, 512)))
    return out


def cluster(embeddings: np.ndarray, threshold: float = 0.6) -> np.ndarray:
    """Agglomerative clustering on cosine distance; returns labels."""
    n = len(embeddings)
    if n == 0:
        return np.array([], dtype=int)
    if n == 1:
        return np.array([0])
    from sklearn.cluster import AgglomerativeClustering
    ac = AgglomerativeClustering(n_clusters=None, metric="cosine", linkage="average", distance_threshold=threshold)
    return ac.fit_predict(embeddings)


def centroid(embs: list[np.ndarray]) -> np.ndarray:
    c = np.mean(np.stack(embs), axis=0)
    return (c / (np.linalg.norm(c) + 1e-9)).astype(np.float32)


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / ((np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9))


def identity_score(path: Path, ref: np.ndarray) -> float | None:
    faces = analyze_image(path)
    if not faces:
        return None
    best = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return similarity(best.embedding, ref)


def is_minor(ages: list[float]) -> bool:
    """'Clearly under 18': the median estimated age is below the threshold (default 16)."""
    vals = sorted(a for a in ages if a)
    if not vals:
        return False
    return float(np.median(vals)) < settings.minor_age_threshold


def reference_public_figures() -> list[tuple[str, np.ndarray]]:
    d = settings.config_dir / "public_figures"
    out: list[tuple[str, np.ndarray]] = []
    if d.is_dir():
        for p in d.glob("*.npy"):
            try:
                out.append((p.stem, np.load(p).astype(np.float32)))
            except Exception:  # noqa: BLE001
                continue
    return out


def matches_reference_figure(emb: np.ndarray, threshold: float = 0.5) -> str | None:
    for name, ref in reference_public_figures():
        if similarity(emb, ref) >= threshold:
            return name
    return None


async def llm_face_check(face_jpegs: list[bytes], user_id: Any = None) -> dict[str, Any]:
    """Vision-LLM safety check on the chosen person's best crops: is this a
    widely recognisable public figure, and what is their apparent age?
    A second, independent age signal — InsightFace's age head is unreliable on
    children (it estimated a 7-year-old at 26 in our tests)."""
    from ..providers import llm
    parts: list[dict[str, Any]] = [{"type": "text", "text": (
        "These photos show one person. Answer two safety questions for a grief app that must not recreate "
        "children or celebrities. 1) Is this a widely recognisable public figure (film/TV star, politician, "
        "famous athlete, historical figure, influencer)? If unsure, false. 2) Estimate their apparent age in "
        "years from the face and body. Return JSON {\"famous\": true|false, \"confidence\": 0-1, "
        "\"category\": \"...\", \"apparent_age\": number, \"looks_under_18\": true|false}. "
        "Never name private people.")}]
    for b in face_jpegs[:3]:
        parts.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b).decode()}})
    try:
        res = await llm.chat([{"role": "system", "content": "You are a careful safety reviewer. Answer only JSON."},
                              {"role": "user", "content": parts}],
                             capability="safety", max_tokens=120, temperature=0, json_mode=True, needs_vision=True,
                             user_id=user_id, feature="face_safety_check")
        return llm.parse_json(res.text)
    except Exception as e:  # noqa: BLE001
        log.warning("face safety check unavailable: %s", str(e)[:120])
        return {"famous": False, "confidence": 0, "unavailable": True}


async def llm_public_figure_only(face_jpegs: list[bytes], user_id: Any = None) -> dict[str, Any]:
    """Focused second opinion used when the combined check says "not famous"
    (the combined prompt was observed to miss a famous historical figure once)."""
    from ..providers import llm
    parts: list[dict[str, Any]] = [{"type": "text", "text": (
        "Is the person in this photo a widely recognisable public figure — a film or TV star, politician, "
        "famous athlete, historical figure or influencer? Return JSON {\"famous\": true|false, "
        "\"confidence\": 0-1, \"category\": \"...\"}.")}]
    parts += [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b).decode()}}
              for b in face_jpegs[:2]]
    try:
        res = await llm.chat([{"role": "user", "content": parts}], capability="safety", max_tokens=60,
                             temperature=0, json_mode=True, needs_vision=True, user_id=user_id,
                             feature="face_safety_check")
        return llm.parse_json(res.text)
    except Exception:  # noqa: BLE001
        return {"famous": False}


def llm_says_minor(check: dict[str, Any]) -> bool:
    try:
        age = float(check.get("apparent_age") or 99)
    except (TypeError, ValueError):
        age = 99.0
    return bool(check.get("looks_under_18")) and age < 18 or age < settings.minor_age_threshold


def restore_basic(src: Path, dest: Path) -> Path:
    """Gentle local restoration for old/blurry photos (no GPU needed):
    denoise → CLAHE on luminance → mild unsharp mask → 2x upscale if small."""
    img = cv2.imread(str(src))
    if img is None:
        raise ValueError("unreadable image")
    h, w = img.shape[:2]
    if max(h, w) < 900:
        img = cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    img = cv2.fastNlMeansDenoisingColored(img, None, 5, 5, 7, 21)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_, a, b = cv2.split(lab)
    l_ = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l_)
    img = cv2.cvtColor(cv2.merge((l_, a, b)), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(img, (0, 0), 1.2)
    img = cv2.addWeighted(img, 1.5, blur, -0.5, 0)
    cv2.imwrite(str(dest), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return dest
