"""Loved ones: create, consent, upload, faces, safety checks, anchors,
restoration, voice, persona and memory notes (brief 6.1–6.2)."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..config import settings
from ..deps import DB, CurrentUser, client_ip, person_for, rate_limit
from ..models import (Consent, FaceCluster, FaceDetection, FamilyMember, MediaAsset, MemoryNote, Person,
                      PersonaEditRequest, Scene, SpeakerClip, UploadSession, VoiceProfile)
from ..providers import tts
from ..providers.base import ProviderUnavailable
from ..services import faces, ingest, jobs
from ..services.assets import save_asset, url
from ..services.credits import InsufficientCredits, charge
from ..services.metering import BudgetExceeded
from ..services.pipeline import PREVIEW_LINES, recluster
from ..services.pricing import credit_cost
from ..services.safety import log_event
from ..storage import storage

router = APIRouter(prefix="/api", tags=["people"])
log = logging.getLogger("missyou.people")
CONSENT_VERSION = "2026-10-15"
MEDIA_CONSENT = [
    "I have the right to use these photos, videos and voice recordings.",
    "The person is (or was) an adult.",
    "I am their family member, partner or close friend.",
    "I understand this creates an AI recreation, not the real person, and it will always be labelled as AI.",
]


def person_out(p: Person, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": str(p.id), "name": p.name, "called_name": p.called_name, "relationship": p.relationship,
            "age": p.age, "gender": p.gender, "life_status": p.life_status, "call_language": p.call_language,
            "persona": p.persona, "status": p.status, "setup_step": p.setup_step, "refused_reason": p.refused_reason,
            "chosen_cluster_id": str(p.chosen_cluster_id) if p.chosen_cluster_id else None,
            "voice_profile_id": str(p.voice_profile_id) if p.voice_profile_id else None,
            "keep_raw_uploads": p.keep_raw_uploads, "closure": p.closure, "is_demo": p.is_demo,
            "owner_id": str(p.owner_id), "created_at": p.created_at, **(extra or {})}


async def cover_url(db: DB, p: Person) -> str | None:
    scene = (await db.execute(select(Scene).where(Scene.person_id == p.id, Scene.status == "ready")
                              .order_by(Scene.created_at.desc()))).scalars().first()
    if scene and scene.still_media_id:
        return url(scene.still_media_id)
    if p.chosen_cluster_id:
        c = await db.get(FaceCluster, p.chosen_cluster_id)
        if c and c.best_face_id:
            f = await db.get(FaceDetection, c.best_face_id)
            if f:
                return url(f.thumb_media_id)
    return None


# ------------------------------------------------------------------ persons

class PersonIn(BaseModel):
    name: str = Field(default="", max_length=120)
    called_name: str = Field(default="", max_length=120)
    relationship: str = Field(default="", max_length=80)
    age: int | None = Field(default=None, ge=0, le=120)
    gender: str = Field(default="", max_length=20)
    life_status: str = Field(default="passed", pattern="^(passed|far)$")
    call_language: str = Field(default="en", pattern="^(en|bn|hi)$")


@router.get("/people")
async def list_people(user: CurrentUser, db: DB) -> dict:
    own = (await db.execute(select(Person).where(Person.owner_id == user.id).order_by(Person.created_at))
           ).scalars().all()
    shared_ids = (await db.execute(select(FamilyMember.person_id).where(
        FamilyMember.user_id == user.id, FamilyMember.status == "active"))).scalars().all()
    shared = (await db.execute(select(Person).where(Person.id.in_(shared_ids)))).scalars().all() if shared_ids else []
    out = []
    for p in list(own) + list(shared):
        out.append(person_out(p, {"cover_url": await cover_url(db, p), "shared": p.owner_id != user.id}))
    return {"people": out}


@router.post("/people")
async def create_person(body: PersonIn, user: CurrentUser, db: DB) -> dict:
    count = (await db.execute(select(func.count()).select_from(Person).where(Person.owner_id == user.id))).scalar_one()
    if count >= 10:
        raise HTTPException(400, "You can keep up to 10 loved ones.")
    p = Person(owner_id=user.id, **body.model_dump(), persona={"languages": [body.call_language]})
    db.add(p)
    await db.commit()
    return {"person": person_out(p)}


@router.get("/people/{pid}")
async def get_person(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user)
    media = (await db.execute(select(MediaAsset.kind, func.count()).where(
        MediaAsset.person_id == pid, MediaAsset.kind.in_(["photo", "video", "audio"])).group_by(MediaAsset.kind))).all()
    vp = await db.get(VoiceProfile, p.voice_profile_id) if p.voice_profile_id else None
    consent = (await db.execute(select(Consent).where(Consent.person_id == pid, Consent.kind == "media_rights"))
               ).scalars().first()
    anchors = (await db.execute(select(func.count()).select_from(FaceDetection).where(
        FaceDetection.person_id == pid, FaceDetection.is_anchor.is_(True)))).scalar_one()
    return {"person": person_out(p, {
        "cover_url": await cover_url(db, p), "media_counts": {k: n for k, n in media},
        "voice": voice_out(vp) if vp else None, "consented": bool(consent), "anchor_count": anchors,
        "is_owner": p.owner_id == user.id})}


class PersonaPatch(BaseModel):
    name: str | None = None
    called_name: str | None = None
    relationship: str | None = None
    age: int | None = None
    gender: str | None = None
    life_status: str | None = Field(default=None, pattern="^(passed|far)$")
    call_language: str | None = Field(default=None, pattern="^(en|bn|hi)$")
    keep_raw_uploads: bool | None = None
    persona: dict[str, Any] | None = None


@router.patch("/people/{pid}")
async def patch_person(pid: uuid.UUID, body: PersonaPatch, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user)
    patch = body.model_dump(exclude_unset=True)
    if p.owner_id != user.id:  # family member: edits need the creator's approval (brief 9.3)
        db.add(PersonaEditRequest(person_id=p.id, requester_id=user.id, patch=patch))
        await db.commit()
        return {"pending_approval": True}
    apply_persona_patch(p, patch)
    if p.setup_step == "persona":
        p.setup_step = "scene"
    await db.commit()
    return {"person": person_out(p)}


def apply_persona_patch(p: Person, patch: dict[str, Any]) -> None:
    persona = patch.pop("persona", None)
    for k, v in patch.items():
        setattr(p, k, v)
    if persona is not None:
        merged = dict(p.persona or {})
        merged.update({k: v for k, v in persona.items() if k in (
            "speech_style", "phrases", "nicknames", "greeting", "goodbye", "humour", "topics_loved", "topics_avoid",
            "languages", "code_mix", "heaven_framing", "use_transcripts", "outfit_style", "places", "people")})
        if "callers" in persona:
            merged["callers"] = clean_callers(persona.get("callers"))
        p.persona = merged


def clean_callers(raw: Any) -> list[dict[str, str]]:
    """Family members who may call this loved one from the same account."""
    out: list[dict[str, str]] = []
    for c in (raw or [])[:10]:
        if not isinstance(c, dict) or not str(c.get("name") or "").strip():
            continue
        out.append({k: str(c.get(k) or "").strip()[:80] for k in ("name", "relation", "nickname", "calls_them")}
                   | {"notes": str(c.get("notes") or "").strip()[:1000],
                      "id": str(c.get("id") or uuid.uuid4().hex[:10])[:20]})
    return out


@router.delete("/people/{pid}")
async def delete_person(pid: uuid.UUID, user: CurrentUser, db: DB, confirm: str = "") -> dict:
    from ..services.privacy import delete_person as do_delete
    p = await person_for(db, pid, user, owner_only=True)
    if confirm.strip().lower() != (p.name or "delete").strip().lower() and confirm != "DELETE":
        raise HTTPException(400, "Please type their name (or DELETE) to confirm.")
    report = await do_delete(db, p, user.id)
    await db.commit()
    return {"deleted": True, "report": report}


@router.post("/people/{pid}/archive")
async def archive_person(pid: uuid.UUID, user: CurrentUser, db: DB, archived: bool = True) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    p.status = "archived" if archived else ("ready" if p.voice_profile_id else "draft")
    await db.commit()
    return {"person": person_out(p)}


# ------------------------------------------------------------------ consent

class ConsentIn(BaseModel):
    statements: list[str]


@router.get("/consent/media")
async def consent_text() -> dict:
    return {"version": CONSENT_VERSION, "statements": MEDIA_CONSENT}


@router.post("/people/{pid}/consent")
async def give_consent(pid: uuid.UUID, body: ConsentIn, request: Request, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    if sorted(body.statements) != sorted(MEDIA_CONSENT):
        raise HTTPException(400, "Please confirm every statement.")
    db.add(Consent(user_id=user.id, person_id=p.id, kind="media_rights", version=CONSENT_VERSION,
                   statements=body.statements, ip=client_ip(request),
                   user_agent=request.headers.get("user-agent", "")[:400]))
    await db.commit()
    return {"ok": True}


async def _require_consent(db: DB, pid: uuid.UUID) -> None:
    c = (await db.execute(select(Consent.id).where(Consent.person_id == pid, Consent.kind == "media_rights"))).first()
    if not c:
        raise HTTPException(403, "consent_required")


# ------------------------------------------------------------------ uploads

class UploadInit(BaseModel):
    filename: str = Field(max_length=255)
    size: int = Field(gt=0)
    purpose: str = Field(default="memory", pattern="^(memory|place_photo)$")


def _limit_for(filename: str) -> int:
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext in ("mp4", "mov", "webm", "mkv", "3gp", "m4v"):
        return settings.max_video_mb
    if ext in ("mp3", "wav", "m4a", "ogg", "opus", "aac", "flac"):
        return settings.max_audio_mb
    return settings.max_photo_mb


def _part(sess_id: uuid.UUID) -> Path:
    d = settings.storage_dir / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{sess_id}.part"


@router.post("/people/{pid}/uploads")
async def upload_init(pid: uuid.UUID, body: UploadInit, request: Request, user: CurrentUser, db: DB) -> dict:
    await rate_limit(request, f"upload:{user.id}", 300, 3600)
    p = await person_for(db, pid, user, owner_only=True)
    await _require_consent(db, p.id)
    limit = _limit_for(body.filename)
    if body.size > limit * 1024 * 1024:
        raise HTTPException(413, f"That file is larger than {limit} MB.")
    s = UploadSession(owner_id=user.id, person_id=p.id, filename=body.filename, declared_size=body.size,
                      purpose=body.purpose)
    db.add(s)
    await db.commit()
    _part(s.id).write_bytes(b"")
    return {"upload_id": str(s.id), "chunk_size": settings.upload_chunk_mb * 1024 * 1024, "received": 0}


@router.get("/uploads/{sid}")
async def upload_status(sid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    s = await db.get(UploadSession, sid)
    if not s or s.owner_id != user.id:
        raise HTTPException(404, "Not found.")
    return {"upload_id": str(s.id), "received": s.received, "status": s.status}


@router.put("/uploads/{sid}")
async def upload_chunk(sid: uuid.UUID, request: Request, user: CurrentUser, db: DB, offset: int = 0) -> dict:
    s = await db.get(UploadSession, sid)
    if not s or s.owner_id != user.id or s.status != "open":
        raise HTTPException(404, "Not found.")
    if offset != s.received:
        return {"received": s.received, "resync": True}
    data = await request.body()
    if len(data) > settings.upload_chunk_mb * 1024 * 1024 + 1024:
        raise HTTPException(413, "Chunk too large.")
    if s.received + len(data) > s.declared_size:
        raise HTTPException(400, "More data than declared.")
    with open(_part(sid), "ab") as f:
        f.write(data)
    s.received += len(data)
    await db.commit()
    return {"received": s.received}


@router.post("/uploads/{sid}/complete")
async def upload_complete(sid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    s = await db.get(UploadSession, sid)
    if not s or s.owner_id != user.id or s.status != "open":
        raise HTTPException(404, "Not found.")
    if s.received != s.declared_size:
        raise HTTPException(400, "Upload incomplete.")
    part = _part(sid)
    try:
        try:
            asset = await ingest_path(db, user.id, s.person_id, part, s.filename, s.purpose)
        except ingest.RejectedUpload as e:
            s.status = "rejected"
            await db.commit()
            raise HTTPException(415, str(e))
        s.status, s.media_id = "done", asset.id
        await db.commit()
        return {"media": media_out(asset)}
    finally:
        part.unlink(missing_ok=True)


async def ingest_path(db: DB, owner_id: uuid.UUID, person_id: uuid.UUID, src: Path, filename: str,
                      purpose: str = "memory", meta: dict[str, Any] | None = None) -> MediaAsset:
    """Validate by magic bytes, strip metadata, normalise and store encrypted."""
    from ..services import av
    sn = ingest.sniff(src, filename)
    if purpose == "place_photo" and sn.kind != "photo":
        raise ingest.RejectedUpload("Please choose a photo of the place.")
    out = storage().scratch_dir() / f"in_{uuid.uuid4().hex}"
    kw: dict[str, Any] = {}
    if sn.kind == "photo":
        dest = out.with_suffix(".jpg")
        w, h = await asyncio.to_thread(ingest.normalise_photo, src, dest)
        mime, kw = "image/jpeg", {"width": w, "height": h}
    elif sn.kind == "video":
        dest = out.with_suffix(".mp4")
        await ingest.normalise_video(src, dest)
        mime, kw = "video/mp4", {"duration_s": await av.duration(dest)}
    else:
        dest = out.with_suffix(".mp3")
        await ingest.normalise_audio(src, dest)
        mime, kw = "audio/mpeg", {"duration_s": await av.duration(dest)}
    kind = "place_photo" if purpose == "place_photo" else sn.kind
    try:
        return await save_asset(db, owner_id=owner_id, person_id=person_id, kind=kind, mime=mime, path=dest,
                                original_name=filename, meta={"exif_stripped": True, **(meta or {})}, **kw)
    finally:
        dest.unlink(missing_ok=True)


def sample_kit_dir() -> Path:
    return settings.config_dir / "sample_kit"


@router.get("/sample-kit")
async def sample_kit() -> dict:
    d = sample_kit_dir()
    files = sorted(p.name for p in d.glob("*") if p.suffix.lower() in (".jpg", ".png", ".mp4", ".mp3")) if d.is_dir() else []
    return {"available": bool(files), "files": files,
            "note": "A fictional family — every face and voice in it is AI-generated. No real people."}


@router.post("/people/{pid}/sample-kit")
async def use_sample_kit(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    """Add the fictional sample family (AI-generated) so the whole flow can be tried without personal files."""
    p = await person_for(db, pid, user, owner_only=True)
    await _require_consent(db, p.id)
    d = sample_kit_dir()
    files = sorted(x for x in d.glob("*") if x.suffix.lower() in (".jpg", ".png", ".mp4", ".mp3")) if d.is_dir() else []
    if not files:
        raise HTTPException(404, "The sample memories aren't available on this server.")
    have = {a.original_name for a in (await db.execute(select(MediaAsset).where(MediaAsset.person_id == pid))).scalars()}
    out = []
    for f in files:
        if f.name in have:
            continue
        a = await ingest_path(db, user.id, pid, f, f.name, meta={"sample_kit": True})
        out.append(media_out(a))
    await db.commit()
    return {"media": out}


def media_out(a: MediaAsset) -> dict[str, Any]:
    return {"id": str(a.id), "kind": a.kind, "mime": a.mime, "size": a.size, "name": a.original_name,
            "width": a.width, "height": a.height, "duration_s": a.duration_s, "url": url(a.id),
            "created_at": a.created_at, "processed": bool((a.meta or {}).get("faces_done"))}


@router.get("/people/{pid}/media")
async def list_media(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    rows = (await db.execute(select(MediaAsset).where(
        MediaAsset.person_id == pid, MediaAsset.kind.in_(["photo", "video", "audio", "place_photo"]))
        .order_by(MediaAsset.created_at))).scalars().all()
    return {"media": [media_out(a) for a in rows]}


@router.delete("/people/{pid}/media/{mid}")
async def delete_media(pid: uuid.UUID, mid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    a = await db.get(MediaAsset, mid)
    if not a or a.person_id != pid:
        raise HTTPException(404, "Not found.")
    dets = (await db.execute(select(FaceDetection).where(FaceDetection.media_id == mid))).scalars().all()
    for d in dets:
        await db.delete(d)
    storage().delete(a.storage_key)
    await db.delete(a)
    await db.commit()
    return {"ok": True}


class ReplacePhotosIn(BaseModel):
    keep_media_ids: list[uuid.UUID] = Field(min_length=1)
    remove_old: bool = True


@router.post("/people/{pid}/photos/replace")
async def replace_photos(pid: uuid.UUID, body: ReplacePhotosIn, user: CurrentUser, db: DB) -> dict:
    """Change their picture: optionally drop old photos (videos and voice stay), regroup faces.

    Faces from remaining media are re-clustered; the user then picks which face is them again
    (minor / public-figure checks run on that choice) and may recreate their scenes."""
    p = await person_for(db, pid, user, owner_only=True)
    keep = set(body.keep_media_ids)
    new = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(keep), MediaAsset.person_id == pid,
                                                     MediaAsset.kind == "photo"))).scalars().all()
    if not new:
        raise HTTPException(400, "Please upload at least one photo.")
    removed = 0
    if body.remove_old:
        old = (await db.execute(select(MediaAsset).where(MediaAsset.person_id == pid, MediaAsset.kind == "photo",
                                                         MediaAsset.id.not_in(keep)))).scalars().all()
        for a in old:
            for d in (await db.execute(select(FaceDetection).where(FaceDetection.media_id == a.id))).scalars():
                for mid in (d.thumb_media_id, d.crop_media_id, d.restored_media_id):
                    fa = await db.get(MediaAsset, mid) if mid else None
                    if fa:
                        storage().delete(fa.storage_key)
                        await db.delete(fa)
                await db.delete(d)
            storage().delete(a.storage_key)
            await db.delete(a)
            removed += 1
    for d in (await db.execute(select(FaceDetection).where(FaceDetection.person_id == pid))).scalars():
        d.is_anchor = False
    p.chosen_cluster_id = None
    await db.commit()
    job = await jobs.enqueue("process_person", queue="cpu", user_id=user.id, person_id=pid)
    return {"job_id": str(job.id), "removed_photos": removed}


@router.post("/people/{pid}/process")
async def process(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    n = (await db.execute(select(func.count()).select_from(MediaAsset).where(
        MediaAsset.person_id == pid, MediaAsset.kind.in_(["photo", "video"])))).scalar_one()
    if n == 0:
        raise HTTPException(400, "Please add at least one photo or video.")
    p.status = "processing"
    await db.commit()
    job = await jobs.enqueue("process_person", queue="cpu", user_id=user.id, person_id=pid)
    return {"job_id": str(job.id)}


# ------------------------------------------------------------------ faces

@router.get("/people/{pid}/clusters")
async def clusters(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    cs = (await db.execute(select(FaceCluster).where(FaceCluster.person_id == pid).order_by(FaceCluster.label))
          ).scalars().all()
    out = []
    for c in cs:
        members = (await db.execute(select(FaceDetection).where(FaceDetection.cluster_id == c.id)
                                    .order_by(FaceDetection.quality.desc()).limit(12))).scalars().all()
        best = next((m for m in members if m.id == c.best_face_id), members[0] if members else None)
        out.append({"id": str(c.id), "size": c.size, "label": c.label,
                    "best": url(best.thumb_media_id) if best else None,
                    "faces": [{"id": str(m.id), "thumb": url(m.thumb_media_id), "quality": m.quality}
                              for m in members]})
    return {"clusters": out}


class MergeIn(BaseModel):
    cluster_ids: list[uuid.UUID] = Field(min_length=2)


@router.post("/people/{pid}/clusters/merge")
async def merge_clusters(pid: uuid.UUID, body: MergeIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    target = body.cluster_ids[0]
    dets = (await db.execute(select(FaceDetection).where(FaceDetection.cluster_id.in_(body.cluster_ids)))
            ).scalars().all()
    if not dets:
        raise HTTPException(404, "Not found.")
    for d in dets:
        d.cluster_id = target
    for cid in body.cluster_ids[1:]:
        c = await db.get(FaceCluster, cid)
        if c and c.person_id == pid:
            await db.delete(c)
    await db.flush()
    await _refresh_cluster(db, target)
    await db.commit()
    return {"ok": True}


class SplitIn(BaseModel):
    face_ids: list[uuid.UUID] = Field(min_length=1)


@router.post("/people/{pid}/clusters/{cid}/split")
async def split_cluster(pid: uuid.UUID, cid: uuid.UUID, body: SplitIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    src = await db.get(FaceCluster, cid)
    if not src or src.person_id != pid:
        raise HTTPException(404, "Not found.")
    maxlabel = (await db.execute(select(func.max(FaceCluster.label)).where(FaceCluster.person_id == pid))).scalar_one()
    new = FaceCluster(person_id=pid, label=(maxlabel or 0) + 1)
    db.add(new)
    await db.flush()
    for fid in body.face_ids:
        d = await db.get(FaceDetection, fid)
        if d and d.cluster_id == cid:
            d.cluster_id = new.id
    await db.flush()
    await _refresh_cluster(db, cid)
    await _refresh_cluster(db, new.id)
    await db.commit()
    return {"ok": True, "new_cluster_id": str(new.id)}


async def _refresh_cluster(db: DB, cid: uuid.UUID) -> None:
    c = await db.get(FaceCluster, cid)
    if not c:
        return
    dets = (await db.execute(select(FaceDetection).where(FaceDetection.cluster_id == cid))).scalars().all()
    if not dets:
        await db.delete(c)
        return
    c.size = len(dets)
    c.best_face_id = max(dets, key=lambda d: d.quality).id
    c.centroid = faces.centroid([np.asarray(d.embedding, dtype=np.float32) for d in dets]).tolist()
    ages = [d.age for d in dets if d.age]
    c.median_age = float(np.median(ages)) if ages else None


@router.post("/people/{pid}/recluster")
async def do_recluster(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    n = await recluster(db, p)
    await db.commit()
    return {"clusters": n}


class ChooseIn(BaseModel):
    cluster_id: uuid.UUID


REFUSAL_TEXT = {
    "minor": "This looks like it may be a child. To protect children, Miss You only recreates adults, so we can't "
             "create this profile. We're so sorry — if you're grieving a child, please consider reaching out to a "
             "grief counsellor; you don't have to carry this alone.",
    "public_figure": "This looks like a well-known public figure. Miss You only recreates private people you knew "
                     "personally, so we can't create this profile.",
}


@router.post("/people/{pid}/choose")
async def choose_face(pid: uuid.UUID, body: ChooseIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    c = await db.get(FaceCluster, body.cluster_id)
    if not c or c.person_id != pid:
        raise HTTPException(404, "Not found.")
    dets = (await db.execute(select(FaceDetection).where(FaceDetection.cluster_id == c.id)
                             .order_by(FaceDetection.quality.desc()))).scalars().all()
    # Safety (brief 6.2.4): two independent signals, refuse if either says "minor".
    #   1. InsightFace median estimated age of the cluster
    #   2. vision-LLM apparent age on the best crops (InsightFace under-estimates youth badly)
    # and public figures via local reference embeddings, then the same vision check.
    crops: list[bytes] = []
    for d in dets[:3]:
        crop = await db.get(MediaAsset, d.crop_media_id) if d.crop_media_id else None
        if crop:
            crops.append(storage().read_all(crop.storage_key))
    centroid = np.asarray(c.centroid, dtype=np.float32)
    ref_hit = faces.matches_reference_figure(centroid)
    check = await faces.llm_face_check(crops, user.id) if crops else {"unavailable": True}
    log.info("face safety check: famous=%s conf=%s age=%s minor=%s crops=%d", check.get("famous"),
             check.get("confidence"), check.get("apparent_age"), check.get("looks_under_18"), len(crops))
    minor_detector = "insightface" if faces.is_minor([d.age for d in dets if d.age]) else \
        "vision_llm" if faces.llm_says_minor(check) else None
    if minor_detector:
        p.status, p.refused_reason = "refused", "minor"
        await db.commit()
        await log_event("minor_refused", user_id=user.id, person_id=p.id, category="age", detector=minor_detector)
        return {"refused": True, "reason": "minor", "message": REFUSAL_TEXT["minor"]}
    famous = {"famous": True, "confidence": 1.0} if ref_hit else check
    if not famous.get("famous") and crops and not check.get("unavailable"):
        second = await faces.llm_public_figure_only(crops, user.id)
        if second.get("famous"):
            famous = second
    if famous.get("famous") and float(famous.get("confidence") or 0) >= 0.75:
        p.status, p.refused_reason = "refused", "public_figure"
        await db.commit()
        await log_event("public_figure_refused", user_id=user.id, person_id=p.id,
                        category=str(famous.get("category") or "")[:40],
                        detector="reference" if ref_hit else "vision_llm")
        return {"refused": True, "reason": "public_figure", "message": REFUSAL_TEXT["public_figure"]}
    # Anchors: best frontal / sharp / well-lit faces, one per source media.
    for d in (await db.execute(select(FaceDetection).where(FaceDetection.person_id == pid))).scalars():
        d.is_anchor = False
    seen: set[uuid.UUID] = set()
    chosen = 0
    for d in dets:
        if d.media_id in seen:
            continue
        d.is_anchor = True
        seen.add(d.media_id)
        chosen += 1
        if chosen >= 4:
            break
    p.chosen_cluster_id = c.id
    already_set_up = p.setup_step in ("voice", "persona", "scene", "done")
    p.status, p.refused_reason = ("ready" if p.setup_step == "done" else "draft"), None
    if not already_set_up:
        p.setup_step = "anchors"
    if not p.gender and c.gender:
        p.gender = {"m": "male", "f": "female"}.get(c.gender, "")
    if not p.age and c.median_age:
        p.age = int(round(c.median_age))
    await db.commit()
    return {"refused": False, "safety_check": "unavailable" if check.get("unavailable") else "passed",
            "estimated_age": round(c.median_age) if c.median_age else None}


@router.get("/people/{pid}/anchors")
async def anchors(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    if not p.chosen_cluster_id:
        return {"faces": []}
    dets = (await db.execute(select(FaceDetection).where(FaceDetection.cluster_id == p.chosen_cluster_id)
                             .order_by(FaceDetection.quality.desc()).limit(16))).scalars().all()
    return {"faces": [{"id": str(d.id), "thumb": url(d.thumb_media_id), "crop": url(d.crop_media_id),
                       "quality": d.quality, "is_anchor": d.is_anchor,
                       "restored": url(d.restored_media_id), "use_restored": d.use_restored} for d in dets]}


class AnchorsIn(BaseModel):
    face_ids: list[uuid.UUID] = Field(min_length=1, max_length=5)


@router.post("/people/{pid}/anchors")
async def set_anchors(pid: uuid.UUID, body: AnchorsIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    ids = set(body.face_ids)
    for d in (await db.execute(select(FaceDetection).where(FaceDetection.person_id == pid))).scalars():
        d.is_anchor = d.id in ids and d.cluster_id == p.chosen_cluster_id
    if p.setup_step == "anchors":
        p.setup_step = "voice"
    await db.commit()
    return {"ok": True}


@router.post("/people/{pid}/faces/{fid}/restore")
async def restore(pid: uuid.UUID, fid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    d = await db.get(FaceDetection, fid)
    if not d or d.person_id != pid or not d.crop_media_id:
        raise HTTPException(404, "Not found.")
    crop = await db.get(MediaAsset, d.crop_media_id)
    src = storage().to_temp(crop.storage_key, ".jpg")
    dest = src.with_name(src.stem + "_r.jpg")
    try:
        await asyncio.to_thread(faces.restore_basic, src, dest)
        a = await save_asset(db, owner_id=p.owner_id, person_id=pid, kind="restored", mime="image/jpeg", path=dest,
                             meta={"method": "local-opencv"})
        d.restored_media_id = a.id
        await db.commit()
    finally:
        src.unlink(missing_ok=True)
        dest.unlink(missing_ok=True)
    return {"before": url(d.crop_media_id), "after": url(a.id), "method": "basic (local)",
            "note": "Advanced AI restoration (GFPGAN/CodeFormer) needs a GPU worker, which isn't connected yet."}


class UseRestoredIn(BaseModel):
    use: bool


@router.post("/people/{pid}/faces/{fid}/use_restored")
async def use_restored(pid: uuid.UUID, fid: uuid.UUID, body: UseRestoredIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    d = await db.get(FaceDetection, fid)
    if not d or d.person_id != pid:
        raise HTTPException(404, "Not found.")
    d.use_restored = body.use and bool(d.restored_media_id)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ voice

def voice_out(v: VoiceProfile) -> dict[str, Any]:
    return {"id": str(v.id), "kind": v.kind, "provider": v.provider, "engine": v.engine, "label": v.label,
            "language": v.language, "rating": v.rating, "preview_url": url(v.preview_media_id),
            "voice_id": v.provider_voice_id if v.kind != "clone" else None, "created_at": v.created_at}


@router.get("/people/{pid}/clips")
async def clips(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    rows = (await db.execute(select(SpeakerClip).where(SpeakerClip.person_id == pid)
                             .order_by(SpeakerClip.speaker_label, SpeakerClip.start_s))).scalars().all()
    groups: dict[int, list[dict[str, Any]]] = {}
    for c in rows:
        groups.setdefault(c.speaker_label, []).append({
            "id": str(c.id), "url": url(c.clip_media_id), "start": c.start_s, "end": c.end_s,
            "duration": round(c.end_s - c.start_s, 1), "transcript": c.transcript, "language": c.language,
            "confirmed": c.confirmed})
    return {"speakers": [{"label": k, "clips": v} for k, v in sorted(groups.items())]}


class ConfirmIn(BaseModel):
    clip_ids: list[uuid.UUID]


@router.post("/people/{pid}/clips/confirm")
async def confirm_clips(pid: uuid.UUID, body: ConfirmIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    ids = set(body.clip_ids)
    for c in (await db.execute(select(SpeakerClip).where(SpeakerClip.person_id == pid))).scalars():
        c.confirmed = c.id in ids
    await db.commit()
    return {"confirmed": len(ids)}


class BuildVoiceIn(BaseModel):
    engine: str | None = Field(default=None, pattern="^(fish|voicebox|sarvam_clone)$")


@router.post("/people/{pid}/voice/build")
async def build_voice(pid: uuid.UUID, body: BuildVoiceIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    n = (await db.execute(select(func.count()).select_from(SpeakerClip).where(
        SpeakerClip.person_id == pid, SpeakerClip.confirmed.is_(True)))).scalar_one()
    if not n:
        raise HTTPException(400, "Please confirm at least one clip of their voice.")
    try:
        await charge(db, user, "voice_clone", f"voice:{pid}:{uuid.uuid4().hex[:6]}")
    except InsufficientCredits as e:
        raise HTTPException(402, {"code": "insufficient_credits", "needed": e.needed, "balance": e.balance})
    await db.commit()
    job = await jobs.enqueue("build_voice", queue="cpu", user_id=user.id, person_id=pid, engine=body.engine or "")
    return {"job_id": str(job.id)}


@router.get("/people/{pid}/voices")
async def voices(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    rows = (await db.execute(select(VoiceProfile).where(VoiceProfile.person_id == pid)
                             .order_by(VoiceProfile.created_at.desc()))).scalars().all()
    engines = [{"engine": e, "available": tts.engine_available(e),
                "supports_language": tts.engine_supports(e, p.call_language)} for e in ("fish", "voicebox", "sarvam_clone")]
    return {"voices": [voice_out(v) for v in rows], "selected": str(p.voice_profile_id) if p.voice_profile_id else None,
            "clone_engines": engines}


class RateIn(BaseModel):
    rating: int = Field(ge=1, le=5)


@router.post("/people/{pid}/voices/{vid}/rate")
async def rate_voice(pid: uuid.UUID, vid: uuid.UUID, body: RateIn, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    v = await db.get(VoiceProfile, vid)
    if not v or v.person_id != pid:
        raise HTTPException(404, "Not found.")
    v.rating = body.rating
    await db.commit()
    return {"ok": True}


@router.post("/people/{pid}/voices/{vid}/select")
async def select_voice(pid: uuid.UUID, vid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    v = await db.get(VoiceProfile, vid)
    if not v or v.person_id != pid:
        raise HTTPException(404, "Not found.")
    p.voice_profile_id = v.id
    if p.setup_step in ("voice", "anchors"):
        p.setup_step = "persona"
    await db.commit()
    return {"ok": True}


def presets() -> list[dict[str, Any]]:
    path = settings.config_dir / "preset_voices.yaml"
    return list((yaml.safe_load(path.read_text()) or {}).get("presets", [])) if path.exists() else []


@router.get("/voices/presets")
async def list_presets(gender: str = "", age: str = "", language: str = "en") -> dict:
    out = [v for v in presets() if (not gender or v.get("gender") == gender) and (not age or age in v.get("ages", []))
           and language in v.get("languages", ["en"]) and tts.engine_available(v.get("engine", ""))]
    return {"presets": out[:8], "design_available": tts.engine_available("openai")}


async def _audition(db: DB, owner: uuid.UUID, engine: str, voice_id: str, lang: str, gender: str,
                    instructions: str = "") -> uuid.UUID:
    """Synthesise (and cache) a preset audition clip; returns its media id."""
    key = hashlib.sha256(f"{engine}:{voice_id}:{lang}:{instructions}".encode()).hexdigest()[:24]
    cached = (await db.execute(select(MediaAsset).where(MediaAsset.kind == "audition",
                                                        MediaAsset.sha256 == key))).scalars().first()
    if cached:
        return cached.id
    res = await tts.synthesize(PREVIEW_LINES.get(lang, PREVIEW_LINES["en"]), lang,
                               tts.Voice(engine=engine, voice_id=voice_id, gender=gender, instructions=instructions),
                               user_id=owner, feature="voice_audition", only_engine=engine)
    a = await save_asset(db, owner_id=owner, person_id=None, kind="audition", mime=res.mime, data=res.audio,
                         ai_generated=True)
    a.sha256 = key
    await db.commit()
    return a.id


class AuditionIn(BaseModel):
    preset_id: str


@router.post("/people/{pid}/voices/audition")
async def audition(pid: uuid.UUID, body: AuditionIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    v = next((x for x in presets() if x["id"] == body.preset_id), None)
    if not v:
        raise HTTPException(404, "Not found.")
    try:
        return {"url": url(await _audition(db, user.id, v["engine"], v["voice_id"], p.call_language, v["gender"]))}
    except (ProviderUnavailable, BudgetExceeded):
        raise HTTPException(503, "Voice previews are unavailable right now.")


class ChoosePresetIn(BaseModel):
    preset_id: str


@router.post("/people/{pid}/voices/preset")
async def choose_preset(pid: uuid.UUID, body: ChoosePresetIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user, owner_only=True)
    v = next((x for x in presets() if x["id"] == body.preset_id), None)
    if not v:
        raise HTTPException(404, "Not found.")
    try:
        prev = await _audition(db, user.id, v["engine"], v["voice_id"], p.call_language, v["gender"])
    except (ProviderUnavailable, BudgetExceeded):
        prev = None
    vp = VoiceProfile(person_id=pid, kind="preset", provider=v["engine"], engine=v["engine"],
                      provider_voice_id=v["voice_id"], language=p.call_language, label=v["label"],
                      meta={"gender": v["gender"], "preset_id": v["id"]}, preview_media_id=prev)
    db.add(vp)
    if p.setup_step in ("voice", "anchors"):
        p.setup_step = "persona"
    await db.flush()
    p.voice_profile_id = vp.id
    await db.commit()
    return {"voice": voice_out(vp)}


class DesignIn(BaseModel):
    description: str = Field(min_length=5, max_length=400)
    gender: str = Field(default="f", pattern="^(f|m)$")


@router.post("/people/{pid}/voices/design")
async def design_voice(pid: uuid.UUID, body: DesignIn, user: CurrentUser, db: DB) -> dict:
    """'Describe their voice' — a preset base voice steered by a description (OpenAI gpt-4o-mini-tts)."""
    p = await person_for(db, pid, user, owner_only=True)
    if not tts.engine_available("openai"):
        raise HTTPException(503, "Voice design isn't available on this deployment.")
    base = tts.preset_for("openai", body.gender, p.call_language) or ("coral" if body.gender == "f" else "ash")
    instr = f"Voice character: {body.description.strip()}"
    try:
        preview = await _audition(db, user.id, "openai", base, p.call_language, body.gender, instr)
    except (ProviderUnavailable, BudgetExceeded):
        raise HTTPException(503, "Voice previews are unavailable right now.")
    vp = VoiceProfile(person_id=pid, kind="designed", provider="openai", engine="openai", provider_voice_id=base,
                      language=p.call_language, label="Described voice",
                      meta={"gender": body.gender, "instructions": instr}, preview_media_id=preview)
    db.add(vp)
    await db.commit()
    return {"voice": voice_out(vp)}


# ------------------------------------------------------------------ memory notes

class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    pinned: bool = False


@router.get("/people/{pid}/notes")
async def notes(pid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user)
    rows = (await db.execute(select(MemoryNote).where(MemoryNote.person_id == pid)
                             .order_by(MemoryNote.pinned.desc(), MemoryNote.created_at.desc()))).scalars().all()
    return {"notes": [{"id": str(n.id), "text": n.text, "source": n.source, "pinned": n.pinned,
                       "created_at": n.created_at} for n in rows]}


@router.post("/people/{pid}/notes")
async def add_note(pid: uuid.UUID, body: NoteIn, user: CurrentUser, db: DB) -> dict:
    p = await person_for(db, pid, user)
    if p.owner_id != user.id:
        db.add(PersonaEditRequest(person_id=p.id, requester_id=user.id, patch={"add_note": body.text}))
        await db.commit()
        return {"pending_approval": True}
    n = MemoryNote(person_id=pid, author_id=user.id, text=body.text.strip(), pinned=body.pinned)
    db.add(n)
    await db.commit()
    return {"id": str(n.id)}


@router.delete("/people/{pid}/notes/{nid}")
async def delete_note(pid: uuid.UUID, nid: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    await person_for(db, pid, user, owner_only=True)
    n = await db.get(MemoryNote, nid)
    if not n or n.person_id != pid:
        raise HTTPException(404, "Not found.")
    await db.delete(n)
    await db.commit()
    return {"ok": True}


@router.get("/pricing/actions")
async def action_costs() -> dict:
    return {"costs": {k: credit_cost(k) for k in ("voice_clone", "scene_generation", "call_minute",
                                                  "interview_minute", "letter")}}
