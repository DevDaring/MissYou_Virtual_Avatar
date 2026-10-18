"""Cost metering and budget guards (brief 4.4).

Every paid provider call goes through `metered()`:

    async with metered(provider="xai", capability="scene_image", model=m,
                       est_usd=0.07, user_id=u, feature="scene") as meter:
        ... make the call ...
        meter.units, meter.unit_type = 1, "image"   # actual usage
        meter.cost_usd = actual_cost                 # optional: exact bill

Before the call the budget is checked for every scope (global day, global
month, provider day, user day). The usage row is written in its own session,
so it survives even when the caller's transaction rolls back.
"""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from sqlalchemy import func, select

from ..config import settings
from ..db import SessionLocal
from ..models import AdminSetting, EmailOutbox, ProviderUsage
from ..redis_client import redis
from .pricing import unit_price

log = logging.getLogger("missyou.metering")


# Cheap, call-critical capabilities have their own budget, so an exhausted generation budget
# (scenes, videos, lip-sync) can never silence a live call.
ESSENTIAL = {"conversation", "safety", "stt", "tts", "translation"}


class BudgetExceeded(RuntimeError):
    def __init__(self, scope: str, spent: float, cap: float) -> None:
        super().__init__(f"budget cap reached for {scope}")
        self.scope, self.spent, self.cap = scope, spent, cap


async def caps() -> dict[str, float]:
    base = {"global_daily": settings.cap_global_daily, "global_monthly": settings.cap_global_monthly,
            "provider_daily": settings.cap_provider_daily, "user_daily": settings.cap_user_daily,
            "essential_daily": settings.cap_essential_daily, "essential_user_daily": settings.cap_essential_user_daily}
    async with SessionLocal() as db:
        row = await db.get(AdminSetting, "budget_caps")
        if row and row.value:
            for k, v in row.value.items():
                if k in base:
                    base[k] = float(v)
    return base


def _day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def spent(*, since: datetime, provider: str | None = None, user_id: uuid.UUID | None = None,
                essential: bool | None = None) -> float:
    async with SessionLocal() as db:
        q = select(func.coalesce(func.sum(ProviderUsage.cost_usd), 0.0)).where(ProviderUsage.created_at >= since)
        if essential is not None:
            cond = ProviderUsage.capability.in_(ESSENTIAL)
            q = q.where(cond if essential else ~cond)
        if provider:
            q = q.where(ProviderUsage.provider == provider)
        if user_id:
            q = q.where(ProviderUsage.user_id == user_id)
        return float((await db.execute(q)).scalar_one())


async def check_budget(provider: str, user_id: uuid.UUID | None, est_usd: float, capability: str = "") -> None:
    c = await caps()
    day = _day_start()
    month = day.replace(day=1)
    if capability in ESSENTIAL:
        checks: list[tuple[str, float, datetime, dict[str, Any]]] = [
            ("essential_daily", c["essential_daily"], day, {"essential": True}),
            ("global_monthly", c["global_monthly"], month, {}),
        ]
        if user_id:
            checks.append(("essential_user_daily", c["essential_user_daily"], day, {"user_id": user_id, "essential": True}))
    else:
        checks = [
            ("global_daily", c["global_daily"], day, {"essential": False}),
            ("global_monthly", c["global_monthly"], month, {}),
            (f"provider_daily:{provider}", c["provider_daily"], day, {"provider": provider, "essential": False}),
        ]
        if user_id:
            checks.append(("user_daily", c["user_daily"], day, {"user_id": user_id, "essential": False}))
    for scope, cap, since, kw in checks:
        if cap <= 0:
            continue
        s = await spent(since=since, **kw)
        if s + est_usd > cap:
            await _notify_cap(scope, s, cap)
            raise BudgetExceeded(scope, s, cap)


async def _notify_cap(scope: str, s: float, cap: float) -> None:
    key = f"missyou:capnotice:{scope}:{_day_start().date()}"
    try:
        if not await redis().set(key, "1", nx=True, ex=86400 * 2):
            return
    except Exception:  # redis down: still notify
        pass
    log.warning("Budget cap reached: %s (spent $%.2f of $%.2f)", scope, s, cap)
    if settings.admin_email:
        async with SessionLocal() as db:
            db.add(EmailOutbox(to=settings.admin_email, subject=f"[Miss You] Budget cap reached: {scope}",
                               body=f"Spent ${s:.2f} of ${cap:.2f}. New paid jobs in this scope are paused.",
                               kind="budget"))
            await db.commit()


class DuplicateGeneration(RuntimeError):
    """A paid generation with this idempotency key already succeeded."""


class Meter:
    def __init__(self) -> None:
        self.units: float = 0.0
        self.unit_type: str = ""
        self.cost_usd: float | None = None
        self.model: str = ""


@asynccontextmanager
async def metered(*, provider: str, capability: str, model: str, est_usd: float,
                  user_id: uuid.UUID | None = None, call_id: uuid.UUID | None = None,
                  feature: str = "", idempotency_key: str | None = None,
                  unit_type: str = "", units: float = 0.0) -> AsyncIterator[Meter]:
    if idempotency_key:
        async with SessionLocal() as db:
            prior = (await db.execute(select(func.count()).select_from(ProviderUsage).where(
                ProviderUsage.idempotency_key == idempotency_key, ProviderUsage.success.is_(True)))).scalar_one()
            if prior:
                log.info("idempotent replay blocked for %s", idempotency_key)
                raise DuplicateGeneration(idempotency_key)
    await check_budget(provider, user_id, est_usd, capability)
    m = Meter()
    m.model, m.unit_type, m.units = model, unit_type, units
    t0 = time.perf_counter()
    ok, err = True, None
    try:
        yield m
    except BudgetExceeded:
        raise
    except Exception as e:  # noqa: BLE001 — recorded then re-raised
        ok, err = False, f"{type(e).__name__}: {str(e)[:200]}"
        raise
    finally:
        latency = int((time.perf_counter() - t0) * 1000)
        price, known = unit_price(provider, m.model or model, m.unit_type or unit_type)
        cost = m.cost_usd if m.cost_usd is not None else (price * m.units if ok else 0.0)
        try:
            async with SessionLocal() as db:
                db.add(ProviderUsage(provider=provider, capability=capability, model=m.model or model,
                                     feature=feature, units=m.units, unit_type=m.unit_type or unit_type,
                                     cost_usd=round(cost, 6), cost_inr=round(cost * settings.inr_per_usd, 4),
                                     price_known=known or m.cost_usd is not None, user_id=user_id,
                                     call_id=call_id, idempotency_key=idempotency_key, latency_ms=latency,
                                     success=ok, error=err))
                await db.commit()
        except Exception:  # never let metering crash the caller
            log.exception("failed to record provider usage")


async def spend_summary(days: int = 14) -> dict[str, Any]:
    since = _day_start() - timedelta(days=days - 1)
    async with SessionLocal() as db:
        day = func.date_trunc("day", ProviderUsage.created_at)
        by_day = (await db.execute(select(day, func.sum(ProviderUsage.cost_usd)).where(
            ProviderUsage.created_at >= since).group_by(day).order_by(day))).all()
        by_provider = (await db.execute(select(ProviderUsage.provider, func.sum(ProviderUsage.cost_usd),
                                               func.count()).where(ProviderUsage.created_at >= since)
                                        .group_by(ProviderUsage.provider))).all()
        by_feature = (await db.execute(select(ProviderUsage.feature, ProviderUsage.capability,
                                              func.sum(ProviderUsage.cost_usd), func.count())
                                       .where(ProviderUsage.created_at >= since)
                                       .group_by(ProviderUsage.feature, ProviderUsage.capability))).all()
        by_user = (await db.execute(select(ProviderUsage.user_id, func.sum(ProviderUsage.cost_usd), func.count())
                                    .where(ProviderUsage.created_at >= since)
                                    .group_by(ProviderUsage.user_id)
                                    .order_by(func.sum(ProviderUsage.cost_usd).desc()).limit(50))).all()
        failures = (await db.execute(select(func.count()).select_from(ProviderUsage).where(
            ProviderUsage.created_at >= since, ProviderUsage.success.is_(False)))).scalar_one()
        unknown = (await db.execute(select(func.count()).select_from(ProviderUsage).where(
            ProviderUsage.created_at >= since, ProviderUsage.price_known.is_(False)))).scalar_one()
    today = await spent(since=_day_start())
    month = await spent(since=_day_start().replace(day=1))
    return {
        "today_usd": round(today, 4), "month_usd": round(month, 4), "inr_per_usd": settings.inr_per_usd,
        "caps": await caps(),
        "by_day": [{"day": d.date().isoformat(), "usd": round(float(v or 0), 4)} for d, v in by_day],
        "by_provider": [{"provider": p, "usd": round(float(v or 0), 4), "calls": n} for p, v, n in by_provider],
        "by_feature": [{"feature": f or "-", "capability": c, "usd": round(float(v or 0), 4), "calls": n}
                       for f, c, v, n in by_feature],
        "by_user": [{"user_id": str(u) if u else None, "usd": round(float(v or 0), 4), "calls": n}
                    for u, v, n in by_user],
        "failed_calls": failures, "unknown_price_calls": unknown,
    }
