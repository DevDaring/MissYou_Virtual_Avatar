"""Email (OTP, receipts, notifications). Resend when RESEND_API_KEY is set;
otherwise messages stay in the admin-visible outbox with status
`not_configured` (no fake sending)."""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import EmailOutbox
from ..providers.base import client

log = logging.getLogger("missyou.email")


def configured() -> bool:
    return bool(settings.resend_key)


async def send(db: AsyncSession, to: str, subject: str, body: str, kind: str = "") -> str:
    row = EmailOutbox(to=to, subject=subject, body=body, kind=kind,
                      status="queued" if configured() else "not_configured")
    db.add(row)
    if configured():
        try:
            async with client(15) as c:
                r = await c.post("https://api.resend.com/emails",
                                 headers={"Authorization": f"Bearer {settings.resend_key}"},
                                 json={"from": settings.email_from, "to": [to], "subject": subject, "text": body})
            row.status = "sent" if r.status_code < 300 else "failed"
        except Exception:  # noqa: BLE001
            row.status = "failed"
    return row.status
