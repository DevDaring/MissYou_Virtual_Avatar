"""Data export and hard delete (brief 8), with a report of what was deleted where."""
from __future__ import annotations

import json
import logging
import uuid
import zipfile
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (Call, CallTurn, DeletionReport, Letter, MediaAsset, MemoryBoxItem, MemoryNote, Person, User,
                      VoiceProfile)
from ..providers import fish, voicebox
from ..storage import storage
from . import av

log = logging.getLogger("missyou.privacy")
LABEL_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

PROVIDER_NOTES = {
    "sarvam": "Reference clips are sent per request (no saved voice is created at Sarvam), so there is nothing to "
              "delete via API; Sarvam's own data-retention policy applies to past requests.",
    "xai": "Images were sent per request for scene generation; xAI offers no per-request deletion API. Generated "
           "files are fetched once and kept only in our encrypted storage.",
    "openai": "Text/audio sent for replies, transcription and moderation; OpenAI API data is not used for training "
              "by default and has no per-request deletion API.",
}


async def _delete_assets(db: AsyncSession, q: Any) -> tuple[int, int]:
    assets = (await db.execute(q)).scalars().all()
    files = 0
    for a in assets:
        if storage().delete(a.storage_key):
            files += 1
        await db.delete(a)
    return len(assets), files


async def delete_person(db: AsyncSession, person: Person, actor: uuid.UUID | None) -> dict[str, Any]:
    report: dict[str, Any] = {"person_id": str(person.id), "name": person.name, "local": {}, "providers": {},
                              "could_not_delete": []}
    vps = (await db.execute(select(VoiceProfile).where(VoiceProfile.person_id == person.id))).scalars().all()
    for vp in vps:
        if vp.provider == "voicebox" and vp.provider_voice_id:
            ok = await voicebox.delete_profile(vp.provider_voice_id)
            report["providers"].setdefault("voicebox", []).append(
                {"profile": vp.provider_voice_id, "deleted": ok})
            if not ok:
                report["could_not_delete"].append(f"voicebox profile {vp.provider_voice_id}")
        if vp.provider == "fish" and vp.provider_voice_id:
            ok = await fish.delete_voice(vp.provider_voice_id)
            report["providers"].setdefault("fish_audio", []).append({"voice": vp.provider_voice_id, "deleted": ok})
            if not ok:
                report["could_not_delete"].append(f"Fish Audio voice {vp.provider_voice_id}")
    used = {vp.provider for vp in vps} | {"xai", "openai"}
    for p in sorted(used):
        if p in PROVIDER_NOTES:
            report["providers"][p] = PROVIDER_NOTES[p]
    n, files = await _delete_assets(db, select(MediaAsset).where(MediaAsset.person_id == person.id))
    report["local"]["media_records"], report["local"]["encrypted_files"] = n, files
    for model, label in ((MemoryNote, "memory_notes"), (MemoryBoxItem, "memory_box_items"), (Letter, "letters")):
        res = await db.execute(delete(model).where(model.person_id == person.id))
        report["local"][label] = res.rowcount
    calls = (await db.execute(select(Call.id).where(Call.person_id == person.id))).scalars().all()
    report["local"]["calls"] = len(calls)
    if calls:
        res = await db.execute(delete(CallTurn).where(CallTurn.call_id.in_(calls)))
        report["local"]["call_turns"] = res.rowcount
    await db.delete(person)
    report["local"]["person_profile"] = 1
    db.add(DeletionReport(user_id=actor, scope="person", target_id=str(person.id), report=report))
    return report


async def delete_account(db: AsyncSession, user: User) -> dict[str, Any]:
    persons = (await db.execute(select(Person).where(Person.owner_id == user.id))).scalars().all()
    report: dict[str, Any] = {"user_id": str(user.id), "persons": []}
    for p in persons:
        report["persons"].append(await delete_person(db, p, None))
    n, files = await _delete_assets(db, select(MediaAsset).where(MediaAsset.owner_id == user.id))
    report["other_media"] = {"records": n, "files": files}
    await db.delete(user)
    db.add(DeletionReport(user_id=None, scope="account", target_id=str(user.id), report=report))
    return report


async def export_zip(db: AsyncSession, user: User, dest: Path) -> Path:
    persons = (await db.execute(select(Person).where(Person.owner_id == user.id))).scalars().all()
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.txt", "Your Miss You data export.\nuploads/ are your own files. Anything under "
                                 "generated/ is an AI-generated recreation and is labelled as such.\n")
        z.writestr("account.json", json.dumps({"email": user.email, "username": user.username,
                                               "display_name": user.display_name, "language": user.language,
                                               "prefs": user.prefs, "created_at": str(user.created_at)}, indent=2))
        for p in persons:
            base = f"{(p.name or 'person').replace('/', '_')}_{str(p.id)[:8]}"
            notes = (await db.execute(select(MemoryNote).where(MemoryNote.person_id == p.id))).scalars().all()
            z.writestr(f"{base}/persona.json", json.dumps({
                "name": p.name, "called_name": p.called_name, "relationship": p.relationship, "age": p.age,
                "gender": p.gender, "life_status": p.life_status, "call_language": p.call_language,
                "persona": p.persona, "memory_notes": [n.text for n in notes]}, indent=2, ensure_ascii=False))
            uploads = (await db.execute(select(MediaAsset).where(
                MediaAsset.person_id == p.id, MediaAsset.kind.in_(["photo", "video", "audio", "place_photo"])))
            ).scalars().all()
            for a in uploads:
                ext = {"image/jpeg": "jpg", "video/mp4": "mp4", "audio/mpeg": "mp3"}.get(a.mime, "bin")
                z.writestr(f"{base}/uploads/{a.kind}_{str(a.id)[:8]}.{ext}", storage().read_all(a.storage_key))
            calls = (await db.execute(select(Call).where(Call.person_id == p.id, Call.user_id == user.id))
                     ).scalars().all()
            transcripts = []
            for c in calls:
                turns = (await db.execute(select(CallTurn).where(CallTurn.call_id == c.id).order_by(CallTurn.idx))
                         ).scalars().all()
                transcripts.append({"started_at": str(c.started_at), "duration_s": c.duration_s, "kind": c.kind,
                                    "turns": [{"role": t.role, "text": t.text} for t in turns if t.text]})
            z.writestr(f"{base}/calls.json", json.dumps(transcripts, indent=2, ensure_ascii=False))
            letters = (await db.execute(select(Letter).where(Letter.person_id == p.id))).scalars().all()
            z.writestr(f"{base}/letters.json", json.dumps(
                [{"you_wrote": lt.text, "ai_reply": lt.reply_text, "at": str(lt.created_at)} for lt in letters],
                indent=2, ensure_ascii=False))
    return dest


async def labelled_clip(still: Path | None, audio: Path, dest: Path) -> Path:
    """Exported memory clips always carry a visible AI label (brief 7)."""
    label = "AI-generated recreation · Miss You"
    dur = f"{max(await av.duration(audio), 1.0):.2f}"  # bound the looped image explicitly
    if still:
        await av.run("ffmpeg", "-y", "-v", "error", "-loop", "1", "-t", dur, "-i", str(still), "-i", str(audio),
                     "-filter_complex",
                     f"[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,"
                     f"drawbox=y=ih-90:w=iw:h=90:color=black@0.55:t=fill,"
                     f"drawtext=fontfile={LABEL_FONT}:text='{label}':fontcolor=white:fontsize=30:"
                     f"x=(w-text_w)/2:y=h-62,format=yuv420p[v]",
                     "-map", "[v]", "-map", "1:a", "-shortest", "-c:v", "libx264", "-preset", "veryfast",
                     "-c:a", "aac", "-metadata", "comment=AI-generated recreation (Miss You)",
                     "-movflags", "+faststart", str(dest), timeout=300)
    else:
        await av.run("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-t", dur, "-i", "color=c=0x14102a:s=720x1280:d=60",
                     "-i", str(audio), "-filter_complex",
                     f"[0:v]drawtext=fontfile={LABEL_FONT}:text='{label}':fontcolor=white:fontsize=30:"
                     f"x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p[v]",
                     "-map", "[v]", "-map", "1:a", "-shortest", "-c:v", "libx264", "-c:a", "aac",
                     "-movflags", "+faststart", str(dest))
    return dest


async def labelled_video(src: Path, dest: Path) -> Path:
    """Burn the visible AI label onto an exported (lip-synced) video."""
    label = "AI-generated recreation · Miss You"
    await av.run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf",
                 f"drawbox=y=ih-90:w=iw:h=90:color=black@0.55:t=fill,"
                 f"drawtext=fontfile={LABEL_FONT}:text='{label}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=h-62",
                 "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
                 "-metadata", "comment=AI-generated recreation (Miss You)", "-movflags", "+faststart", str(dest),
                 timeout=300)
    return dest
