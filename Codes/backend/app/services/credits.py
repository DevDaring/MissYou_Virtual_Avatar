"""Prepaid credits ledger (brief 10). Balance lives on users.credits; every
change is an append-only ledger row. Costs come from config/pricing.yaml."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import CreditLedger, User
from .pricing import credit_cost


class InsufficientCredits(RuntimeError):
    def __init__(self, needed: int, balance: int) -> None:
        super().__init__(f"needs {needed} credits, balance {balance}")
        self.needed, self.balance = needed, balance


async def adjust(db: AsyncSession, user_id: uuid.UUID, delta: int, reason: str, ref: str = "") -> int:
    user = (await db.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one()
    user.credits = (user.credits or 0) + delta
    db.add(CreditLedger(user_id=user_id, delta=delta, balance_after=user.credits, reason=reason, ref=ref[:120]))
    return user.credits


async def charge(db: AsyncSession, user: User, action: str, ref: str = "", amount: int | None = None) -> int:
    cost = credit_cost(action) if amount is None else amount
    if cost <= 0:
        return 0
    fresh = (await db.execute(select(User).where(User.id == user.id).with_for_update())).scalar_one()
    if (fresh.credits or 0) < cost:
        raise InsufficientCredits(cost, fresh.credits or 0)
    await adjust(db, user.id, -cost, action, ref)
    return cost


async def refund(db: AsyncSession, user_id: uuid.UUID | None, action: str, ref: str) -> int:
    if not user_id:
        return 0
    row = (await db.execute(select(CreditLedger).where(
        CreditLedger.user_id == user_id, CreditLedger.reason == action, CreditLedger.ref == ref[:120],
        CreditLedger.delta < 0))).scalars().first()
    if not row:
        return 0
    already = (await db.execute(select(CreditLedger).where(
        CreditLedger.user_id == user_id, CreditLedger.reason == f"refund:{action}",
        CreditLedger.ref == ref[:120]))).scalars().first()
    if already:
        return 0
    await adjust(db, user_id, -row.delta, f"refund:{action}", ref)
    return -row.delta
