"""Provider registry and selection report (brief 4.3).

At startup (and on demand from the admin panel) we: read which keys exist
(never their values), run a cheap health check per provider (model lists,
local health endpoints — never a paid generation), build the active chain
per capability and write docs/PROVIDER_REPORT.md plus an admin view.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import Endpoint, settings
from ..redis_client import redis
from . import voicebox
from .base import client

log = logging.getLogger("missyou.registry")

CAPABILITIES: dict[str, list[str]] = {
    "conversation": ["linkapi", "openai", "openai-4.1", "anthropic", "openrouter", "deepseek", "linkapi-gemini", "gemini"],
    "safety": ["keywords(local)", "openai-moderation", "linkapi", "openai", "anthropic", "openrouter", "gemini"],
    "stt": ["sarvam", "openai", "voicebox-whisper", "deepgram"],
    "tts_clone": ["fish", "voicebox", "sarvam_clone", "elevenlabs"],
    "tts_preset": ["sarvam", "openai", "xai"],
    "scene_image": ["xai", "fal"],
    "idle_video": ["xai", "fal", "local(animated-still)"],
    "lipsync": ["fal", "gpu-worker(musetalk)", "client(approximate)"],  # fal = sync-lipsync v2 via queue API
    "talking_video": ["fal", "higgsfield", "local(animated-still+voice)"],
    "faces": ["insightface(local)"],
    "restoration": ["gpu-worker(gfpgan)", "fal", "local(basic-opencv)"],
    "vocal_isolation": ["gpu-worker(demucs+pyannote)", "local(ffmpeg-filters+mfcc-grouping)"],
    "payments": ["razorpay"],
    "email": ["resend", "outbox(admin-visible)"],
}
LOCAL_ALWAYS = {"keywords(local)", "local(animated-still)", "client(approximate)", "local(animated-still+voice)",
                "local(basic-opencv)", "local(ffmpeg-filters+mfcc-grouping)", "outbox(admin-visible)"}


def _endpoint(name: str) -> Endpoint | None:
    for e in settings.llm_chain + [settings.xai]:
        if e.name == name:
            return e
    return None


def configured(name: str) -> bool:
    if name in LOCAL_ALWAYS:
        return True
    ep = _endpoint(name)
    if ep:
        return ep.available
    return {
        "openai-moderation": settings.openai.available,
        "sarvam": bool(settings.sarvam_keys), "sarvam_clone": bool(settings.sarvam_keys),
        "voicebox": settings.voicebox_enabled, "voicebox-whisper": settings.voicebox_enabled,
        "fish": bool(settings.fish_key), "fal": bool(settings.fal_key), "elevenlabs": bool(settings.elevenlabs_key),
        "deepgram": bool(settings.deepgram_key), "higgsfield": bool(settings.higgsfield_key), "razorpay": bool(settings.razorpay_key_id),
        "resend": bool(settings.resend_key), "insightface(local)": True,
        "gpu-worker(musetalk)": bool(settings.gpu_worker_shared_secret),
        "gpu-worker(gfpgan)": bool(settings.gpu_worker_shared_secret),
        "gpu-worker(demucs+pyannote)": bool(settings.gpu_worker_shared_secret),
    }.get(name, False)


async def _probe(name: str) -> tuple[str, str]:
    """Returns (status, detail) where status ∈ ok | down | configured | missing."""
    if not configured(name):
        return "missing", "no key / not configured"
    if name in LOCAL_ALWAYS:
        return "ok", "built in"
    try:
        if name in ("voicebox", "voicebox-whisper"):
            up = await voicebox.health()
            return ("ok", "internal service healthy") if up else ("down", "not reachable on 127.0.0.1")
        if name == "insightface(local)":
            p = Path.home() / ".insightface" / "models" / "buffalo_l"
            return ("ok", "buffalo_l present") if p.exists() else ("configured", "model downloads on first use")
        if name in ("sarvam", "sarvam_clone"):
            return "configured", f"{len(settings.sarvam_keys)} key(s); no free health endpoint (verified live 2026-10-15)"
        if name == "openai-moderation":
            name = "openai"
        ep = _endpoint(name)
        if ep:
            headers = {"x-api-key": ep.key, "anthropic-version": "2023-06-01"} if ep.kind == "anthropic" else \
                {"Authorization": f"Bearer {ep.key}"}
            async with client(8) as c:
                r = await c.get(f"{ep.base_url.rstrip('/')}/models", headers=headers)
            if r.status_code == 200:
                return "ok", f"models listed; using {ep.model}"
            return "down", f"HTTP {r.status_code}"
        return "configured", "key present; not probed"
    except Exception as e:  # noqa: BLE001
        return "down", type(e).__name__


async def health_map() -> dict[str, dict[str, str]]:
    raw = await redis().get("missyou:provider_health")
    return json.loads(raw) if raw else {}


async def is_healthy(name: str) -> bool:
    h = (await health_map()).get(name)
    return not h or h.get("status") != "down"


async def refresh(write_report: bool = True) -> dict[str, Any]:
    names = sorted({n for chain in CAPABILITIES.values() for n in chain})
    results = await asyncio.gather(*[_probe(n) for n in names])
    health = {n: {"status": s, "detail": d} for n, (s, d) in zip(names, results)}
    await redis().set("missyou:provider_health", json.dumps(health), ex=3600)
    from ..services.flags import provider_primary
    report: dict[str, Any] = {"generated_at": datetime.now(timezone.utc).isoformat(), "capabilities": {}}
    for cap, chain in CAPABILITIES.items():
        active = [n for n in chain if health[n]["status"] in ("ok", "configured")]
        pinned = await provider_primary(cap)
        if pinned in active:
            active = [pinned] + [n for n in active if n != pinned]
        report["capabilities"][cap] = {
            "primary": active[0] if active else None, "fallbacks": active[1:],
            "missing": [n for n in chain if health[n]["status"] == "missing"],
            "down": [n for n in chain if health[n]["status"] == "down"], "pinned": pinned}
    report["providers"] = health
    banned = [k for k in settings.env if k.upper().startswith(("AWS_", "GOOGLE_CLOUD_", "GCP_", "GCLOUD_",
                                                                "GOOGLE_APPLICATION_CREDENTIALS"))]
    report["ignored_banned_env"] = len(banned)
    await redis().set("missyou:provider_report", json.dumps(report))
    if write_report:
        try:
            _write_md(report)
        except OSError:
            log.warning("could not write PROVIDER_REPORT.md")
    return report


def _write_md(report: dict[str, Any]) -> None:
    lines = ["# Provider report", "", f"_Generated {report['generated_at']} at startup by "
             "`app/providers/registry.py`. Key values are never read into this file._", "",
             f"Ignored AWS/GCP environment variables (policy ban): **{report['ignored_banned_env']}**", "",
             "| Capability | Primary | Fallbacks | Down | Missing |", "|---|---|---|---|---|"]
    for cap, r in report["capabilities"].items():
        lines.append(f"| {cap} | {r['primary'] or '— (degraded)'} | {', '.join(r['fallbacks']) or '—'} | "
                     f"{', '.join(r['down']) or '—'} | {', '.join(r['missing']) or '—'} |")
    lines += ["", "## Provider health", "", "| Provider | Status | Detail |", "|---|---|---|"]
    for n, h in sorted(report["providers"].items()):
        lines.append(f"| {n} | {h['status']} | {h['detail']} |")
    (settings.docs_dir / "PROVIDER_REPORT.md").write_text("\n".join(lines) + "\n")


async def report() -> dict[str, Any]:
    raw = await redis().get("missyou:provider_report")
    if raw:
        return json.loads(raw)
    return await refresh(write_report=False)


async def periodic(interval: float = 600) -> None:
    while True:
        try:
            await refresh(write_report=False)
        except Exception:  # noqa: BLE001
            log.warning("provider refresh failed", exc_info=True)
        await asyncio.sleep(interval)



