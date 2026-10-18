"""xAI Grok Imagine — scene stills (identity-preserving edit) and idle loops.

Verified 2026-10-15 (docs.x.ai, see docs/PROVIDERS.md):
  POST /v1/images/edits        JSON; `images: [{url, type:"image_url"}]` (≤5, data URIs ok)
                               or `image: {...}`; response_format b64_json; usage.cost_in_usd_ticks
  POST /v1/images/generations  same fields without input images
  POST /v1/videos/generations  {model, prompt, duration 1–15, resolution, image:{url}} → request_id
  GET  /v1/videos/{request_id} poll until status == "done" → video.url
1 USD = 1e10 ticks. Video audio is disabled (`generate_audio: false`): the
model cannot speak in our cloned voice, so clips are silent and our own TTS
is laid over them.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from pathlib import Path

from ..config import settings
from ..services.metering import metered
from .base import ProviderError, ProviderUnavailable, client, raise_for

log = logging.getLogger("missyou.xai")
TICKS = 10_000_000_000
VIDEO_USD_PER_S = {"grok-imagine-video-1.5-lite": 0.02, "grok-imagine-video": 0.05, "grok-imagine-video-1.5": 0.08}


def available() -> bool:
    return settings.xai.available and not settings.mock_providers


def _h() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.xai.key}"}


def data_uri(path: Path, mime: str = "") -> str:
    mime = mime or ("image/png" if path.read_bytes()[:4] == b"\x89PNG" else "image/jpeg")
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


async def image(prompt: str, refs: list[Path], *, aspect_ratio: str = "9:16", user_id: uuid.UUID | None = None,
                idempotency_key: str | None = None, feature: str = "scene") -> bytes:
    """One still. With refs: identity-preserving multi-image edit."""
    if not available():
        raise ProviderUnavailable("xai", "not_configured", "xAI key not configured")
    model = settings.xai_image_model
    body: dict = {"model": model, "prompt": prompt[:3900], "n": 1, "response_format": "b64_json",
                  "aspect_ratio": aspect_ratio, "resolution": "1k", "quality": "medium"}
    path = "/images/generations"
    if refs:
        path = "/images/edits"
        body["images"] = [{"url": data_uri(p), "type": "image_url"} for p in refs[:4]]
    async with metered(provider="xai", capability="scene_image", model=model, est_usd=0.08, user_id=user_id,
                       feature=feature, unit_type="images", units=1, idempotency_key=idempotency_key) as m:
        async with client(120) as c:
            r = await c.post(f"{settings.xai.base_url}{path}", headers=_h(), json=body)
            if r.status_code == 400 and "quality" in r.text:
                body.pop("quality", None)
                r = await c.post(f"{settings.xai.base_url}{path}", headers=_h(), json=body)
        raise_for("xai", r)
        j = r.json()
        ticks = (j.get("usage") or {}).get("cost_in_usd_ticks")
        if ticks:
            m.cost_usd = float(ticks) / TICKS
        item = (j.get("data") or [{}])[0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        if item.get("url"):
            async with client(60) as c:
                rr = await c.get(item["url"])
            raise_for("xai", rr)
            return rr.content
    raise ProviderError("xai", "empty", "no image returned (possibly moderated)")


async def video(prompt: str, first_frame: Path, *, seconds: int = 8, user_id: uuid.UUID | None = None,
                idempotency_key: str | None = None, feature: str = "scene",
                max_wait: float = 600.0, with_audio: bool = False) -> bytes:
    """Image-to-video clip pinned to `first_frame`. Returns MP4 bytes."""
    if not available():
        raise ProviderUnavailable("xai", "not_configured", "xAI key not configured")
    model = settings.xai_video_model
    seconds = max(1, min(15, seconds))
    est = VIDEO_USD_PER_S.get(model, 0.08) * seconds
    body = {"model": model, "prompt": prompt[:3900], "duration": seconds, "resolution": "720p",
            "image": {"url": data_uri(first_frame)}, "generate_audio": with_audio}
    async with metered(provider="xai", capability="idle_video", model=model, est_usd=est, user_id=user_id,
                       feature=feature, unit_type="seconds", units=seconds, idempotency_key=idempotency_key) as m:
        async with client(120) as c:
            r = await c.post(f"{settings.xai.base_url}/videos/generations", headers=_h(), json=body)
            if r.status_code == 400 and "generate_audio" in r.text:
                body.pop("generate_audio")
                r = await c.post(f"{settings.xai.base_url}/videos/generations", headers=_h(), json=body)
        raise_for("xai", r)
        rid = r.json().get("request_id")
        if not rid:
            raise ProviderError("xai", "no_id", "no request id")
        waited = 0.0
        while waited < max_wait:
            await asyncio.sleep(5)
            waited += 5
            async with client(60) as c:
                p = await c.get(f"{settings.xai.base_url}/videos/{rid}", headers=_h())
            if p.status_code != 200:
                continue
            j = p.json()
            st = str(j.get("status") or "").lower()
            if st == "done":
                url = (j.get("video") or {}).get("url")
                ticks = (j.get("usage") or {}).get("cost_in_usd_ticks")
                if ticks:
                    m.cost_usd = float(ticks) / TICKS
                if not url:
                    raise ProviderError("xai", "moderated", "video refused or empty")
                async with client(180) as c:
                    v = await c.get(url)
                raise_for("xai", v)
                return v.content
            if st in ("failed", "expired", "cancelled"):
                raise ProviderError("xai", st, str((j.get("error") or {}).get("message") or st)[:200])
        raise ProviderError("xai", "timeout", "video did not finish in time")
