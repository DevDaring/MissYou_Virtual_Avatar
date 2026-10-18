"""Background jobs on arq (Redis). Two queues:

  missyou:cpu  ingest, face analysis, voice analysis (CPU worker on the VPS)
  missyou:gpu  scene generation, restoration, letters (can be served by a
               remote GPU worker pulling the same Redis over a secured link)

Progress is mirrored into the `jobs` table and published on Redis channel
`missyou:events:<user_id>` for the WebSocket.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from ..config import settings
from ..db import SessionLocal
from ..models import Job, utcnow
from ..redis_client import redis

log = logging.getLogger("missyou.jobs")
QUEUES = {"cpu": "missyou:cpu", "gpu": "missyou:gpu"}
_pool: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings())
    return _pool


async def publish(user_id: uuid.UUID | str | None, event: dict[str, Any]) -> None:
    if not user_id:
        return
    try:
        await redis().publish(f"missyou:events:{user_id}", json.dumps(event, default=str))
    except Exception:  # noqa: BLE001
        log.debug("publish failed", exc_info=True)


async def enqueue(kind: str, *, queue: str = "cpu", user_id: uuid.UUID | None = None,
                  person_id: uuid.UUID | None = None, **args: Any) -> Job:
    if person_id:
        args.setdefault("person_id", str(person_id))
    async with SessionLocal() as db:
        job = Job(kind=kind, queue=queue, user_id=user_id, person_id=person_id,
                  args={k: str(v) if isinstance(v, uuid.UUID) else v for k, v in args.items()})
        db.add(job)
        await db.commit()
        await db.refresh(job)
    p = await pool()
    await p.enqueue_job(kind, str(job.id), _queue_name=QUEUES[queue], _job_id=str(job.id))
    await publish(user_id, {"type": "job", "id": str(job.id), "kind": kind, "status": "queued", "progress": 0})
    return job


async def update(job_id: uuid.UUID | str, *, status: str | None = None, progress: int | None = None,
                 message: str | None = None, result: dict[str, Any] | None = None,
                 error: str | None = None) -> Job | None:
    async with SessionLocal() as db:
        job = await db.get(Job, uuid.UUID(str(job_id)))
        if not job:
            return None
        if status:
            job.status = status
        if progress is not None:
            job.progress = max(0, min(100, progress))
        if message is not None:
            job.message = message[:300]
        if result is not None:
            job.result = result
        if error is not None:
            job.error = error[:2000]
        job.updated_at = utcnow()
        await db.commit()
        await publish(job.user_id, {"type": "job", "id": str(job.id), "kind": job.kind, "status": job.status,
                                    "progress": job.progress, "message": job.message,
                                    "person_id": str(job.person_id) if job.person_id else None})
        return job
