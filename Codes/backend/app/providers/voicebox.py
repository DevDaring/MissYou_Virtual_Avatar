"""Voicebox internal voice service (jamiepine/voicebox v0.6.0, MIT) — adapter.

Runs headless on CPU at 127.0.0.1:17493 (loopback only; never exposed).
Verified against the running service on 2026-10-15 (docs/PROVIDERS.md):

  POST /profiles                 {name, language, voice_type:"cloned", default_engine}
  POST /profiles/{id}/samples    multipart: file (2–30 s, RMS ≥ 0.01), reference_text (1–1000 chars)
  POST /generate                 {profile_id, text, language, engine} → {id, status}  (serial queue)
  GET  /history/{id}             status: loading_model | generating | completed | failed
  GET  /audio/{id}               WAV bytes
  DELETE /profiles/{id}
  POST /transcribe               multipart file → {text}

Engines (licences checked per model): luxtts (Apache-2.0, English, ~3 s per
sentence on this CPU) and chatterbox multilingual (MIT, en+hi, ~20–27 s per
sentence — too slow for live turns, fine for letters and previews). OmniVoice
(CC-BY-NC) and others are not used. Bengali is not supported by Voicebox.

We use the queued /generate endpoint (not /generate/stream) because the API
and worker processes both call Voicebox and its inference is single-threaded.
Our PostgreSQL is the source of truth; VoiceProfile.provider_voice_id holds the
Voicebox profile id and all access control is enforced on our side.
"""
from __future__ import annotations

import asyncio
import logging
import time

from ..config import settings
from .base import ProviderError, client, raise_for

log = logging.getLogger("missyou.voicebox")
_state = {"up": False, "checked": 0.0}
ENGINE_FOR = {"en": "luxtts", "hi": "chatterbox"}
LANGS = {"en", "hi"}


def is_up() -> bool:
    return settings.voicebox_enabled and bool(_state["up"])


def engine_for(language: str) -> str:
    return ENGINE_FOR.get(language[:2], "chatterbox")


async def health() -> bool:
    if not settings.voicebox_enabled:
        _state["up"] = False
        return False
    try:
        async with client(4) as c:
            r = await c.get(f"{settings.voicebox_url}/health")
        _state["up"] = r.status_code == 200 and r.json().get("status") == "healthy"
    except Exception:  # noqa: BLE001
        _state["up"] = False
    _state["checked"] = time.time()
    return bool(_state["up"])


async def create_profile(name: str, language: str, samples: list[tuple[bytes, str]]) -> str:
    lang = language[:2]
    if lang not in LANGS:
        raise ProviderError("voicebox", "unsupported", f"Voicebox does not support '{language}'")
    async with client(60) as c:
        r = await c.post(f"{settings.voicebox_url}/profiles", json={
            "name": name[:100], "language": lang, "voice_type": "cloned", "default_engine": engine_for(lang),
            "description": "Miss You cloned voice (access controlled by Miss You)"})
        raise_for("voicebox", r)
        pid = r.json()["id"]
        added = 0
        for audio, text in samples:
            r = await c.post(f"{settings.voicebox_url}/profiles/{pid}/samples",
                             files={"file": ("sample.wav", audio, "audio/wav")},
                             data={"reference_text": (text or "…").strip()[:1000] or "…"})
            if r.status_code < 300:
                added += 1
            else:
                log.info("voicebox rejected a sample: %s", r.text[:160])
        if not added:
            await c.delete(f"{settings.voicebox_url}/profiles/{pid}")
            raise ProviderError("voicebox", "no_samples", "no usable sample (need 2–30 s of clear speech)")
    return str(pid)


async def delete_profile(profile_id: str) -> bool:
    try:
        async with client(15) as c:
            r = await c.delete(f"{settings.voicebox_url}/profiles/{profile_id}")
        return r.status_code in (200, 204, 404)
    except Exception:  # noqa: BLE001
        return False


async def generate(profile_id: str, text: str, language: str, max_wait: float = 120.0) -> bytes:
    lang = language[:2]
    if lang not in LANGS:
        raise ProviderError("voicebox", "unsupported", f"Voicebox does not support '{language}'")
    async with client(30) as c:
        r = await c.post(f"{settings.voicebox_url}/generate", json={
            "profile_id": profile_id, "text": text[:2000], "language": lang, "engine": engine_for(lang)})
        raise_for("voicebox", r)
        gid = r.json()["id"]
        t0 = time.monotonic()
        while time.monotonic() - t0 < max_wait:
            await asyncio.sleep(0.35)
            h = await c.get(f"{settings.voicebox_url}/history/{gid}")
            if h.status_code != 200:
                continue
            st = h.json().get("status")
            if st == "completed":
                a = await c.get(f"{settings.voicebox_url}/audio/{gid}")
                raise_for("voicebox", a)
                return await _to_mp3(a.content)
            if st == "failed":
                raise ProviderError("voicebox", "failed", str(h.json().get("error"))[:200])
        await c.post(f"{settings.voicebox_url}/generate/{gid}/cancel")
    raise ProviderError("voicebox", "timeout", "generation took too long")


async def _to_mp3(wav: bytes) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", "24000", "-b:a", "96k", "-f", "mp3", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, _ = await proc.communicate(wav)
    return out if proc.returncode == 0 and out else wav


async def transcribe(wav_bytes: bytes) -> str:
    async with client(60) as c:
        r = await c.post(f"{settings.voicebox_url}/transcribe", files={"file": ("a.wav", wav_bytes, "audio/wav")})
    if r.status_code == 202:
        raise ProviderError("voicebox", "loading", "whisper model is loading")
    raise_for("voicebox", r)
    return str(r.json().get("text") or "").strip()
