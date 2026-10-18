"""Feature flags (brief 11) and admin provider overrides, cached for 20 s."""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select

from ..db import SessionLocal
from ..models import AdminSetting, FeatureFlag

DEFAULT_FLAGS: dict[str, tuple[bool, str]] = {
    "voice_letters": (True, "Voice messages ('letters') answered with an async talking message"),
    "special_days": (True, "Save birthdays, anniversaries and festivals; gentle opt-in reminder"),
    "family_sharing": (True, "Invite family members to the same loved one"),
    "memory_interview": (True, "Guided interview that enriches the persona"),
    "closure_journey": (True, "Optional 5-session closure journey ending with a last call"),
    "outfits": (True, "Clothing style options for scene generation"),
    "subtitles": (True, "Captions in a second language"),
    "low_bandwidth": (True, "Audio + animated still instead of video"),
    "mood_checkin": (True, "Optional private 1-question mood check before/after calls"),
    "payments": (True, "Prepaid credits"),
    "photo_restoration": (True, "Basic restoration for old or blurry photos"),
}

_cache: dict[str, tuple[float, Any]] = {}


async def _admin_value(key: str) -> dict[str, Any]:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < 20:
        return hit[1]
    async with SessionLocal() as db:
        row = await db.get(AdminSetting, key)
        val = dict(row.value) if row else {}
    _cache[key] = (time.monotonic(), val)
    return val


def invalidate() -> None:
    _cache.clear()


async def provider_primary(capability: str) -> str | None:
    return (await _admin_value("provider_primary")).get(capability)


async def all_flags() -> dict[str, bool]:
    hit = _cache.get("__flags")
    if hit and time.monotonic() - hit[0] < 20:
        return hit[1]
    async with SessionLocal() as db:
        rows = (await db.execute(select(FeatureFlag))).scalars().all()
    flags = {k: v[0] for k, v in DEFAULT_FLAGS.items()}
    flags.update({r.key: r.enabled for r in rows})
    _cache["__flags"] = (time.monotonic(), flags)
    return flags


async def enabled(key: str) -> bool:
    return (await all_flags()).get(key, False)


async def seed_flags() -> None:
    async with SessionLocal() as db:
        for k, (on, desc) in DEFAULT_FLAGS.items():
            if not await db.get(FeatureFlag, k):
                db.add(FeatureFlag(key=k, enabled=on, description=desc))
        await db.commit()
