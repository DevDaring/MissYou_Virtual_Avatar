"""A slow speech-to-text provider in a live call is raced by the next one instead of stalling the turn."""
import asyncio
import contextlib
import time
from types import SimpleNamespace
from pathlib import Path

import pytest

from app.providers import stt


@pytest.mark.asyncio(loop_scope="session")
async def test_slow_primary_is_hedged(monkeypatch, tmp_path: Path):
    async def slow(wav, language):
        await asyncio.sleep(5)
        return stt.SttResult("slow", "bn", "sarvam")

    async def fast(wav, language):
        await asyncio.sleep(0.05)
        return stt.SttResult("ফাস্ট", "bn", "openai")

    @contextlib.asynccontextmanager
    async def no_meter(**kw):
        yield SimpleNamespace(units=0)

    async def no_pin(capability):
        return None

    from app.services import flags
    monkeypatch.setattr(stt, "metered", no_meter)
    monkeypatch.setattr(flags, "provider_primary", no_pin)
    monkeypatch.setattr(stt.settings, "mock_providers", False)
    monkeypatch.setattr(stt.settings, "sarvam_keys", ["k"])
    monkeypatch.setattr(stt, "_sarvam", slow)
    monkeypatch.setattr(stt, "_openai", fast)
    monkeypatch.setattr(stt, "HEDGE_BASE_S", 0.2)
    monkeypatch.setattr(stt, "HEDGE_PER_AUDIO_S", 0.0)
    from app.providers import voice_engine
    monkeypatch.setattr(voice_engine, "is_up", lambda: False)
    wav = tmp_path / "a.wav"
    wav.write_bytes(b"RIFF0000")
    t0 = time.perf_counter()
    r = await stt.transcribe(wav, duration_s=2.0, language="bn", feature="call")
    assert r.provider == "openai" and r.text == "ফাস্ট"
    assert time.perf_counter() - t0 < 2
