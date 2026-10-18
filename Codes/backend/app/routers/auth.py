from __future__ import annotations

import io
import re
from datetime import date, datetime, timedelta, timezone

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select

from ..config import settings
from ..deps import DB, CurrentUser, rate_limit, session_claims
from ..models import OtpCode, User, utcnow
from ..security import (CSRF_COOKIE, SESSION_COOKIE, hash_code, hash_password, make_session_token, new_csrf_token,
                        new_otp, new_totp_secret, totp_uri, verify_password, verify_totp)
from ..services import email as mail
from ..services.credits import adjust

router = APIRouter(prefix="/api/auth", tags=["auth"])


def set_session(resp: Response, user: User, mfa: bool = False) -> None:
    resp.set_cookie(SESSION_COOKIE, make_session_token(user.id, mfa), httponly=True, secure=settings.secure_cookies,
                    samesite="lax", max_age=settings.session_hours * 3600, path="/")
    resp.set_cookie(CSRF_COOKIE, new_csrf_token(), httponly=False, secure=settings.secure_cookies, samesite="lax",
                    max_age=settings.session_hours * 3600, path="/")


def is_adult(dob: date) -> bool:
    today = date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    return age >= 18


def public_user(u: User, mfa: bool = False) -> dict:
    return {"id": str(u.id), "email": u.email, "username": u.username, "display_name": u.display_name,
            "role": u.role, "language": u.language, "timezone": u.timezone, "region": u.region, "prefs": u.prefs,
            "credits": u.credits, "is_demo": u.is_demo, "totp_enabled": u.totp_enabled, "mfa": mfa,
            "onboarded": bool((u.prefs or {}).get("onboarded")),
            "admin_2fa_waived": u.is_demo and settings.demo_admin_2fa_waived}


async def grant_trial(db: DB, user: User) -> None:
    if not user.trial_granted and settings.free_trial_credits > 0:
        user.trial_granted = True
        await db.flush()
        await adjust(db, user.id, settings.free_trial_credits, "free_trial")


class SignupIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    username: str | None = Field(default=None, max_length=64)
    dob: date
    language: str = "en"
    accept_terms: bool


@router.post("/signup")
async def signup(body: SignupIn, request: Request, response: Response, db: DB) -> dict:
    await rate_limit(request, "signup", 30, 3600)  # generous: a jury room shares one IP
    if not body.accept_terms:
        raise HTTPException(400, "Please accept the Terms of Use and Privacy Policy.")
    if not is_adult(body.dob):
        raise HTTPException(403, "under_18")
    email = body.email.lower()
    username = (body.username or "").strip() or None
    if username and not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username):
        raise HTTPException(400, "Usernames can use letters, numbers, dot, dash and underscore.")
    conds = [func.lower(User.email) == email] + ([User.username == username] if username else [])
    exists = (await db.execute(select(User).where(or_(*conds)))).scalars().first()
    if exists:
        raise HTTPException(409, "An account with that email or username already exists.")
    user = User(email=email, username=username, display_name=body.display_name.strip(),
                password_hash=hash_password(body.password) if body.password else None, dob=body.dob,
                language=body.language if body.language in ("en", "bn", "hi") else "en",
                prefs={"store_transcripts": False, "daily_minutes_limit": settings.daily_minutes_default,
                       "call_soft_limit_min": settings.call_soft_limit_min, "captions": True, "ambient": True,
                       "audio_first": True})
    db.add(user)
    await db.flush()
    await grant_trial(db, user)
    await db.commit()
    set_session(response, user)
    return {"user": public_user(user)}


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=200)
    totp: str | None = Field(default=None, max_length=10)


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: DB) -> dict:
    await rate_limit(request, "login", 40, 900)
    ident = body.login.strip()
    user = (await db.execute(select(User).where(or_(func.lower(User.email) == ident.lower(),
                                                    User.username == ident)))).scalars().first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "That username or password doesn't match.")
    if user.suspended:
        raise HTTPException(403, "This account is suspended. Please contact support.")
    mfa = bool(body.totp and user.totp_enabled and user.totp_secret and verify_totp(user.totp_secret, body.totp))
    if body.totp and not mfa:
        raise HTTPException(401, "That authenticator code doesn't match.")
    user.last_login_at = utcnow()
    await db.commit()
    set_session(response, user, mfa=mfa)
    return {"user": public_user(user, mfa)}


class OtpRequestIn(BaseModel):
    email: EmailStr


@router.post("/otp/request")
async def otp_request(body: OtpRequestIn, request: Request, db: DB) -> dict:
    await rate_limit(request, "otp", 5, 900)
    if not mail.configured() and settings.is_prod:
        raise HTTPException(503, "email_not_configured")
    code = new_otp()
    db.add(OtpCode(email=body.email.lower(), code_hash=hash_code(code),
                   expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)))
    status = await mail.send(db, body.email.lower(), "Your Miss You sign-in code",
                             f"Your code is {code}. It expires in 10 minutes. If you didn't ask for it, ignore this.",
                             kind="otp")
    await db.commit()
    out: dict = {"sent": status == "sent"}
    if not settings.is_prod and status != "sent":
        out["dev_code"] = code  # development only: no email provider configured
    return out


class OtpVerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    dob: date | None = None
    display_name: str | None = None


@router.post("/otp/verify")
async def otp_verify(body: OtpVerifyIn, request: Request, response: Response, db: DB) -> dict:
    await rate_limit(request, "otp_verify", 10, 900)
    email = body.email.lower()
    row = (await db.execute(select(OtpCode).where(OtpCode.email == email, OtpCode.used.is_(False))
                            .order_by(OtpCode.created_at.desc()))).scalars().first()
    if not row or row.expires_at < datetime.now(timezone.utc) or row.attempts >= 5:
        raise HTTPException(400, "That code has expired. Please ask for a new one.")
    row.attempts += 1
    if row.code_hash != hash_code(body.code):
        await db.commit()
        raise HTTPException(400, "That code doesn't match.")
    row.used = True
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalars().first()
    if not user:
        if not body.dob:
            await db.commit()
            return {"needs_profile": True}
        if not is_adult(body.dob):
            raise HTTPException(403, "under_18")
        user = User(email=email, display_name=(body.display_name or email.split("@")[0])[:120], dob=body.dob,
                    email_verified=True, prefs={"store_transcripts": False,
                                                "daily_minutes_limit": settings.daily_minutes_default,
                                                "call_soft_limit_min": settings.call_soft_limit_min,
                                                "captions": True, "ambient": True, "audio_first": True})
        db.add(user)
        await db.flush()
        await grant_trial(db, user)
    user.email_verified = True
    user.last_login_at = utcnow()
    await db.commit()
    set_session(response, user)
    return {"user": public_user(user)}


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(request: Request, user: CurrentUser) -> dict:
    claims = session_claims(request) or {}
    return {"user": public_user(user, bool(claims.get("mfa")))}


@router.get("/google")
async def google() -> dict:
    raise HTTPException(501, "Google sign-in is not configured on this deployment.")


@router.post("/2fa/setup")
async def totp_setup(user: CurrentUser, db: DB) -> dict:
    if user.totp_enabled:
        raise HTTPException(400, "Two-factor is already on.")
    user.totp_secret = new_totp_secret()
    await db.commit()
    uri = totp_uri(user.totp_secret, user.email or user.username or str(user.id))
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return {"otpauth_uri": uri, "qr_svg": buf.getvalue().decode()}


class TotpIn(BaseModel):
    code: str


@router.post("/2fa/verify")
async def totp_verify(body: TotpIn, request: Request, response: Response, user: CurrentUser, db: DB) -> dict:
    await rate_limit(request, "totp", 10, 900)
    if not user.totp_secret or not verify_totp(user.totp_secret, body.code):
        raise HTTPException(400, "That code doesn't match.")
    user.totp_enabled = True
    await db.commit()
    set_session(response, user, mfa=True)
    return {"user": public_user(user, True)}
