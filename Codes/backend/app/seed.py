"""Demo / jury seed.

`ensure_demo()` runs at API startup: it only makes sure the jury account
exists (free). `python -m app.seed --content` additionally creates the demo
loved one "Ma" — a FICTIONAL person whose portrait is AI-generated (no real
person's likeness is used) — and runs the normal pipeline on her: face
analysis, anchors, a preset voice, persona, memories and one scene. That
second step spends a little on xAI (≈ $0.5), so it is never automatic.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import uuid
from datetime import date

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import Consent, FaceCluster, Person, Scene, User, VoiceProfile
from .security import hash_password, verify_password
from .services.credits import adjust

log = logging.getLogger("missyou.seed")

MA_PERSONA = {
    "languages": ["Bengali", "English"], "code_mix": "Bengali words and endearments",
    "speech_style": "Soft, unhurried, a little teasing; asks lots of small questions; mixes Bengali endearments "
                    "into English.",
    "phrases": ["খুব ভালো", "কী রে?", "শোন", "Don't skip lunch", "ঠাকুর ভালো করবেন"],
    "nicknames": ["সোনা", "বাবু"],
    "greeting": "কী রে সোনা, কেমন আছিস? খেয়েছিস তো?",
    "goodbye": "ভালো থাকিস, take care of yourself. সময়মতো খেয়ে নিস।",
    "humour": "Gentle teasing about forgetting the umbrella and staying up late.",
    "topics_loved": ["her garden of jasmine and marigolds", "Rabindrasangeet", "making payesh on birthdays",
                     "Durga Puja evenings", "old Satyajit Ray films"],
    "topics_avoid": ["hospital days"],
    "use_transcripts": True, "heaven_framing": False,
}
MA_NOTES = [
    "Ma made payesh (rice pudding) every birthday and always added extra cardamom.",
    "She grew jasmine and marigolds on the balcony and watered them every morning at seven.",
    "She hummed Rabindrasangeet, especially 'Purano Sei Diner Kotha', while cooking.",
    "Every Durga Puja she insisted the family visit at least five pandals, wearing a red-bordered saree.",
    "She called every evening at eight to ask whether dinner was done.",
    "She loved watching 'Pather Panchali' and cried every single time.",
]
PORTRAIT_PROMPT = (
    "Photorealistic portrait photograph of a fictional, kind Bengali Indian woman in her early sixties, warm gentle "
    "smile, soft wrinkles near the eyes, silver-streaked black hair tied in a low bun, small red bindi, thin gold "
    "spectacles, wearing a cream cotton saree with a thin red border, sitting by a sunny window at home, natural "
    "daylight, sharp focus on the face, looking at the camera, shot on a phone camera, realistic skin texture.")


async def ensure_demo() -> User:
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.username == settings.demo_username))).scalars().first()
        if not u:
            u = User(username=settings.demo_username, email="jury@missyou.koushikdeb.com", display_name="Jury",
                     password_hash=hash_password(settings.demo_password), dob=date(1990, 1, 1), role="admin",
                     is_demo=True, email_verified=True, trial_granted=True,
                     prefs={"store_transcripts": True, "daily_minutes_limit": 30, "call_soft_limit_min": 10,
                            "captions": False, "ambient": True, "audio_first": True, "onboarded": True})
            db.add(u)
            await db.flush()
            await adjust(db, u.id, 3000, "demo_grant")
            await db.commit()
            log.info("created jury demo account")
        elif not verify_password(settings.demo_password, u.password_hash):
            u.password_hash = hash_password(settings.demo_password)
            await db.commit()
        if u.credits < 500:
            await adjust(db, u.id, 2000, "demo_topup")
            await db.commit()
        return u


async def demo_content() -> None:
    from .providers import xai_media
    from .services.assets import save_asset
    from .services.ingest import normalise_photo
    from .services.pipeline import generate_scene, process_person
    from .storage import storage

    user = await ensure_demo()
    async with SessionLocal() as db:
        p = (await db.execute(select(Person).where(Person.owner_id == user.id, Person.is_demo.is_(True)))
             ).scalars().first()
        if not p:
            p = Person(owner_id=user.id, name="Anjali Sen", called_name="Ma", relationship="mother", age=63,
                       gender="female", life_status="passed", call_language="en", persona=MA_PERSONA, is_demo=True)
            db.add(p)
            await db.flush()
            from .models import MemoryNote
            for n in MA_NOTES:
                db.add(MemoryNote(person_id=p.id, author_id=user.id, text=n, source="user"))
            db.add(Consent(user_id=user.id, person_id=p.id, kind="media_rights", version="demo",
                           statements=["Demo persona: fictional, AI-generated portrait; no real person."]))
            await db.commit()
        pid = p.id
        have_photo = (await db.execute(select(FaceCluster).where(FaceCluster.person_id == pid))).first()
    if not have_photo:
        tmp = storage().scratch_dir() / f"ma_{uuid.uuid4().hex[:6]}"
        raw = tmp.with_suffix(".raw")
        img = await xai_media.image(PORTRAIT_PROMPT, [], aspect_ratio="3:4", user_id=user.id, feature="demo_seed")
        raw.write_bytes(img)
        jpg = tmp.with_suffix(".jpg")
        w, h = normalise_photo(raw, jpg)
        async with SessionLocal() as db:
            await save_asset(db, owner_id=user.id, person_id=pid, kind="photo", mime="image/jpeg", path=jpg,
                             original_name="ma_ai_portrait.jpg", width=w, height=h,
                             meta={"demo": True, "ai_generated_portrait": True})
            await db.commit()
        raw.unlink(missing_ok=True)
        jpg.unlink(missing_ok=True)
        from .models import Job
        async with SessionLocal() as db:
            j = Job(kind="process_person", user_id=user.id, person_id=pid, args={"person_id": str(pid)})
            db.add(j)
            await db.commit()
            jid = str(j.id)
        await process_person(jid)
    async with SessionLocal() as db:
        p = await db.get(Person, pid)
        c = (await db.execute(select(FaceCluster).where(FaceCluster.person_id == pid)
                              .order_by(FaceCluster.size.desc()))).scalars().first()
        if c and not p.chosen_cluster_id:
            from .models import FaceDetection
            p.chosen_cluster_id = c.id
            dets = (await db.execute(select(FaceDetection).where(FaceDetection.cluster_id == c.id)
                                     .order_by(FaceDetection.quality.desc()).limit(3))).scalars().all()
            for d in dets:
                d.is_anchor = True
        if not p.voice_profile_id:
            vp = VoiceProfile(person_id=pid, kind="preset", provider="sarvam", engine="sarvam",
                              provider_voice_id="kavitha", language="en", label="Warm, gentle (preset)",
                              meta={"gender": "f", "preset_id": "sarvam-kavitha"})
            db.add(vp)
            await db.flush()
            p.voice_profile_id = vp.id
        p.status, p.setup_step = "ready", "done"
        await db.commit()
        scene = (await db.execute(select(Scene).where(Scene.person_id == pid))).scalars().first()
        if not scene:
            scene = Scene(person_id=pid, location_key="balcony_sunset", activity="sitting", time_of_day="golden_hour",
                          weather="clear", cache_key="balcony_sunset|sitting|golden_hour|clear||")
            db.add(scene)
            await db.commit()
        sid = scene.id
        ready = scene.status == "ready"
    if not ready:
        from .models import Job
        async with SessionLocal() as db:
            j = Job(kind="generate_scene", queue="gpu", user_id=user.id, person_id=pid, args={"scene_id": str(sid)})
            db.add(j)
            await db.commit()
            jid = str(j.id)
        await generate_scene(jid)
    print("demo content ready")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", action="store_true")
    a = ap.parse_args()
    asyncio.run(demo_content() if a.content else ensure_demo())
