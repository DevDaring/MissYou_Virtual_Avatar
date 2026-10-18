"""Account settings, onboarding consent, wellbeing, export/delete, credits,
and the v1.5 extras: special days, letters, family sharing, closure journey."""
from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from starlette.background import BackgroundTask

from ..config import settings
from ..deps import DB, CurrentUser, client_ip, person_for
from ..models import (Consent, CreditLedger, FamilyMember, Letter, MoodCheck, Payment, Person, PersonaEditRequest,
                      SpecialDay, User)
from ..security import CSRF_COOKIE, SESSION_COOKIE
from ..services import av, jobs
from ..services.assets import url
from ..services.calls import minutes_today
from ..services.credits import InsufficientCredits, charge
from ..services.flags import enabled
from ..services.pricing import credit_cost, credit_packs
from ..services.privacy import delete_account, export_zip
from ..services.safety import check as safety_check
from .auth import public_user
from .people import apply_persona_patch

router = APIRouter(prefix="/api", tags=["me"])
ONBOARDING_VERSION = "2026-10-15"


def effective_daily_limit(user: User) -> int:
    limit = int((user.prefs or {}).get("daily_minutes_limit") or settings.daily_minutes_default)
    return max(limit, 60) if user.is_demo else min(limit, settings.daily_minutes_default)


def user_today(user: User) -> date:
    from zoneinfo import ZoneInfo
    try:
        return datetime.now(ZoneInfo(user.timezone or "Asia/Kolkata")).date()
    except Exception:  # noqa: BLE001
        return date.today()


class SettingsIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    language: str | None = Field(default=None, pattern="^(en|bn|hi)$")
    timezone: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=8)
    prefs: dict[str, Any] | None = None


PREF_KEYS = {"store_transcripts", "daily_minutes_limit", "call_soft_limit_min", "captions", "ambient",
             "audio_first", "subtitle_lang", "low_bandwidth", "notify_letters", "notify_special_days",
             "mood_checkin", "pip_camera", "onboarded"}


@router.patch("/me")
async def update_settings(body: SettingsIn, user: CurrentUser, db: DB) -> dict:
    for k in ("display_name", "language", "timezone", "region"):
        v = getattr(body, k)
        if v is not None:
            setattr(user, k, v)
    if body.prefs:
        prefs = dict(user.prefs or {})
        for k, v in body.prefs.items():
            if k in PREF_KEYS:
                prefs[k] = v
        prefs["daily_minutes_limit"] = max(5, min(int(prefs.get("daily_minutes_limit") or 30),
                                                  settings.daily_minutes_default))
        prefs["call_soft_limit_min"] = max(1, min(int(prefs.get("call_soft_limit_min") or 15),
                                                  settings.call_admin_max_min))
        user.prefs = prefs
    await db.commit()
    return {"user": public_user(user)}


class OnboardIn(BaseModel):
    understood: list[str]


ONBOARDING_STATEMENTS = [
    "I understand Miss You creates an AI recreation. It is not the real person and cannot truly be them.",
    "I understand it is meant to comfort, not to replace grief support or professional help.",
    "I am 18 or older.",
]


@router.get("/onboarding")
async def onboarding_text() -> dict:
    return {"version": ONBOARDING_VERSION, "statements": ONBOARDING_STATEMENTS}


@router.post("/onboarding")
async def onboard(body: OnboardIn, request: Request, user: CurrentUser, db: DB) -> dict:
    if sorted(body.understood) != sorted(ONBOARDING_STATEMENTS):
        raise HTTPException(400, "Please confirm each statement.")
    db.add(Consent(user_id=user.id, kind="onboarding", version=ONBOARDING_VERSION, statements=body.understood,
                   ip=client_ip(request), user_agent=request.headers.get("user-agent", "")[:400]))
    user.prefs = {**(user.prefs or {}), "onboarded": True}
    await db.commit()
    return {"user": public_user(user)}


@router.get("/me/wellbeing")
async def wellbeing(user: CurrentUser, db: DB) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    moods = (await db.execute(select(MoodCheck).where(MoodCheck.user_id == user.id, MoodCheck.created_at >= since)
                              .order_by(MoodCheck.created_at))).scalars().all()
    return {"minutes_today": round(await minutes_today(db, user.id), 1),
            "daily_limit": effective_daily_limit(user),
            "moods": [{"score": m.score, "phase": m.phase, "at": m.created_at} for m in moods]}


@router.get("/me/credits")
async def credits(user: CurrentUser, db: DB) -> dict:
    rows = (await db.execute(select(CreditLedger).where(CreditLedger.user_id == user.id)
                             .order_by(CreditLedger.created_at.desc()).limit(50))).scalars().all()
    return {"balance": user.credits, "ledger": [{"delta": r.delta, "reason": r.reason, "balance": r.balance_after,
                                                 "at": r.created_at} for r in rows],
            "costs": {k: credit_cost(k) for k in ("voice_clone", "scene_generation", "call_minute",
                                                  "interview_minute", "letter")},
            "packs": credit_packs(), "payments_configured": bool(settings.razorpay_key_id)}


@router.get("/me/export")
async def export(user: CurrentUser, db: DB) -> FileResponse:
    dest = av.tmp(".zip")
    await export_zip(db, user, dest)
    return FileResponse(dest, media_type="application/zip", filename="missyou-export.zip",
                        background=BackgroundTask(lambda: dest.unlink(missing_ok=True)))


@router.delete("/me")
async def delete_me(response: Response, user: CurrentUser, db: DB, confirm: str = "") -> dict:
    if confirm != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm.")
    if user.is_demo:
        raise HTTPException(403, "The shared jury demo account can't be deleted.")
    report = await delete_account(db, user)
    await db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"deleted": True, "report": report}


# ------------------------------------------------------------------ payments

class OrderIn(BaseModel):
    pack: str


@router.post("/payments/order")
async def create_order(body: OrderIn, user: CurrentUser, db: DB) -> dict:
    if not await enabled("payments"):
        raise HTTPException(403, "Payments are switched off.")
    pack = next((p for p in credit_packs() if p.get("id") == body.pack), None)
    if not pack:
        raise HTTPException(404, "Unknown pack.")
    if not settings.razorpay_key_id:
        raise HTTPException(503, {"code": "payments_not_configured",
                                  "message": "Payments aren't set up on this deployment yet. An admin can add "
                                             "credits for you."})
    db.add(Payment(user_id=user.id, provider="razorpay", pack=pack["id"], amount_inr=float(pack["inr"]),
                   credits=int(pack["credits"]), status="created"))
    await db.commit()
    raise HTTPException(501, "Razorpay order creation is stubbed until keys are provided (docs/DECISIONS.md).")


# ------------------------------------------------------------------ special days

class DayIn(BaseModel):
    person_id: uuid.UUID
    title: str = Field(max_length=120)
    kind: str = Field(default="birthday", max_length=30)
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    notify: bool = True


@router.get("/special-days")
async def special_days(user: CurrentUser, db: DB) -> dict:
    rows = (await db.execute(select(SpecialDay).where(SpecialDay.user_id == user.id)
                             .order_by(SpecialDay.month, SpecialDay.day))).scalars().all()
    today = user_today(user)
    out = []
    for d in rows:
        p = await db.get(Person, d.person_id)
        out.append({"id": str(d.id), "person_id": str(d.person_id), "person_name": p.name if p else "",
                    "called_name": p.called_name if p else "", "title": d.title, "kind": d.kind, "month": d.month,
                    "day": d.day, "notify": d.notify, "today": d.month == today.month and d.day == today.day})
    return {"days": out, "festivals": FESTIVALS_2026}


FESTIVALS_2026 = [
    {"title": "Durga Puja (Maha Ashtami)", "month": 10, "day": 19}, {"title": "Diwali", "month": 11, "day": 8},
    {"title": "Bhai Dooj", "month": 11, "day": 11}, {"title": "Christmas", "month": 12, "day": 25},
    {"title": "New Year", "month": 1, "day": 1}, {"title": "Poila Baishakh", "month": 4, "day": 15},
    {"title": "Eid al-Fitr", "month": 3, "day": 20}, {"title": "Holi", "month": 3, "day": 4},
]


@router.post("/special-days")
async def add_day(body: DayIn, user: CurrentUser, db: DB) -> dict:
    if not await enabled("special_days"):
        raise HTTPException(403, "Special days are switched off.")
    await person_for(db, body.person_id, user)
    d = SpecialDay(user_id=user.id, **body.model_dump())
    db.add(d)
    await db.commit()
    return {"id": str(d.id)}


@router.delete("/special-days/{did}")
async def delete_day(did: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    d = await db.get(SpecialDay, did)
    if not d or d.user_id != user.id:
        raise HTTPException(404, "Not found.")
    await db.delete(d)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ letters

class LetterIn(BaseModel):
    person_id: uuid.UUID
    text: str = Field(min_length=3, max_length=4000)


def letter_out(lt: Letter, p: Person | None = None) -> dict[str, Any]:
    return {"id": str(lt.id), "person_id": str(lt.person_id), "person_name": p.name if p else None,
            "text": lt.text, "status": lt.status, "reply_text": lt.reply_text,
            "reply_audio_url": url(lt.reply_audio_media_id, 3600), "reply_video_url": url(lt.reply_video_media_id, 3600),
            "read": lt.read, "created_at": lt.created_at, "delivered_at": lt.delivered_at}


@router.post("/letters")
async def write_letter(body: LetterIn, user: CurrentUser, db: DB) -> dict:
    if not await enabled("voice_letters"):
        raise HTTPException(403, "Letters are switched off.")
    p = await person_for(db, body.person_id, user)
    verdict = await safety_check(body.text, user_id=user.id)
    if verdict.pause_call:
        from ..services.safety import log_event, support_resources
        await log_event("crisis", user_id=user.id, person_id=p.id, category=verdict.crisis_type,
                        detector=",".join(verdict.detectors))
        return {"crisis": True, "resources": support_resources(user.region)}
    if verdict.abuse:
        raise HTTPException(400, "This letter asks for something the recreation can't say.")
    lt = Letter(user_id=user.id, person_id=p.id, text=body.text)
    db.add(lt)
    await db.flush()
    try:
        await charge(db, user, "letter", f"letter:{lt.id}")
    except InsufficientCredits as e:
        raise HTTPException(402, {"code": "insufficient_credits", "needed": e.needed, "balance": e.balance})
    await db.commit()
    await jobs.enqueue("write_letter", queue="gpu", user_id=user.id, person_id=p.id, letter_id=str(lt.id))
    return {"letter": letter_out(lt, p)}


@router.get("/letters")
async def letters(user: CurrentUser, db: DB) -> dict:
    rows = (await db.execute(select(Letter).where(Letter.user_id == user.id).order_by(Letter.created_at.desc()))
            ).scalars().all()
    out = []
    for lt in rows:
        out.append(letter_out(lt, await db.get(Person, lt.person_id)))
    return {"letters": out}


@router.post("/letters/{lid}/read")
async def letter_read(lid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    lt = await db.get(Letter, lid)
    if not lt or lt.user_id != user.id:
        raise HTTPException(404, "Not found.")
    lt.read = True
    await db.commit()
    return {"ok": True}


@router.delete("/letters/{lid}")
async def letter_delete(lid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    lt = await db.get(Letter, lid)
    if not lt or lt.user_id != user.id:
        raise HTTPException(404, "Not found.")
    await db.delete(lt)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ family sharing

class InviteIn(BaseModel):
    email: str = Field(default="", max_length=320)


@router.post("/people/{pid}/family")
async def invite(pid: uuid.UUID, body: InviteIn, user: CurrentUser, db: DB) -> dict:
    if not await enabled("family_sharing"):
        raise HTTPException(403, "Family sharing is switched off.")
    p = await person_for(db, pid, user, owner_only=True)
    code = secrets.token_urlsafe(9)
    fm = FamilyMember(person_id=p.id, invited_by=user.id, invite_code=code, invited_email=body.email.strip().lower())
    db.add(fm)
    await db.commit()
    return {"invite_code": code, "link": f"{settings.public_url}/join/{code}"}


@router.get("/people/{pid}/family")
async def family(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    rows = (await db.execute(select(FamilyMember).where(FamilyMember.person_id == pid))).scalars().all()
    reqs = (await db.execute(select(PersonaEditRequest).where(PersonaEditRequest.person_id == pid,
                                                              PersonaEditRequest.status == "pending"))).scalars().all()
    out = []
    for f in rows:
        u = await db.get(User, f.user_id) if f.user_id else None
        out.append({"id": str(f.id), "status": f.status, "email": f.invited_email,
                    "name": u.display_name if u else None, "invite_code": f.invite_code if f.status == "invited"
                    else None, "created_at": f.created_at})
    return {"members": out, "requests": [{"id": str(r.id), "patch": r.patch, "requester_id": str(r.requester_id),
                                          "created_at": r.created_at} for r in reqs]}


@router.post("/family/join/{code}")
async def join(code: str, user: CurrentUser, db: DB) -> dict:
    fm = (await db.execute(select(FamilyMember).where(FamilyMember.invite_code == code))).scalars().first()
    if not fm or fm.status != "invited":
        raise HTTPException(404, "This invitation is no longer valid.")
    p = await db.get(Person, fm.person_id)
    if not p or p.owner_id == user.id:
        raise HTTPException(400, "This is already yours.")
    fm.user_id, fm.status = user.id, "active"
    if user.role == "user":
        user.role = "family_member"
    await db.commit()
    return {"person_id": str(fm.person_id), "name": p.name}


@router.delete("/people/{pid}/family/{fid}")
async def revoke(pid: uuid.UUID, fid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    fm = await db.get(FamilyMember, fid)
    if not fm or fm.person_id != pid:
        raise HTTPException(404, "Not found.")
    fm.status = "revoked"
    await db.commit()
    return {"ok": True}


class DecisionIn(BaseModel):
    approve: bool


@router.post("/people/{pid}/requests/{rid}")
async def decide(pid: uuid.UUID, rid: uuid.UUID, body: DecisionIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    r = await db.get(PersonaEditRequest, rid)
    if not r or r.person_id != pid or r.status != "pending":
        raise HTTPException(404, "Not found.")
    r.status = "approved" if body.approve else "rejected"
    if body.approve:
        patch = dict(r.patch)
        note = patch.pop("add_note", None)
        if note:
            from ..models import MemoryNote
            db.add(MemoryNote(person_id=pid, author_id=r.requester_id, text=str(note)[:1000]))
        if patch:
            apply_persona_patch(p, patch)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ closure journey

@router.post("/people/{pid}/closure")
async def closure(pid: uuid.UUID, user: CurrentUser, db: DB, action: str = "start") -> dict:
    if not await enabled("closure_journey"):
        raise HTTPException(403, "The closure journey is switched off.")
    p = await person_for(db, pid, user, owner_only=True)
    cl = dict(p.closure or {})
    if action == "start":
        cl = {"active": True, "sessions_done": 0, "total": 5, "started_at": datetime.now(timezone.utc).isoformat()}
    elif action == "stop":
        cl["active"] = False
    p.closure = cl
    await db.commit()
    return {"closure": cl}


@router.get("/home")
async def home(user: CurrentUser, db: DB) -> dict:
    today = user_today(user)
    days = (await db.execute(select(SpecialDay).where(SpecialDay.user_id == user.id, SpecialDay.notify.is_(True),
                                                      SpecialDay.month == today.month, SpecialDay.day == today.day))
            ).scalars().all()
    reminders = []
    for d in days:
        p = await db.get(Person, d.person_id)
        if p:
            reminders.append({"person_id": str(p.id), "title": d.title,
                              "message": f"It's {d.title} today. Would you like to talk to "
                                         f"{p.called_name or p.name}?"})
    unread = (await db.execute(select(func.count()).select_from(Letter).where(
        Letter.user_id == user.id, Letter.status == "ready", Letter.read.is_(False)))).scalar_one()
    return {"reminders": reminders, "unread_letters": unread,
            "minutes_today": round(await minutes_today(db, user.id), 1)}
