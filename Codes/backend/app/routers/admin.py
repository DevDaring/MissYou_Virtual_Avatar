"""Admin panel API (brief 11). Requires role=admin and a 2FA session."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..deps import DB, AdminUser
from ..models import (AdminSetting, Call, CallTurn, EmailOutbox, FeatureFlag, Job, Person, Report, SafetyEvent, User)
from ..providers import registry
from ..services import flags, jobs, metering
from ..services.calls import safety_counts
from ..services.credits import adjust

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview")
async def overview(admin: AdminUser, db: DB) -> dict:
    users = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    persons = (await db.execute(select(func.count()).select_from(Person))).scalar_one()
    calls = (await db.execute(select(func.count()).select_from(Call))).scalar_one()
    open_reports = (await db.execute(select(func.count()).select_from(Report).where(Report.status == "open"))
                    ).scalar_one()
    failed_jobs = (await db.execute(select(func.count()).select_from(Job).where(Job.status == "failed"))).scalar_one()
    return {"users": users, "persons": persons, "calls": calls, "open_reports": open_reports,
            "failed_jobs": failed_jobs, "spend": await metering.spend_summary(14)}


@router.get("/providers")
async def providers(admin: AdminUser) -> dict:
    return await registry.report()


@router.post("/providers/refresh")
async def providers_refresh(admin: AdminUser) -> dict:
    return await registry.refresh()


class PinIn(BaseModel):
    capability: str
    provider: str | None = None


@router.post("/providers/primary")
async def pin_primary(body: PinIn, admin: AdminUser, db: DB) -> dict:
    if body.capability not in registry.CAPABILITIES:
        raise HTTPException(400, "Unknown capability.")
    if body.provider and body.provider not in registry.CAPABILITIES[body.capability]:
        raise HTTPException(400, "That provider can't serve this capability.")
    row = await db.get(AdminSetting, "provider_primary") or AdminSetting(key="provider_primary", value={})
    val = dict(row.value or {})
    if body.provider:
        val[body.capability] = body.provider
    else:
        val.pop(body.capability, None)
    row.value = val
    db.add(row)
    await db.commit()
    flags.invalidate()
    return await registry.refresh(write_report=False)


@router.get("/spend")
async def spend(admin: AdminUser, days: int = 14) -> dict:
    return await metering.spend_summary(max(1, min(days, 90)))


class CapsIn(BaseModel):
    global_daily: float | None = Field(default=None, ge=0)
    global_monthly: float | None = Field(default=None, ge=0)
    provider_daily: float | None = Field(default=None, ge=0)
    user_daily: float | None = Field(default=None, ge=0)
    essential_daily: float | None = Field(default=None, ge=0)
    essential_user_daily: float | None = Field(default=None, ge=0)


@router.post("/caps")
async def set_caps(body: CapsIn, admin: AdminUser, db: DB) -> dict:
    row = await db.get(AdminSetting, "budget_caps") or AdminSetting(key="budget_caps", value={})
    row.value = {**(row.value or {}), **body.model_dump(exclude_none=True)}
    db.add(row)
    await db.commit()
    return {"caps": await metering.caps()}


@router.get("/jobs")
async def list_jobs(admin: AdminUser, db: DB, status: str = "") -> dict:
    q = select(Job).order_by(Job.created_at.desc()).limit(100)
    if status:
        q = q.where(Job.status == status)
    rows = (await db.execute(q)).scalars().all()
    counts = dict((await db.execute(select(Job.status, func.count()).group_by(Job.status))).all())
    return {"counts": counts, "jobs": [{"id": str(j.id), "kind": j.kind, "queue": j.queue, "status": j.status,
                                        "progress": j.progress, "message": j.message, "error": (j.error or "")[:300],
                                        "attempts": j.attempts, "created_at": j.created_at,
                                        "updated_at": j.updated_at} for j in rows]}


@router.post("/jobs/{jid}/retry")
async def retry_job(jid: uuid.UUID, admin: AdminUser, db: DB) -> dict:
    j = await db.get(Job, jid)
    if not j:
        raise HTTPException(404, "Not found.")
    if j.attempts >= 2:
        raise HTTPException(400, "This job has already been retried twice (paid generations are never retried more).")
    j.attempts += 1
    j.status = "queued"
    await db.commit()
    p = await jobs.pool()
    await p.enqueue_job(j.kind, str(j.id), _queue_name=jobs.QUEUES[j.queue], _job_id=f"{j.id}:r{j.attempts}")
    return {"ok": True}


@router.post("/jobs/{jid}/cancel")
async def cancel_job(jid: uuid.UUID, admin: AdminUser, db: DB) -> dict:
    j = await db.get(Job, jid)
    if not j:
        raise HTTPException(404, "Not found.")
    from arq.jobs import Job as ArqJob
    try:
        await ArqJob(str(j.id), await jobs.pool(), _queue_name=jobs.QUEUES[j.queue]).abort(timeout=1)
    except Exception:  # noqa: BLE001
        pass
    j.status = "cancelled"
    await db.commit()
    return {"ok": True}


@router.get("/safety")
async def safety_queue(admin: AdminUser, db: DB) -> dict:
    events = (await db.execute(select(SafetyEvent).order_by(SafetyEvent.created_at.desc()).limit(100))).scalars().all()
    reports = (await db.execute(select(Report).order_by(Report.created_at.desc()).limit(100))).scalars().all()
    refused = (await db.execute(select(Person).where(Person.status == "refused").order_by(Person.updated_at.desc())
                                .limit(50))).scalars().all()
    return {
        "counts": await safety_counts(db),
        "events": [{"id": str(e.id), "kind": e.kind, "category": e.category, "detector": e.detector,
                    "status": e.status, "created_at": e.created_at, "user_id": str(e.user_id) if e.user_id else None}
                   for e in events],
        "reports": [{"id": str(r.id), "reason": r.reason, "details": r.details, "status": r.status,
                     "call_id": str(r.call_id) if r.call_id else None, "created_at": r.created_at,
                     "admin_note": r.admin_note} for r in reports],
        "refused_profiles": [{"id": str(p.id), "reason": p.refused_reason, "owner_id": str(p.owner_id),
                              "at": p.updated_at} for p in refused]}


class ResolveIn(BaseModel):
    status: str = Field(pattern="^(open|reviewed|resolved|dismissed)$")
    note: str = Field(default="", max_length=500)


@router.post("/reports/{rid}")
async def resolve_report(rid: uuid.UUID, body: ResolveIn, admin: AdminUser, db: DB) -> dict:
    r = await db.get(Report, rid)
    if not r:
        raise HTTPException(404, "Not found.")
    r.status, r.admin_note = body.status, body.note
    await db.commit()
    return {"ok": True}


@router.post("/safety/{eid}")
async def resolve_event(eid: uuid.UUID, body: ResolveIn, admin: AdminUser, db: DB) -> dict:
    e = await db.get(SafetyEvent, eid)
    if not e:
        raise HTTPException(404, "Not found.")
    e.status, e.admin_note = body.status, body.note
    await db.commit()
    return {"ok": True}


@router.get("/users")
async def users(admin: AdminUser, db: DB, q: str = "") -> dict:
    stmt = select(User).order_by(User.created_at.desc()).limit(200)
    if q:
        stmt = stmt.where((User.email.ilike(f"%{q}%")) | (User.username.ilike(f"%{q}%")) |
                          (User.display_name.ilike(f"%{q}%")))
    rows = (await db.execute(stmt)).scalars().all()
    return {"users": [{"id": str(u.id), "email": u.email, "username": u.username, "display_name": u.display_name,
                       "role": u.role, "credits": u.credits, "suspended": u.suspended, "is_demo": u.is_demo,
                       "created_at": u.created_at, "last_login_at": u.last_login_at} for u in rows]}


class UserAction(BaseModel):
    credits_delta: int | None = None
    reason: str = Field(default="admin_adjustment", max_length=60)
    suspended: bool | None = None
    role: str | None = Field(default=None, pattern="^(user|family_member|admin)$")


@router.post("/users/{uid}")
async def user_action(uid: uuid.UUID, body: UserAction, admin: AdminUser, db: DB) -> dict:
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found.")
    if body.credits_delta:
        await adjust(db, uid, body.credits_delta, body.reason, f"admin:{admin.id}")
    if body.suspended is not None and not u.is_demo:
        u.suspended = body.suspended
    if body.role and u.id != admin.id:
        u.role = body.role
    await db.commit()
    return {"ok": True, "credits": u.credits}


@router.delete("/users/{uid}")
async def delete_user(uid: uuid.UUID, admin: AdminUser, db: DB) -> dict:
    from ..services.privacy import delete_account
    u = await db.get(User, uid)
    if not u or u.is_demo or u.id == admin.id:
        raise HTTPException(400, "This account can't be deleted here.")
    report = await delete_account(db, u)
    await db.commit()
    return {"deleted": True, "report": report}


@router.get("/flags")
async def get_flags(admin: AdminUser, db: DB) -> dict:
    rows = (await db.execute(select(FeatureFlag).order_by(FeatureFlag.key))).scalars().all()
    return {"flags": [{"key": f.key, "enabled": f.enabled, "description": f.description} for f in rows]}


class FlagIn(BaseModel):
    enabled: bool


@router.post("/flags/{key}")
async def set_flag(key: str, body: FlagIn, admin: AdminUser, db: DB) -> dict:
    f = await db.get(FeatureFlag, key)
    if not f:
        raise HTTPException(404, "Unknown flag.")
    f.enabled = body.enabled
    await db.commit()
    flags.invalidate()
    return {"ok": True}


@router.get("/latency")
async def latency(admin: AdminUser, db: DB, days: int = 7) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(select(CallTurn.timings).where(CallTurn.created_at >= since,
                                                            CallTurn.role == "assistant"))).scalars().all()
    stages = ["stt_ms", "safety_ms", "llm_ms", "tts_first_ms", "tts_total_ms", "first_audio_ms", "lipsync_ms"]
    out: dict[str, Any] = {}
    for s in stages:
        vals = sorted(int(t[s]) for t in rows if t and isinstance(t.get(s), (int, float)))
        if vals:
            out[s] = {"n": len(vals), "p50": vals[len(vals) // 2], "p90": vals[min(len(vals) - 1, int(len(vals) * .9))],
                      "max": vals[-1]}
    return {"stages": out, "targets": {"first_audio_ms": 4000, "lipsync_video_ms": 10000}}


@router.get("/outbox")
async def outbox(admin: AdminUser, db: DB) -> dict:
    rows = (await db.execute(select(EmailOutbox).order_by(EmailOutbox.created_at.desc()).limit(100))).scalars().all()
    return {"emails": [{"id": str(e.id), "to": e.to, "subject": e.subject, "kind": e.kind, "status": e.status,
                        "created_at": e.created_at, "body": e.body if e.kind != "otp" else "(hidden)"} for e in rows]}
