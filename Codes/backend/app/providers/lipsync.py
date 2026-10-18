"""Lip-sync of reply audio onto a talking loop (brief 6.5 step 6, 9.1).

Provider: fal.ai queue API — the same request shape already working on this
machine in /home/Debz/Host/adotopia/backend/app/llm/lipsync.py (read Sept 2026):

  POST https://queue.fal.run/{model}   {video_url, audio_url, sync_mode:"silence"}
       → {request_id, status_url, response_url}
  GET  status_url  → 202 while IN_QUEUE / IN_PROGRESS, 200 with status COMPLETED
  GET  response_url → {video: {url}}
  Auth: "Authorization: Key <FAL_KEY>"
Models: fal-ai/sync-lipsync/v2 ($3.00/min), fal-ai/latentsync ($0.60/min).

Enabled only when FAL_KEY is set. fal fetches our inputs itself, so we pass
signed, expiring public media URLs. Without a key the client runs audio-first
with the generated talking loop (approximate lip movement) and says so.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from ..config import settings
from ..services.metering import metered
from .base import ProviderError, client

log = logging.getLogger("missyou.lipsync")
QUEUE = "https://queue.fal.run"
MODELS = {"sync-2": ("fal-ai/sync-lipsync/v2", 3.00), "latentsync": ("fal-ai/latentsync", 0.60)}
DEFAULT = settings.env.get("MISSYOU_LIPSYNC_MODEL", "sync-2")


def available() -> bool:
    return bool(settings.fal_key) and not settings.mock_providers


def _h() -> dict[str, str]:
    return {"Authorization": f"Key {settings.fal_key}", "Content-Type": "application/json"}


async def sync_urls(video_url: str, audio_url: str, seconds: float, *, user_id: uuid.UUID | None = None,
                    call_id: uuid.UUID | None = None, feature: str = "lipsync", max_wait: float = 600,
                    sync_mode: str = "silence") -> bytes:
    """Lip-sync `video_url` to `audio_url` (both publicly fetchable). Returns MP4 bytes."""
    if not available():
        raise ProviderError("fal", "not_configured", "FAL_KEY is not set")
    remote, per_min = MODELS.get(DEFAULT, MODELS["sync-2"])
    async with metered(provider="fal", capability="lipsync", model=remote, est_usd=per_min * seconds / 60,
                       user_id=user_id, call_id=call_id, feature=feature, unit_type="seconds", units=seconds) as m:
        m.cost_usd = 0.0  # only billed on success (set below)
        async with client(60) as c:
            r = await c.post(f"{QUEUE}/{remote}", headers=_h(),
                             json={"video_url": video_url, "audio_url": audio_url, "sync_mode": sync_mode})
            if r.status_code not in (200, 201, 202):
                raise ProviderError("fal", "submit", r.text[:200], r.status_code)
            job = r.json()
            waited = 0.0
            while waited < max_wait:
                s = await c.get(job["status_url"], headers=_h())
                if s.status_code not in (200, 202):
                    raise ProviderError("fal", "status", s.text[:200], s.status_code)
                state = (s.json() or {}).get("status", "")
                if state == "COMPLETED":
                    out = await c.get(job["response_url"], headers=_h())
                    body = out.json() or {}
                    url = (body.get("video") or {}).get("url")
                    if not url:
                        raise ProviderError("fal", "empty", f"no video returned: {str(body)[:160]}")
                    async with client(300) as d:
                        v = await d.get(url, follow_redirects=True)
                    v.raise_for_status()
                    m.cost_usd = per_min * seconds / 60
                    return v.content
                if state in ("FAILED", "ERROR", "CANCELLED"):
                    raise ProviderError("fal", state.lower(), "lip-sync job failed")
                await asyncio.sleep(2.5)
                waited += 2.5
    raise ProviderError("fal", "timeout", "lip-sync did not finish in time")


def public(signed_path: str | None) -> str:
    return f"{settings.public_url}{signed_path}" if signed_path else ""


async def render(call_id: uuid.UUID, turn_id: uuid.UUID, audio_ids: list[uuid.UUID]) -> str | None:
    """Lip-sync one reply (merged audio) onto the call's talking loop; returns a signed URL."""
    from ..db import SessionLocal
    from ..models import Call, CallTurn, MediaAsset, Scene
    from ..services.assets import save_asset, url
    async with SessionLocal() as db:
        call = await db.get(Call, call_id)
        scene = await db.get(Scene, call.scene_id) if call and call.scene_id else None
        turn = await db.get(CallTurn, turn_id)
        if not scene or not scene.talking_media_id or not turn:
            return None
        audio_id = turn.audio_media_id or audio_ids[0]
        audio = await db.get(MediaAsset, audio_id)
        secs = float(audio.duration_s or 6.0) if audio else 6.0
        video = await db.get(MediaAsset, scene.talking_media_id)
        mode = "cut_off" if secs <= float((video.duration_s if video else 8.0) or 8.0) else "loop"
        data = await sync_urls(public(url(scene.talking_media_id, 3600)), public(url(audio_id, 3600)), secs,
                               user_id=call.user_id, call_id=call_id, sync_mode=mode)
        v = await save_asset(db, owner_id=call.user_id, person_id=call.person_id, kind="lipsync", mime="video/mp4",
                             data=data, ai_generated=True, meta={"turn_id": str(turn_id)})
        turn.video_media_id = v.id
        await db.commit()
        return url(v.id, 3600)
