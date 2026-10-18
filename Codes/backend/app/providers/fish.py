"""Fish Audio — voice cloning for English and Hindi (Bengali stays on Sarvam by owner's choice).

Verified live 2026-10-18 (docs.fish.audio, api.fish.audio/openapi.json):
  POST /model   multipart: type=tts, title, train_mode=fast, visibility=private, voices=<file>…, texts=…
                → 201 {_id, state:"trained"}            (~3 s)
  POST /v1/tts  JSON {text, reference_id, format:"mp3"}, header `model: s2.1-pro` → audio/mpeg (~0.3–0.8 s)
  DELETE /model/{id} → 204
Auth: Authorization: Bearer <key>. Price $15 per 1M UTF-8 bytes (s2.1-pro).
"""
from __future__ import annotations

import logging

from ..config import settings
from .base import ProviderError, client, raise_for

log = logging.getLogger("missyou.fish")
BASE = "https://api.fish.audio"
MODEL = "s2.1-pro"


def available() -> bool:
    return bool(settings.fish_key) and not settings.mock_providers


def _h() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.fish_key}"}


async def create_voice(title: str, samples: list[tuple[bytes, str]]) -> str:
    files = [("voices", (f"s{i}.wav", audio, "audio/wav")) for i, (audio, _) in enumerate(samples[:8])]
    texts = [t for _, t in samples[:8] if t]
    data: dict[str, str | list[str]] = {"type": "tts", "title": title[:80], "train_mode": "fast",
                                        "visibility": "private", "enhance_audio_quality": "true"}
    if len(texts) == len(files):
        data["texts"] = texts
    async with client(120) as c:
        r = await c.post(f"{BASE}/model", headers=_h(), files=files, data=data)
    raise_for("fish", r)
    vid = (r.json() or {}).get("_id")
    if not vid:
        raise ProviderError("fish", "no_id", "no model id returned")
    return str(vid)


async def tts(text: str, voice_id: str) -> bytes:
    async with client(60) as c:
        r = await c.post(f"{BASE}/v1/tts", headers={**_h(), "model": MODEL},
                         json={"text": text[:3000], "reference_id": voice_id, "format": "mp3", "latency": "balanced"})
    raise_for("fish", r)
    if len(r.content) < 400:
        raise ProviderError("fish", "empty", "audio too short")
    return r.content


async def delete_voice(voice_id: str) -> bool:
    try:
        async with client(20) as c:
            r = await c.delete(f"{BASE}/model/{voice_id}", headers=_h())
        return r.status_code in (200, 204, 404)
    except Exception:  # noqa: BLE001
        return False
