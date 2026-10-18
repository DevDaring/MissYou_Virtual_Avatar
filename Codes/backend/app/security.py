from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from .config import settings

_ph = PasswordHasher()
SESSION_COOKIE = "my_session"
CSRF_COOKIE = "my_csrf"
CSRF_HEADER = "x-csrf-token"


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def make_session_token(user_id: uuid.UUID, mfa: bool = False) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(hours=settings.session_hours),
               "mfa": mfa, "jti": secrets.token_hex(8)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def read_session_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)


def hash_code(code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), code.encode(), hashlib.sha256).hexdigest()


def new_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


# --- TOTP (admin 2FA) ------------------------------------------------------

def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name="Miss You")


def verify_totp(secret: str, code: str) -> bool:
    return bool(secret) and pyotp.TOTP(secret).verify(code.strip(), valid_window=1)


# --- Signed, expiring media URLs -------------------------------------------

def sign_media(media_id: uuid.UUID | str, ttl: int | None = None) -> str:
    # Expiry is bucketed to 5 minutes so the same clip keeps one URL for a
    # while (lets the PWA cache it) while still expiring.
    exp = (int(time.time()) + (ttl or settings.signed_url_ttl)) // 300 * 300 + 300
    msg = f"{media_id}.{exp}".encode()
    sig = hmac.new(settings.url_signing_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return f"/api/media/{media_id}?exp={exp}&sig={sig}"


def check_media_sig(media_id: str, exp: int, sig: str) -> bool:
    if exp < int(time.time()):
        return False
    msg = f"{media_id}.{exp}".encode()
    good = hmac.new(settings.url_signing_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(good, sig)
