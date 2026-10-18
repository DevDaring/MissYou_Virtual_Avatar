"""Scenes (brief 6.3–6.4), calls + WebSocket (6.5), history and memory box (6.6)."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.background import BackgroundTask

from ..config import settings
from ..db import SessionLocal
from ..deps import DB, CurrentUser, person_for
from ..models import Call, CallTurn, MediaAsset, MemoryBoxItem, MoodCheck, Person, Report, Scene, User
from ..security import SESSION_COOKIE, read_session_token
from ..services import av, jobs
from ..services.assets import url
from ..services.calls import CallSession, minutes_today
from ..services.credits import InsufficientCredits, charge
from ..services.flags import enabled
from ..services.pipeline import locations
from ..services.pricing import credit_cost
from ..services.privacy import labelled_clip, labelled_video
from ..storage import storage

router = APIRouter(prefix="/api", tags=["calls"])


# ------------------------------------------------------------------ scenes

@router.get("/locations")
async def list_locations() -> dict:
    data = locations()
    return {"locations": [{"key": k, **{f: v.get(f) for f in ("label", "emoji", "gradient", "ambient", "description")}}
                          for k, v in data.get("locations", {}).items()],
            "activities": [{"key": k, "label": k.replace("_", " ").title()} for k in data.get("activities", {})],
            "times": [{"key": k, "label": k.replace("_", " ").title()} for k in data.get("times", {})],
            "weather": [{"key": k, "label": k.replace("_", " ").title()} for k in data.get("weather", {})],
            "outfits": data.get("outfits", []), "cost_credits": credit_cost("scene_generation")}


def scene_out(s: Scene) -> dict[str, Any]:
    loc = locations().get("locations", {}).get(s.location_key, {})
    return {"id": str(s.id), "person_id": str(s.person_id), "location_key": s.location_key,
            "location_label": loc.get("label", s.location_key), "ambient": loc.get("ambient", ""),
            "activity": s.activity, "time_of_day": s.time_of_day, "weather": s.weather, "outfit": s.outfit,
            "status": s.status, "progress": s.progress, "mode": s.mode, "notes": s.notes, "error": s.error,
            "identity_score": s.identity_score, "still_url": url(s.still_media_id, 3600),
            "idle_url": url(s.idle_media_id, 3600), "listening_url": url(s.listening_media_id, 3600),
            "talking_url": url(s.talking_media_id, 3600), "generations": s.generations, "created_at": s.created_at}


class SceneIn(BaseModel):
    location_key: str
    activity: str = "sitting"
    time_of_day: str = "golden_hour"
    weather: str = "clear"
    outfit: str = ""
    place_media_id: uuid.UUID | None = None


@router.get("/people/{pid}/scenes")
async def scenes(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user)
    rows = (await db.execute(select(Scene).where(Scene.person_id == pid).order_by(Scene.created_at.desc()))
            ).scalars().all()
    return {"scenes": [scene_out(s) for s in rows]}


async def _queue_scene(db: DB, user: User, scene: Scene) -> str:
    try:
        await charge(db, user, "scene_generation", f"scene:{scene.id}:{scene.generations}")
    except InsufficientCredits as e:
        raise HTTPException(402, {"code": "insufficient_credits", "needed": e.needed, "balance": e.balance})
    scene.status, scene.progress, scene.error = "queued", 0, None
    await db.commit()
    job = await jobs.enqueue("generate_scene", queue="gpu", user_id=user.id, person_id=scene.person_id,
                             scene_id=str(scene.id))
    return str(job.id)


@router.post("/people/{pid}/scenes")
async def create_scene(pid: uuid.UUID, body: SceneIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    data = locations()
    if body.location_key not in data.get("locations", {}):
        raise HTTPException(400, "Unknown place.")
    if body.location_key == "old_home" and not body.place_media_id:
        raise HTTPException(400, "Please upload a photo of their old home.")
    if body.outfit and not await enabled("outfits"):
        body.outfit = ""
    key = f"{body.location_key}|{body.activity}|{body.time_of_day}|{body.weather}|{body.outfit}|{body.place_media_id or ''}"
    existing = (await db.execute(select(Scene).where(Scene.person_id == pid, Scene.cache_key == key))).scalars().first()
    if existing and existing.status in ("ready", "queued", "generating"):
        return {"scene": scene_out(existing), "cached": True}
    scene = existing or Scene(person_id=pid, location_key=body.location_key, activity=body.activity,
                              time_of_day=body.time_of_day, weather=body.weather, outfit=body.outfit,
                              place_media_id=body.place_media_id, cache_key=key)
    if not existing:
        db.add(scene)
        await db.flush()
    job_id = await _queue_scene(db, user, scene)
    if p.setup_step in ("scene", "persona"):
        p.setup_step = "done"
        await db.commit()
    return {"scene": scene_out(scene), "job_id": job_id, "cached": False}


@router.post("/scenes/{sid}/regenerate")
async def regenerate(sid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    s = await db.get(Scene, sid)
    if not s:
        raise HTTPException(404, "Not found.")
    await person_for(db, s.person_id, user, owner_only=True)
    if s.status in ("queued", "generating"):
        raise HTTPException(409, "This scene is already being made.")
    s.generations += 0
    job_id = await _queue_scene(db, user, s)
    return {"scene": scene_out(s), "job_id": job_id}


@router.get("/scenes/{sid}")
async def get_scene(sid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    s = await db.get(Scene, sid)
    if not s:
        raise HTTPException(404, "Not found.")
    await person_for(db, s.person_id, user)
    return {"scene": scene_out(s)}


@router.delete("/scenes/{sid}")
async def delete_scene(sid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    s = await db.get(Scene, sid)
    if not s:
        raise HTTPException(404, "Not found.")
    await person_for(db, s.person_id, user, owner_only=True)
    for mid in (s.still_media_id, s.idle_media_id, s.listening_media_id, s.talking_media_id):
        a = await db.get(MediaAsset, mid) if mid else None
        if a:
            storage().delete(a.storage_key)
            await db.delete(a)
    await db.delete(s)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ calls

class CallIn(BaseModel):
    person_id: uuid.UUID
    scene_id: uuid.UUID | None = None
    kind: str = Field(default="call", pattern="^(call|interview|closure|last_call)$")
    store_transcript: bool | None = None
    soft_limit_min: int | None = Field(default=None, ge=1, le=60)
    caller_id: str | None = Field(default=None, max_length=20)


@router.post("/calls")
async def start_call(body: CallIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, body.person_id, user)
    if p.status == "refused":
        raise HTTPException(403, "This profile can't be used for calls.")
    if p.status == "archived":
        raise HTTPException(403, "archived")
    if body.kind == "interview" and not await enabled("memory_interview"):
        raise HTTPException(403, "Memory interviews are switched off.")
    if body.kind in ("closure", "last_call") and not await enabled("closure_journey"):
        raise HTTPException(403, "The closure journey is switched off.")
    prefs = user.prefs or {}
    from .me import effective_daily_limit
    limit = effective_daily_limit(user)
    used = await minutes_today(db, user.id)
    if used >= limit:
        raise HTTPException(429, {"code": "daily_limit", "used_min": round(used), "limit_min": limit,
                                  "message": "You've reached today's call time. Rest a little — they'll be here "
                                             "tomorrow. You can change this limit in Settings."})
    per_min = credit_cost("interview_minute" if body.kind == "interview" else "call_minute")
    if user.credits < per_min:
        raise HTTPException(402, {"code": "insufficient_credits", "needed": per_min, "balance": user.credits})
    scene = None
    if body.kind != "interview":
        if body.scene_id:
            scene = await db.get(Scene, body.scene_id)
        if not scene:
            scene = (await db.execute(select(Scene).where(Scene.person_id == p.id, Scene.status == "ready")
                                      .order_by(Scene.created_at.desc()))).scalars().first()
        if not scene or scene.status != "ready" or scene.person_id != p.id:
            raise HTTPException(400, "Please choose a place first.")
    soft_user = int(body.soft_limit_min or prefs.get("call_soft_limit_min") or settings.call_soft_limit_min)
    soft = min(soft_user, settings.call_admin_max_min, max(1, int(limit - used)))
    store = prefs.get("store_transcripts", False) if body.store_transcript is None else body.store_transcript
    caller = {}
    if body.caller_id:
        caller = next((c for c in (p.persona or {}).get("callers", []) if c.get("id") == body.caller_id), {})
        if not caller:
            raise HTTPException(404, "That caller isn't saved for this loved one.")
    call = Call(user_id=user.id, person_id=p.id, scene_id=scene.id if scene else None, kind=body.kind,
                language=p.call_language, store_transcript=bool(store), soft_limit_s=soft * 60, caller=caller)
    db.add(call)
    await db.commit()
    return {"call": call_out(call, p, scene)}


def call_out(c: Call, p: Person | None = None, scene: Scene | None = None) -> dict[str, Any]:
    out = {"id": str(c.id), "person_id": str(c.person_id), "kind": c.kind, "status": c.status,
           "language": c.language, "store_transcript": c.store_transcript, "soft_limit_s": c.soft_limit_s,
           "started_at": c.started_at, "ended_at": c.ended_at, "duration_s": c.duration_s,
           "end_reason": c.end_reason, "reflection": c.reflection, "credits_charged": c.credits_charged,
           "scene_id": str(c.scene_id) if c.scene_id else None, "caller": c.caller or None}
    if p:
        out["person"] = {"name": p.name, "called_name": p.called_name, "relationship": p.relationship}
    if scene:
        out["scene"] = scene_out(scene)
    return out


@router.get("/calls")
async def history(user: CurrentUser, db: DB, person_id: uuid.UUID | None = None) -> dict:
    q = select(Call).where(Call.user_id == user.id).order_by(Call.started_at.desc()).limit(100)
    if person_id:
        q = q.where(Call.person_id == person_id)
    rows = (await db.execute(q)).scalars().all()
    out = []
    for c in rows:
        p = await db.get(Person, c.person_id)
        s = await db.get(Scene, c.scene_id) if c.scene_id else None
        item = call_out(c, p)
        if s:
            loc = locations().get("locations", {}).get(s.location_key, {})
            item["place"] = loc.get("label", s.location_key)
            item["thumb"] = url(s.still_media_id)
        out.append(item)
    return {"calls": out}


@router.get("/calls/{cid}")
async def get_call(cid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    c = await db.get(Call, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Not found.")
    p = await db.get(Person, c.person_id)
    s = await db.get(Scene, c.scene_id) if c.scene_id else None
    turns = (await db.execute(select(CallTurn).where(CallTurn.call_id == cid).order_by(CallTurn.idx))).scalars().all()
    return {"call": call_out(c, p, s),
            "turns": [{"id": str(t.id), "role": t.role, "text": t.text, "audio_url": url(t.audio_media_id),
                       "timings": t.timings, "created_at": t.created_at} for t in turns]}


@router.delete("/calls/{cid}")
async def delete_call(cid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    c = await db.get(Call, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Not found.")
    turns = (await db.execute(select(CallTurn).where(CallTurn.call_id == cid))).scalars().all()
    kept = set((await db.execute(select(MemoryBoxItem.media_id).where(MemoryBoxItem.user_id == user.id,
                                                                      MemoryBoxItem.media_id.is_not(None)))).scalars())
    kept |= set((await db.execute(select(MemoryBoxItem.video_media_id).where(
        MemoryBoxItem.user_id == user.id, MemoryBoxItem.video_media_id.is_not(None)))).scalars())
    for t in turns:
        for mid in (t.audio_media_id, t.video_media_id):
            a = await db.get(MediaAsset, mid) if mid and mid not in kept else None
            if a:
                storage().delete(a.storage_key)
                await db.delete(a)
        await db.delete(t)
    await db.delete(c)
    await db.commit()
    return {"ok": True}


class ReflectionIn(BaseModel):
    reflection: str = Field(default="", max_length=4000)
    mood_after: int | None = Field(default=None, ge=1, le=5)


@router.post("/calls/{cid}/reflection")
async def reflection(cid: uuid.UUID, body: ReflectionIn, user: CurrentUser, db: DB) -> dict:
    c = await db.get(Call, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Not found.")
    if body.reflection.strip():
        c.reflection = body.reflection.strip()
    if body.mood_after:
        db.add(MoodCheck(user_id=user.id, call_id=cid, phase="after", score=body.mood_after))
    await db.commit()
    return {"ok": True}


class ReportIn(BaseModel):
    reason: str = Field(max_length=60)
    details: str = Field(default="", max_length=2000)


@router.post("/calls/{cid}/report")
async def report(cid: uuid.UUID, body: ReportIn, user: CurrentUser, db: DB) -> dict:
    c = await db.get(Call, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Not found.")
    db.add(Report(user_id=user.id, call_id=cid, person_id=c.person_id, reason=body.reason, details=body.details))
    await db.commit()
    return {"ok": True, "message": "Thank you. A person will look at this carefully."}


@router.websocket("/calls/{cid}/ws")
async def call_ws(ws: WebSocket, cid: uuid.UUID) -> None:
    origin = ws.headers.get("origin", "")
    if settings.is_prod and origin and origin.rstrip("/") != settings.public_url:
        await ws.close(code=4403)
        return
    claims = read_session_token(ws.cookies.get(SESSION_COOKIE, "") or "")
    if not claims:
        await ws.close(code=4401)
        return
    await ws.accept()
    session = CallSession(ws, cid, uuid.UUID(claims["sub"]))
    try:
        await session.run()
    except PermissionError:
        await ws.close(code=4403)
    except WebSocketDisconnect:
        await session.finish("disconnected")


# ------------------------------------------------------------------ memory box

class MemoryIn(BaseModel):
    person_id: uuid.UUID
    call_id: uuid.UUID | None = None
    turn_id: uuid.UUID | None = None
    text: str = Field(default="", max_length=2000)


@router.post("/memories")
async def save_memory(body: MemoryIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, body.person_id, user)
    media_id = None
    if body.turn_id:
        t = await db.get(CallTurn, body.turn_id)
        c = await db.get(Call, t.call_id) if t else None
        if t and c and c.user_id == user.id:
            media_id = t.audio_media_id
            if t.text and not body.text:
                body.text = t.text
    from ..providers import lipsync
    item = MemoryBoxItem(user_id=user.id, person_id=body.person_id, call_id=body.call_id, text=body.text,
                         media_id=media_id, video_status="making" if media_id and lipsync.available() else "")
    db.add(item)
    await db.commit()
    if item.video_status == "making":
        await jobs.enqueue("lipsync_memory", queue="gpu", user_id=user.id, person_id=body.person_id,
                           memory_id=str(item.id))
    return {"id": str(item.id), "video": item.video_status}


@router.get("/memories")
async def memories(user: CurrentUser, db: DB, person_id: uuid.UUID | None = None) -> dict:
    q = select(MemoryBoxItem).where(MemoryBoxItem.user_id == user.id).order_by(MemoryBoxItem.created_at.desc())
    if person_id:
        q = q.where(MemoryBoxItem.person_id == person_id)
    rows = (await db.execute(q)).scalars().all()
    names = {}
    out = []
    for m in rows:
        if m.person_id not in names:
            p = await db.get(Person, m.person_id)
            names[m.person_id] = p.name if p else ""
        out.append({"id": str(m.id), "person_id": str(m.person_id), "person_name": names[m.person_id],
                    "text": m.text, "audio_url": url(m.media_id), "created_at": m.created_at,
                    "video_url": url(m.video_media_id, 3600), "video_status": m.video_status,
                    "call_id": str(m.call_id) if m.call_id else None})
    return {"memories": out}


@router.delete("/memories/{mid}")
async def delete_memory(mid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    m = await db.get(MemoryBoxItem, mid)
    if not m or m.user_id != user.id:
        raise HTTPException(404, "Not found.")
    await db.delete(m)
    await db.commit()
    return {"ok": True}


@router.get("/memories/{mid}/download")
async def download_memory(mid: uuid.UUID, user: CurrentUser, db: DB) -> FileResponse:
    """Exports always carry a visible AI label (no clean voice audio exports)."""
    m = await db.get(MemoryBoxItem, mid)
    if not m or m.user_id != user.id or not m.media_id:
        raise HTTPException(404, "Not found.")
    vid = await db.get(MediaAsset, m.video_media_id) if m.video_media_id else None
    if vid and storage().exists(vid.storage_key):
        src = storage().to_temp(vid.storage_key, ".mp4")
        out = av.tmp(".mp4")
        await labelled_video(src, out)
        src.unlink(missing_ok=True)
        return FileResponse(out, media_type="video/mp4", filename="memory-ai-recreation.mp4",
                            background=BackgroundTask(lambda: out.unlink(missing_ok=True)))
    audio = await db.get(MediaAsset, m.media_id)
    if not audio or not storage().exists(audio.storage_key):
        raise HTTPException(404, "The audio for this memory is no longer available.")
    scene = None
    if m.call_id:
        c = await db.get(Call, m.call_id)
        scene = await db.get(Scene, c.scene_id) if c and c.scene_id else None
    a_tmp = storage().to_temp(audio.storage_key, ".mp3")
    s_tmp = None
    if scene and scene.still_media_id:
        st = await db.get(MediaAsset, scene.still_media_id)
        s_tmp = storage().to_temp(st.storage_key, ".png") if st else None
    out = av.tmp(".mp4")
    await labelled_clip(s_tmp, a_tmp, out)
    a_tmp.unlink(missing_ok=True)
    if s_tmp:
        s_tmp.unlink(missing_ok=True)
    return FileResponse(out, media_type="video/mp4", filename="memory-ai-recreation.mp4",
                        background=BackgroundTask(lambda: out.unlink(missing_ok=True)))


class MoodIn(BaseModel):
    score: int = Field(ge=1, le=5)
    phase: str = Field(default="before", pattern="^(before|after)$")
    call_id: uuid.UUID | None = None


@router.post("/mood")
async def mood(body: MoodIn, user: CurrentUser) -> dict:
    async with SessionLocal() as db:
        db.add(MoodCheck(user_id=user.id, call_id=body.call_id, phase=body.phase, score=body.score))
        await db.commit()
    return {"ok": True}
