"""Text-to-speech + voice cloning, routed per language (config/languages.yaml).

Engines (verified 2026-10-15, docs/PROVIDERS.md):
  voicebox       local Voicebox service (cloned profiles; internal-only port)
  sarvam_clone   Sarvam POST /voices/clone with our stored reference clip (≤15 s)
                 — the only verified cloning route for Bengali
  sarvam         Sarvam bulbul:v3 preset speakers (bn/hi/en-IN)
  openai         gpt-4o-mini-tts preset voices
  xai            xAI /v1/tts preset voices (bn, hi supported)

A VoiceProfile names its primary engine; on failure we fall back down the
language's chain, keeping the gender of the voice where we can.
"""
from __future__ import annotations

import base64
import itertools
import re
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from ..config import settings
from ..services.metering import BudgetExceeded, metered
from . import fish, voicebox
from .base import ProviderError, ProviderUnavailable, client, raise_for

log = logging.getLogger("missyou.tts")
_rr = itertools.count()
LANG = {"bn": "bn-IN", "hi": "hi-IN", "en": "en-IN"}


@dataclass
class Voice:
    """What the TTS layer needs to know about a voice."""
    engine: str
    voice_id: str = ""          # voicebox profile id / preset speaker name
    gender: str = "f"           # f | m
    ref_audio: Path | None = None  # local reference clip for cloning engines
    ref_text: str = ""
    pace: float = 0.95
    instructions: str = ""      # voice-design description (OpenAI gpt-4o-mini-tts)


@dataclass
class TtsResult:
    audio: bytes
    mime: str
    engine: str
    voice_id: str
    chars: int


BENGALI = re.compile(r"[\u0980-\u09FF]")
DEVANAGARI = re.compile(r"[\u0900-\u097F]")
# bulbul:v4-flash conversational Bengali voices (verified live 2026-10-18: Bengali-script text
# round-trips through Sarvam STT word-perfect; romanised Bengali read by an en-IN voice does not).
BN_V4 = {"f": "roopa_bn_conversational", "m": "arnab_bn_conversation"}


def script_language(text: str, default: str) -> str:
    """The language a reply must be voiced in, from its script."""
    if BENGALI.search(text):
        return "bn"
    if DEVANAGARI.search(text):
        return "hi"
    return default


def routing() -> dict[str, Any]:
    p = settings.config_dir / "languages.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}


def preset_for(engine: str, gender: str, language: str) -> str:
    presets = routing().get("default_presets", {})
    return str(presets.get(engine, {}).get(language, {}).get(gender)
               or presets.get(engine, {}).get("any", {}).get(gender) or "")


def _sarvam_keys() -> list[str]:
    keys = list(settings.sarvam_keys)
    s = next(_rr) % max(len(keys), 1)
    return keys[s:] + keys[:s]


async def _sarvam_post(path: str, **kw: Any) -> dict[str, Any]:
    last: Exception | None = None
    for key in _sarvam_keys():
        async with client(60) as c:
            r = await c.post(f"{settings.sarvam_base}{path}", headers={"api-subscription-key": key}, **kw)
        if r.status_code in (401, 403, 429) or r.status_code >= 500:
            last = ProviderError("sarvam", "key_failed", f"HTTP {r.status_code}", r.status_code)
            continue
        raise_for("sarvam", r)
        return r.json()
    raise last or ProviderError("sarvam", "not_configured", "no Sarvam key")


async def _sarvam_preset(text: str, lang: str, speaker: str, pace: float, gender: str = "f") -> bytes:
    body = {"text": text[:2500], "language_code": LANG.get(lang, "en-IN"), "model": settings.sarvam_tts_model,
            "speaker": speaker, "pace": pace, "speech_sample_rate": 24000, "output_audio_codec": "mp3"}
    if lang == "bn":
        try:  # natural conversational Bengali voice first, v3 Bengali speaker as fallback
            j = await _sarvam_post("/text-to-speech", json={**body, "model": "bulbul:v4-flash",
                                                            "speaker": BN_V4.get(gender, BN_V4["f"])})
            if j.get("audios"):
                return base64.b64decode(j["audios"][0])
        except ProviderError as e:
            log.info("bulbul v4-flash Bengali failed, using v3: %s", str(e)[:120])
        body["speaker"] = preset_for("sarvam", gender, "bn") or speaker
    j = await _sarvam_post("/text-to-speech", json=body)
    audios = j.get("audios") or []
    if not audios:
        raise ProviderError("sarvam", "empty", "no audio returned")
    return base64.b64decode(audios[0])


async def _sarvam_clone(text: str, lang: str, ref: Path, ref_text: str, pace: float) -> bytes:
    data = {"text": text[:1000], "language_code": LANG.get(lang, "en-IN"), "output_audio_codec": "mp3",
            "pace": str(pace)}
    if ref_text:
        data["ref_text"] = ref_text[:500]
    with open(ref, "rb") as f:
        j = await _sarvam_post("/voices/clone", files={"ref_audio": ("ref.wav", f.read(), "audio/wav")}, data=data)
    b64 = j.get("audio_b64") or j.get("audio")
    if not b64:
        raise ProviderError("sarvam", "empty", "no cloned audio returned")
    return base64.b64decode(b64)


async def _openai(text: str, lang: str, voice: str, design: str = "") -> bytes:
    ep = settings.openai
    instructions = (design + " ") if design else ""
    instructions += {"bn": "Speak natural, warm Bengali.", "hi": "Speak natural, warm Hindi.",
                    "en": "Speak warmly with a gentle Indian English accent."}.get(lang, "")
    async with client(60) as c:
        r = await c.post(f"{ep.base_url}/audio/speech", headers={"Authorization": f"Bearer {ep.key}"},
                         json={"model": "gpt-4o-mini-tts", "voice": voice or "coral", "input": text[:3000],
                               "instructions": instructions + " Calm, unhurried, affectionate.",
                               "response_format": "mp3"})
    raise_for("openai", r)
    return r.content


async def _xai(text: str, lang: str, voice: str) -> bytes:
    ep = settings.xai
    async with client(60) as c:
        r = await c.post(f"{ep.base_url}/tts", headers={"Authorization": f"Bearer {ep.key}"},
                         json={"text": text[:5000], "voice_id": voice or "eve", "language": lang or "auto",
                               "speed": 0.95})
    raise_for("xai", r)
    return r.content


def engine_available(engine: str) -> bool:
    if engine == "voicebox":
        return voicebox.is_up()
    if engine == "fish":
        return fish.available()
    if engine in ("sarvam", "sarvam_clone"):
        return bool(settings.sarvam_keys)
    if engine == "openai":
        return settings.openai.available
    if engine == "xai":
        return settings.xai.available
    return False


def engine_supports(engine: str, lang: str) -> bool:
    langs = routing().get("engines", {}).get(engine, {}).get("languages")
    return lang in langs if langs else True


async def _one(engine: str, text: str, lang: str, v: Voice) -> tuple[bytes, str]:
    if engine == "voicebox":
        return await voicebox.generate(v.voice_id, text, lang), v.voice_id
    if engine == "fish":
        if not v.voice_id or v.engine != "fish":
            raise ProviderError("fish", "no_voice", "no Fish voice for this profile")
        return await fish.tts(text, v.voice_id), v.voice_id
    if engine == "sarvam_clone":
        if not v.ref_audio:
            raise ProviderError("sarvam", "no_ref", "no reference clip for cloning")
        return await _sarvam_clone(text, lang, v.ref_audio, v.ref_text, v.pace), "clone"
    if engine == "sarvam":
        spk = v.voice_id if v.engine == "sarvam" and v.voice_id else preset_for("sarvam", v.gender, lang)
        return await _sarvam_preset(text, lang, spk or "roopa", v.pace, v.gender), spk
    if engine == "openai":
        vid = v.voice_id if v.engine == "openai" and v.voice_id else preset_for("openai", v.gender, lang)
        return await _openai(text, lang, vid, v.instructions if v.engine == "openai" else ""), vid
    if engine == "xai":
        vid = v.voice_id if v.engine == "xai" and v.voice_id else preset_for("xai", v.gender, lang)
        return await _xai(text, lang, vid), vid
    raise ProviderError(engine, "unknown", "unknown engine")


def _est(engine: str, chars: int) -> float:
    return {"voicebox": 0.0, "fish": 0.00005, "sarvam": 0.0004, "sarvam_clone": 0.0004, "openai": 0.0002, "xai": 0.000015}.get(
        engine, 0.001) * max(chars, 1) / 10


async def synthesize(text: str, language: str, voice: Voice, *, user_id: uuid.UUID | None = None,
                     call_id: uuid.UUID | None = None, feature: str = "call",
                     only_engine: str | None = None, force_language: bool = False) -> TtsResult:
    lang = (language or "en")[:2] if force_language else script_language(text, (language or "en")[:2])
    if settings.mock_providers:
        from ..services.av import tone_wav
        return TtsResult(tone_wav(0.8), "audio/wav", "mock", "mock", len(text))
    chain_cfg = routing().get("tts_chain", {}).get(lang) or ["sarvam", "openai", "xai"]
    if only_engine:
        chain = [only_engine]
    else:
        chain = [voice.engine] + [e for e in chain_cfg if e != voice.engine]
        for own in ("voicebox", "fish"):  # these profiles only exist for voices cloned there
            if voice.engine != own and own in chain:
                chain.remove(own)
    errors: list[str] = []
    for engine in chain:
        if not engine_available(engine) or not engine_supports(engine, lang):
            continue
        if engine == "sarvam_clone" and not voice.ref_audio:
            continue
        provider = "sarvam" if engine.startswith("sarvam") else engine
        try:
            async with metered(provider=provider, capability="tts", model=engine, est_usd=_est(engine, len(text)),
                               user_id=user_id, call_id=call_id, feature=feature, unit_type="chars",
                               units=len(text)):
                audio, vid = await _one(engine, text, lang, voice)
            if len(audio) < 400:
                raise ProviderError(engine, "empty", "audio too short")
            mime = "audio/wav" if audio[:4] == b"RIFF" else "audio/mpeg"
            return TtsResult(audio, mime, engine, vid, len(text))
        except BudgetExceeded:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("TTS %s failed: %s", engine, str(e)[:160])
            errors.append(f"{engine}: {str(e)[:80]}")
    raise ProviderUnavailable("tts", "all_failed", "; ".join(errors) or "no engine for this language")
