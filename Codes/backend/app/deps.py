from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db
from .models import FamilyMember, Person, User
from .redis_client import redis
from .security import SESSION_COOKIE, read_session_token

DB = Annotated[AsyncSession, Depends(get_db)]


def client_ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "")


async def rate_limit(request: Request, bucket: str, limit: int, window_s: int) -> None:
    key = f"missyou:rl:{bucket}:{client_ip(request)}"
    try:
        n = await redis().incr(key)
        if n == 1:
            await redis().expire(key, window_s)
    except Exception:  # noqa: BLE001 — fail open if redis is down
        return
    if n > limit:
        raise HTTPException(429, "Too many attempts. Please wait a little and try again.")


def session_claims(request: Request) -> dict[str, Any] | None:
    tok = request.cookies.get(SESSION_COOKIE)
    return read_session_token(tok) if tok else None


async def current_user(request: Request, db: DB) -> User:
    claims = session_claims(request)
    if not claims:
        raise HTTPException(401, "Please sign in.")
    user = await db.get(User, uuid.UUID(claims["sub"]))
    if not user or user.suspended:
        raise HTTPException(401, "Please sign in.")
    request.state.mfa = bool(claims.get("mfa"))
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def admin_user(request: Request, user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admins only.")
    waived = user.is_demo and settings.demo_admin_2fa_waived
    if not waived and not getattr(request.state, "mfa", False):
        raise HTTPException(403, "two_factor_required")
    return user


AdminUser = Annotated[User, Depends(admin_user)]


async def person_for(db: AsyncSession, person_id: uuid.UUID, user: User, *, owner_only: bool = False) -> Person:
    """Owner, or an active invited family member (read/call access)."""
    p = await db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Not found.")
    if p.owner_id == user.id:
        return p
    if not owner_only:
        fm = (await db.execute(select(FamilyMember).where(
            FamilyMember.person_id == p.id, FamilyMember.user_id == user.id,
            FamilyMember.status == "active"))).scalars().first()
        if fm:
            return p
    raise HTTPException(404, "Not found.")
