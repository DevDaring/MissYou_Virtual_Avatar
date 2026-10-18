from __future__ import annotations

import asyncio
import json
import uuid

import yaml
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, text

from ..config import settings
from ..db import SessionLocal
from ..deps import DB, CurrentUser
from ..models import Job, MediaAsset
from ..redis_client import redis
from ..security import SESSION_COOKIE, check_media_sig, read_session_token
from ..services.flags import all_flags
from ..services.safety import support_resources
from ..storage import storage

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/health")
async def health() -> dict:
    db_ok = redis_ok = False
    try:
        async with SessionLocal() as db:
            await db.execute(text("select 1"))
            db_ok = True
    except Exception:  # noqa: BLE001
        pass
    try:
        redis_ok = bool(await redis().ping())
    except Exception:  # noqa: BLE001
        pass
    return {"ok": db_ok and redis_ok, "db": db_ok, "redis": redis_ok, "service": "missyou"}


@router.get("/config")
async def public_config(request: Request) -> dict:
    langs = yaml.safe_load((settings.config_dir / "languages.yaml").read_text()) or {}
    region = request.headers.get("x-region", "IN")
    return {"flags": await all_flags(),
            "demo": {"username": settings.demo_username, "password": settings.demo_password},
            "languages": langs.get("ui_languages", []), "support": support_resources(region),
            "legal_draft": True}


@router.get("/support")
async def support(region: str = "IN") -> dict:
    return support_resources(region)


@router.get("/media/{mid}")
async def media(mid: uuid.UUID, request: Request, exp: int = 0, sig: str = "") -> Response:
    if not check_media_sig(str(mid), exp, sig):
        raise HTTPException(403, "This link has expired.")
    async with SessionLocal() as db:
        a = await db.get(MediaAsset, mid)
    if not a or not storage().exists(a.storage_key):
        raise HTTPException(404, "Not found.")
    size = a.size
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff"}
    if a.ai_generated:
        headers["X-AI-Generated"] = "true"
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes=") and size:
        start_s, _, end_s = rng[6:].split(",")[0].partition("-")
        start = int(start_s) if start_s else max(size - int(end_s or 0), 0)
        end = int(end_s) if (end_s and start_s) else size - 1
        end = min(end, size - 1)
        if start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})
        return StreamingResponse(storage().iter_range(a.storage_key, start, end), status_code=206,
                                 media_type=a.mime, headers=headers)
    headers["Content-Length"] = str(size)
    return StreamingResponse(storage().iter_range(a.storage_key, 0, max(size - 1, 0)), media_type=a.mime,
                             headers=headers)


@router.get("/jobs/{jid}")
async def job_status(jid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    j = await db.get(Job, jid)
    if not j or j.user_id != user.id:
        raise HTTPException(404, "Not found.")
    return {"id": str(j.id), "kind": j.kind, "status": j.status, "progress": j.progress, "message": j.message,
            "result": j.result}


@router.get("/jobs")
async def my_jobs(user: CurrentUser, db: DB, person_id: uuid.UUID | None = None) -> dict:
    q = select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc()).limit(20)
    if person_id:
        q = q.where(Job.person_id == person_id)
    rows = (await db.execute(q)).scalars().all()
    return {"jobs": [{"id": str(j.id), "kind": j.kind, "status": j.status, "progress": j.progress,
                      "message": j.message, "result": j.result, "created_at": j.created_at} for j in rows]}


@router.websocket("/ws")
async def events(ws: WebSocket) -> None:
    """Live job progress for the signed-in user."""
    claims = read_session_token(ws.cookies.get(SESSION_COOKIE, "") or "")
    if not claims:
        await ws.close(code=4401)
        return
    await ws.accept()
    pubsub = redis().pubsub()
    await pubsub.subscribe(f"missyou:events:{claims['sub']}")

    async def pump() -> None:
        async for msg in pubsub.listen():
            if msg.get("type") == "message":
                await ws.send_text(msg["data"])

    task = asyncio.create_task(pump())
    try:
        while True:
            raw = await ws.receive_text()
            if raw == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await pubsub.unsubscribe()
        await pubsub.aclose()
