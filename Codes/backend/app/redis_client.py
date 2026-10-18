from __future__ import annotations

from redis.asyncio import Redis

from .config import settings

_r: Redis | None = None


def redis() -> Redis:
    global _r
    if _r is None:
        _r = Redis.from_url(settings.redis_url, decode_responses=True)
    return _r
