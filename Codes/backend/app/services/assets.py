from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MediaAsset
from ..security import sign_media
from ..storage import storage


def _key(owner_id: uuid.UUID, person_id: uuid.UUID | None, mid: uuid.UUID) -> str:
    return f"{owner_id}/{person_id or 'none'}/{mid}.bin"


async def save_asset(db: AsyncSession, *, owner_id: uuid.UUID, person_id: uuid.UUID | None, kind: str,
                     mime: str, data: bytes | None = None, path: Path | None = None,
                     original_name: str = "", ai_generated: bool = False,
                     width: int | None = None, height: int | None = None,
                     duration_s: float | None = None, meta: dict[str, Any] | None = None) -> MediaAsset:
    mid = uuid.uuid4()
    key = _key(owner_id, person_id, mid)
    if data is not None:
        size, sha = storage().put_bytes(key, data)
    elif path is not None:
        size, sha = storage().put_file(key, path)
    else:
        raise ValueError("data or path required")
    asset = MediaAsset(id=mid, owner_id=owner_id, person_id=person_id, kind=kind, mime=mime, size=size,
                       storage_key=key, sha256=sha, original_name=original_name[:255],
                       ai_generated=ai_generated, width=width, height=height, duration_s=duration_s,
                       meta=meta or {})
    db.add(asset)
    await db.flush()
    return asset


def url(asset_id: uuid.UUID | None, ttl: int | None = None) -> str | None:
    return sign_media(asset_id, ttl) if asset_id else None


async def delete_asset(db: AsyncSession, asset: MediaAsset) -> bool:
    removed = storage().delete(asset.storage_key)
    await db.delete(asset)
    return removed
