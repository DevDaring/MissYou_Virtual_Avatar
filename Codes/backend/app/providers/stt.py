"""Speech-to-text chain: Sarvam saaras:v4 (Indic; sync endpoint ≤ 30 s,
~1.4 s) → OpenAI gpt-4o-mini-transcribe → local Whisper (CPU, slower)."""
from __future__ import annotations

import itertools
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..config import settings
from ..services.metering import BudgetExceeded, metered
from .base import ProviderError, ProviderUnavailable, client, raise_for

log = logging.getLogger("missyou.stt")
_rr = itertools.count()
SARVAM_MAX_S = 29.5


@dataclass
class SttResult:
    text: str
    language: str
    provider: str
    confidence: float | None = None


async def _sarvam(wav: Path, language: str | None) -> SttResult:
    keys = settings.sarvam_keys
    start = next(_rr)
    last: Exception | None = None
    for i in range(len(keys)):
        key = keys[(start + i) % len(keys)]
        async with client(40) as c:
            with open(wav, "rb") as f:
                r = await c.post(f"{settings.sarvam_base}/speech-to-text",
                                 headers={"api-subscription-key": key},
                                 files={"file": ("audio.wav", f, "audio/wav")},
                                 data={"model": settings.sarvam_stt_model, "mode": "transcribe",
                                       "language_code": {"bn": "bn-IN", "hi": "hi-IN", "en": "en-IN"}.get(
                                           (language or "")[:2], "unknown")})
        if r.status_code in (401, 403, 429) or r.status_code >= 500:
            last = ProviderError("sarvam", "key_failed", f"HTTP {r.status_code}", r.status_code)
            continue
        raise_for("sarvam", r)
        j = r.json()
        return SttResult(j.get("transcript", "").strip(), (j.get("language_code") or language or "en")[:2],
                         "sarvam", j.get("language_probability"))
    raise last or ProviderError("sarvam", "none", "no key")


async def _openai(wav: Path, language: str | None) -> SttResult:
    ep = settings.openai
    async with client(40) as c:
        with open(wav, "rb") as f:
            data = {"model": "gpt-4o-mini-transcribe"}
            if language and language[:2] in ("bn", "hi", "en"):
                data["language"] = language[:2]
            r = await c.post(f"{ep.base_url}/audio/transcriptions", headers={"Authorization": f"Bearer {ep.key}"},
                             files={"file": ("audio.wav", f, "audio/wav")}, data=data)
    raise_for("openai", r)
    return SttResult((r.json().get("text") or "").strip(), (language or "en")[:2], "openai")


async def transcribe(wav: Path, *, duration_s: float, language: str | None = None,
                     user_id: uuid.UUID | None = None, call_id: uuid.UUID | None = None,
                     feature: str = "call") -> SttResult:
    """`wav` must be 16 kHz mono PCM. Code-mixed speech is tolerated (auto-detect)."""
    if settings.mock_providers:
        return SttResult("(mock) hello, I missed you", language or "en", "mock")
    chain: list[tuple[str, str]] = []
    if settings.sarvam_keys and duration_s <= SARVAM_MAX_S:
        chain.append(("sarvam", settings.sarvam_stt_model))
    if settings.openai.available:
        chain.append(("openai", "gpt-4o-mini-transcribe"))
    from . import voice_engine
    if voice_engine.is_up():
        chain.append(("voice_engine", "whisper-small"))
    from ..services.flags import provider_primary
    pinned = await provider_primary("stt")
    if pinned:
        chain.sort(key=lambda p: 0 if p[0] == pinned else 1)
    if not chain:
        raise ProviderUnavailable("stt", "none", "no STT provider configured")
    errors = []
    for name, model in chain:
        try:
            async with metered(provider=name, capability="stt", model=model, est_usd=0.001, user_id=user_id,
                               call_id=call_id, feature=feature, unit_type="minutes",
                               units=duration_s / 60) as m:
                if name == "voice_engine":
                    res = SttResult(await voice_engine.transcribe(wav.read_bytes()), (language or "en")[:2], "voice_engine")
                else:
                    res = await (_sarvam(wav, language) if name == "sarvam" else _openai(wav, language))
                m.units = duration_s / 60
            return res
        except BudgetExceeded:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("STT %s failed: %s", name, str(e)[:160])
            errors.append(f"{name}: {str(e)[:80]}")
    raise ProviderUnavailable("stt", "all_failed", "; ".join(errors))
