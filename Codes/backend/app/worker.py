"""arq workers. Run one per queue:

    MISSYOU_QUEUE=cpu arq app.worker.WorkerSettings
    MISSYOU_QUEUE=gpu arq app.worker.WorkerSettings

A remote GPU worker runs the same command with MISSYOU_QUEUE=gpu and
MISSYOU_REDIS_URL pointing at this Redis over a TLS tunnel (docs/DEPLOY.md).
"""
from __future__ import annotations

import os
from typing import Any

from .main import setup_logging
from .services import jobs, pipeline

setup_logging()
QUEUE = os.environ.get("MISSYOU_QUEUE", "cpu")


async def process_person(ctx: dict[str, Any], job_id: str) -> None:
    await pipeline.process_person(job_id)


async def analyze_voices(ctx: dict[str, Any], job_id: str) -> None:
    await pipeline.analyze_voices(job_id)


async def build_voice(ctx: dict[str, Any], job_id: str) -> None:
    await pipeline.build_voice(job_id)


async def generate_scene(ctx: dict[str, Any], job_id: str) -> None:
    await pipeline.generate_scene(job_id)


async def write_letter(ctx: dict[str, Any], job_id: str) -> None:
    await pipeline.write_letter(job_id)


async def lipsync_memory(ctx: dict[str, Any], job_id: str) -> None:
    await pipeline.lipsync_memory(job_id)


async def startup(ctx: dict[str, Any]) -> None:
    from .providers import voice_engine
    await voice_engine.health()


class WorkerSettings:
    functions = [process_person, analyze_voices, build_voice, generate_scene, write_letter, lipsync_memory]
    queue_name = jobs.QUEUES[QUEUE]
    redis_settings = jobs.redis_settings()
    max_jobs = 2 if QUEUE == "cpu" else 4
    job_timeout = 1800
    max_tries = 1  # paid generations are never retried automatically (brief 4.4)
    on_startup = startup
    allow_abort_jobs = True
