"""Background pipelines run by the workers (brief 6.2–6.4, 9.1)."""
from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from sqlalchemy import delete, select

from ..config import settings
from ..db import SessionLocal
from ..models import (Call, EmailOutbox, MemoryBoxItem, FaceCluster, FaceDetection, Letter, MediaAsset, Person, Scene, SpeakerClip, User,
                      VoiceProfile, utcnow)
from ..providers import fish, lipsync, llm, stt, tts, voice_engine, xai_media
from ..providers.base import ProviderUnavailable
from ..storage import storage
from . import av, faces, ingest, jobs
from .assets import save_asset, url
from .credits import refund
from .metering import BudgetExceeded
from .persona import system_prompt
from .prompts import render

log = logging.getLogger("missyou.pipeline")


def _tmpdir() -> Path:
    d = storage().scratch_dir() / f"job_{uuid.uuid4().hex[:10]}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def locations() -> dict[str, Any]:
    p = settings.config_dir / "locations.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}


# --------------------------------------------------------------------------
# 1. Faces: detect → embed → cluster
# --------------------------------------------------------------------------

async def process_person(job_id: str) -> None:
    job = await jobs.update(job_id, status="running", progress=2, message="Looking through your memories…")
    assert job
    pid = uuid.UUID(job.args["person_id"])
    work = _tmpdir()
    try:
        async with SessionLocal() as db:
            person = await db.get(Person, pid)
            if not person:
                return
            media = (await db.execute(select(MediaAsset).where(
                MediaAsset.person_id == pid, MediaAsset.kind.in_(["photo", "video"])))).scalars().all()
            todo = [m for m in media if not (m.meta or {}).get("faces_done")]
            has_av = any(m.kind == "video" for m in media) or bool((await db.execute(select(MediaAsset.id).where(
                MediaAsset.person_id == pid, MediaAsset.kind == "audio"))).first())
            for i, m in enumerate(todo):
                await jobs.update(job_id, progress=5 + int(70 * i / max(len(todo), 1)),
                                  message=f"Finding faces ({i + 1} of {len(todo)})…")
                src = storage().to_temp(m.storage_key, ".mp4" if m.kind == "video" else ".jpg")
                try:
                    if m.kind == "photo":
                        frames = [(None, src)]
                    else:
                        frames = await av.extract_frames(src, work / f"v_{m.id.hex[:8]}", every_s=1.0, max_frames=30)
                    for t, fpath in frames:
                        found = await asyncio.to_thread(faces.analyze_image, fpath)
                        for f in found:
                            thumb = await save_asset(db, owner_id=person.owner_id, person_id=pid, kind="face_thumb",
                                                     mime="image/jpeg", data=f.thumb_jpeg)
                            crop = await save_asset(db, owner_id=person.owner_id, person_id=pid, kind="face_crop",
                                                    mime="image/jpeg", data=f.crop_jpeg)
                            db.add(FaceDetection(person_id=pid, media_id=m.id, thumb_media_id=thumb.id,
                                                 crop_media_id=crop.id, frame_time_s=t, bbox=f.bbox,
                                                 det_score=f.det_score, quality=f.quality, age=f.age,
                                                 gender=f.gender, embedding=f.embedding.tolist()))
                    m.meta = {**(m.meta or {}), "faces_done": True}
                    await db.commit()
                finally:
                    src.unlink(missing_ok=True)
            await jobs.update(job_id, progress=80, message="Grouping faces into people…")
            n = await recluster(db, person)
            if person.setup_step in ("upload", "faces", "anchors") or person.status in ("draft", "processing"):
                person.status = "choose_face" if n else "draft"
                person.setup_step = "faces" if n else "upload"
            elif person.status == "processing":
                person.status = "ready"
            await db.commit()
        msg = f"We found {n} {'person' if n == 1 else 'people'}." if n else \
            "We couldn't find a clear face. Try adding a well-lit photo where their face is visible."
        await jobs.update(job_id, status="done", progress=100, message=msg, result={"clusters": n})
        if has_av:
            await jobs.enqueue("analyze_voices", queue="cpu", user_id=job.user_id, person_id=pid)
    except Exception as e:
        log.exception("process_person failed")
        await jobs.update(job_id, status="failed", message="Something went wrong while processing.", error=str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def recluster(db: Any, person: Person) -> int:
    dets = (await db.execute(select(FaceDetection).where(FaceDetection.person_id == person.id))).scalars().all()
    await db.execute(delete(FaceCluster).where(FaceCluster.person_id == person.id))
    if not dets:
        return 0
    embs = np.stack([np.asarray(d.embedding, dtype=np.float32) for d in dets])
    labels = faces.cluster(embs)
    groups: dict[int, list[FaceDetection]] = {}
    for d, lab in zip(dets, labels):
        groups.setdefault(int(lab), []).append(d)
    ordered = sorted(groups.values(), key=len, reverse=True)
    for i, members in enumerate(ordered):
        best = max(members, key=lambda d: d.quality)
        ages = [d.age for d in members if d.age]
        genders = [d.gender for d in members]
        c = FaceCluster(person_id=person.id, label=i, size=len(members), best_face_id=best.id,
                        centroid=faces.centroid([np.asarray(d.embedding, dtype=np.float32) for d in members]).tolist(),
                        median_age=float(np.median(ages)) if ages else None,
                        gender=max(set(genders), key=genders.count) if genders else "")
        db.add(c)
        await db.flush()
        for d in members:
            d.cluster_id = c.id
    return len(ordered)


# --------------------------------------------------------------------------
# 2. Voices: isolate → segment → group speakers → transcribe
# --------------------------------------------------------------------------

async def analyze_voices(job_id: str) -> None:
    job = await jobs.update(job_id, status="running", progress=3, message="Listening for voices…")
    assert job
    pid = uuid.UUID(job.args["person_id"])
    work = _tmpdir()
    try:
        async with SessionLocal() as db:
            person = await db.get(Person, pid)
            if not person:
                return
            media = (await db.execute(select(MediaAsset).where(
                MediaAsset.person_id == pid, MediaAsset.kind.in_(["video", "audio"])))).scalars().all()
            todo = [m for m in media if not (m.meta or {}).get("voices_done")]
            new_clips: list[tuple[SpeakerClip, np.ndarray | None]] = []
            budget = 16
            for i, m in enumerate(todo):
                await jobs.update(job_id, progress=5 + int(60 * i / max(len(todo), 1)),
                                  message=f"Separating voices ({i + 1} of {len(todo)})…")
                src = storage().to_temp(m.storage_key, ".bin")
                try:
                    wav = await av.to_wav16k(src, work / f"a_{m.id.hex[:8]}.wav", clean=True)
                    total = await av.duration(wav)
                    if total < 1.0:
                        m.meta = {**(m.meta or {}), "voices_done": True, "no_audio": True}
                        continue
                    segs = av.speech_segments(await av.silences(wav), total)[: max(0, min(8, budget))]
                    budget -= len(segs)
                    for s, e in segs:
                        c16 = await av.to_wav16k(wav, work / f"c_{uuid.uuid4().hex[:8]}.wav", start=s, end=e)
                        hq = work / f"h_{uuid.uuid4().hex[:8]}.wav"
                        await av.run("ffmpeg", "-y", "-v", "error", "-ss", f"{s:.3f}", "-to", f"{e:.3f}", "-i",
                                     str(src), "-vn", "-ac", "1", "-ar", "24000", "-af",
                                     "highpass=f=70,afftdn=nf=-25,loudnorm=I=-18", "-c:a", "pcm_s16le", str(hq))
                        asset = await save_asset(db, owner_id=person.owner_id, person_id=pid, kind="voice_clip",
                                                 mime="audio/wav", path=hq, duration_s=e - s)
                        clip = SpeakerClip(person_id=pid, source_media_id=m.id, clip_media_id=asset.id,
                                           start_s=s, end_s=e)
                        try:
                            res = await stt.transcribe(c16, duration_s=e - s, user_id=person.owner_id,
                                                       feature="voice_setup")
                            clip.transcript, clip.language = res.text[:2000], res.language
                        except (ProviderUnavailable, BudgetExceeded) as ex:
                            log.info("clip transcription skipped: %s", ex)
                        db.add(clip)
                        new_clips.append((clip, ingest.speaker_vector(c16)))
                    m.meta = {**(m.meta or {}), "voices_done": True}
                    await db.commit()
                finally:
                    src.unlink(missing_ok=True)
            await jobs.update(job_id, progress=80, message="Grouping clips by speaker…")
            allclips = (await db.execute(select(SpeakerClip).where(SpeakerClip.person_id == pid))).scalars().all()
            vecs: list[np.ndarray] = []
            idx: list[SpeakerClip] = []
            known = {c.id: v for c, v in new_clips}
            for c in allclips:
                v = known.get(c.id)
                if v is None:
                    a = await db.get(MediaAsset, c.clip_media_id) if c.clip_media_id else None
                    if a:
                        t = storage().to_temp(a.storage_key, ".wav")
                        t16 = await av.to_wav16k(t, work / f"r_{c.id.hex[:8]}.wav")
                        v = ingest.speaker_vector(t16)
                        t.unlink(missing_ok=True)
                if v is not None:
                    vecs.append(v)
                    idx.append(c)
            for c, lab in zip(idx, ingest.group_speakers(vecs)):
                c.speaker_label = lab
            await db.commit()
            n = len({c.speaker_label for c in allclips})
        await jobs.update(job_id, status="done", progress=100,
                          message=(f"Found {len(allclips)} voice clips from about {n} speaker(s)." if allclips
                                   else "No clear speech found in your videos or audio."),
                          result={"clips": len(allclips), "speakers": n})
    except Exception as e:
        log.exception("analyze_voices failed")
        await jobs.update(job_id, status="failed", message="Voice analysis failed.", error=str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def voice_for(db: Any, person: Person) -> tuple[tts.Voice, list[Path]]:
    """The TTS voice for this person; returns temp files the caller must delete."""
    temps: list[Path] = []
    vp = await db.get(VoiceProfile, person.voice_profile_id) if person.voice_profile_id else None
    gender = "m" if (person.gender or "").lower().startswith("m") else "f"
    if not vp:
        return tts.Voice(engine="sarvam", gender=gender), temps
    meta = vp.meta or {}
    ref = None
    if meta.get("ref_media_id"):
        a = await db.get(MediaAsset, uuid.UUID(meta["ref_media_id"]))
        if a:
            ref = storage().to_temp(a.storage_key, ".wav")
            temps.append(ref)
    return tts.Voice(engine=vp.provider if vp.provider != "sarvam" or vp.kind != "clone" else "sarvam_clone",
                     voice_id=vp.provider_voice_id, gender=meta.get("gender", gender), ref_audio=ref,
                     ref_text=meta.get("ref_text", ""), instructions=meta.get("instructions", "")), temps


PREVIEW_LINES = {
    "en": "Hello, my dear. It's so good to see your face. Tell me, have you eaten properly today?",
    "hi": "अरे बेटा, तुम्हें देखकर बहुत अच्छा लगा। बताओ, आज ठीक से खाना खाया?",
    "bn": "কী রে, তোকে দেখে খুব ভালো লাগছে। বল তো, আজ ঠিক করে খেয়েছিস?",
}


async def build_voice(job_id: str) -> None:
    job = await jobs.update(job_id, status="running", progress=5, message="Learning their voice…")
    assert job
    pid = uuid.UUID(job.args["person_id"])
    engine_req = job.args.get("engine") or ""
    work = _tmpdir()
    try:
        async with SessionLocal() as db:
            person = await db.get(Person, pid)
            if not person:
                return
            clips = (await db.execute(select(SpeakerClip).where(
                SpeakerClip.person_id == pid, SpeakerClip.confirmed.is_(True)))).scalars().all()
            if not clips:
                raise RuntimeError("no confirmed clips")
            clips = sorted(clips, key=lambda c: c.end_s - c.start_s, reverse=True)
            # Reference: confirmed clips joined up to ~14 s (Sarvam takes ≤ 15 s).
            parts: list[Path] = []
            total = 0.0
            texts: list[str] = []
            samples: list[tuple[bytes, str]] = []
            for c in clips:
                a = await db.get(MediaAsset, c.clip_media_id)
                if not a:
                    continue
                p = storage().to_temp(a.storage_key, ".wav")
                parts.append(p)
                samples.append((p.read_bytes(), c.transcript))
                if total < 14.0:
                    total += c.end_s - c.start_s
                    texts.append(c.transcript)
            listfile = work / "list.txt"
            listfile.write_text("".join(f"file '{p}'\n" for p in parts[: max(1, len(texts))]))
            ref = work / "ref.wav"
            await av.run("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listfile),
                         "-t", "14.5", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(ref))
            ref_asset = await save_asset(db, owner_id=person.owner_id, person_id=pid, kind="voice_ref",
                                         mime="audio/wav", path=ref)
            lang = person.call_language or "en"
            chain = tts.routing().get("clone_chain", {}).get(lang, ["voice_engine", "sarvam_clone"])
            if engine_req:
                chain = [engine_req]
            gender = "m" if (person.gender or "").lower().startswith("m") else "f"
            await jobs.update(job_id, progress=40, message="Creating the voice profile…")
            chosen, voice_id = None, ""
            for eng in chain:
                if not tts.engine_available(eng) or not tts.engine_supports(eng, lang):
                    continue
                if eng == "fish":
                    try:
                        voice_id = await fish.create_voice(f"missyou-{pid.hex[:12]}", samples)
                        chosen = "fish"
                        break
                    except Exception as e:  # noqa: BLE001
                        log.warning("fish voice failed: %s", str(e)[:160])
                        continue
                if eng == "voice_engine":
                    try:
                        voice_id = await voice_engine.create_profile(f"missyou-{pid.hex[:12]}", lang, samples[:4])
                        chosen = "voice_engine"
                        break
                    except Exception as e:  # noqa: BLE001
                        log.warning("voice_engine profile failed: %s", str(e)[:160])
                        continue
                chosen = eng
                break
            if not chosen:
                raise ProviderUnavailable("tts", "none", "no cloning engine available for this language")
            vp = VoiceProfile(person_id=pid, kind="clone", provider="sarvam" if chosen == "sarvam_clone" else chosen,
                              engine=chosen, provider_voice_id=voice_id, language=lang,
                              label="Their own voice (cloned)",
                              meta={"ref_media_id": str(ref_asset.id), "ref_text": " ".join(texts)[:500],
                                    "gender": gender, "clips": [str(c.id) for c in clips]})
            db.add(vp)
            await db.flush()
            await jobs.update(job_id, progress=70, message="Making a preview…")
            voice = tts.Voice(engine=chosen, voice_id=voice_id, gender=gender, ref_audio=ref,
                              ref_text=vp.meta["ref_text"])
            res = await tts.synthesize(PREVIEW_LINES.get(lang, PREVIEW_LINES["en"]), lang, voice,
                                       user_id=person.owner_id, feature="voice_preview", only_engine=chosen)
            prev = await save_asset(db, owner_id=person.owner_id, person_id=pid, kind="tts", mime=res.mime,
                                    data=res.audio, ai_generated=True, meta={"engine": res.engine})
            vp.preview_media_id = prev.id
            person.voice_profile_id = vp.id
            await db.commit()
            for p in parts:
                p.unlink(missing_ok=True)
        await jobs.update(job_id, status="done", progress=100, message="Their voice is ready to preview.",
                          result={"voice_profile_id": str(vp.id), "engine": chosen})
    except Exception as e:
        log.exception("build_voice failed")
        await jobs.update(job_id, status="failed",
                          message="We couldn't build a voice from these clips. You can try another engine or "
                                  "choose a preset voice.", error=str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# --------------------------------------------------------------------------
# 3. Scenes: still (identity-checked) → idle / listening / talking loops
# --------------------------------------------------------------------------

def scene_prompt(person: Person, scene: Scene, n_refs: int, has_place: bool) -> str:
    loc = locations().get("locations", {}).get(scene.location_key, {})
    tod = locations().get("times", {}).get(scene.time_of_day, "")
    wx = locations().get("weather", {}).get(scene.weather, "")
    act = locations().get("activities", {}).get(scene.activity, "")
    who = ", ".join(f"<IMAGE_{i}>" for i in range(n_refs))
    outfit = f" Wearing {scene.outfit}." if scene.outfit else " Wearing their usual everyday clothes."
    place = (f" The location is the place shown in <IMAGE_{n_refs}> — keep its look." if has_place
             else f" Location: {loc.get('prompt', 'a calm, pleasant outdoor place')}.")
    return (
        f"A natural front-camera smartphone selfie video-call frame of the exact same person shown in {who}. "
        f"Preserve their identity strictly: same face, facial structure, skin tone, age, hairstyle, glasses if any. "
        f"They are holding the phone at arm's length, slight upward angle, looking warmly into the lens, mouth "
        f"gently closed with a soft, kind expression; face fills the upper third of a vertical 9:16 frame, shoulders "
        f"visible. {act}{outfit}{place} {tod} {wx} Realistic phone-camera look, mild wide-angle, natural skin, "
        f"slight depth of field, not cinematic, no text, no watermark, a single person only."
    )


MOTION = {
    "idle": ("Subtle handheld phone sway, natural slow blinking, gentle breathing motion, the person looks into the "
             "lens with a soft warm expression, mouth closed, not speaking. Ambient background movement: {amb}. "
             "Calm, continuous, no cuts, camera stays in selfie position."),
    "listening": ("The person is attentively listening to someone on a video call: small slow nods, a gentle "
                  "understanding smile, natural blinking, mouth closed, slight handheld sway. Background: {amb}. "
                  "No cuts."),
    "talking": ("The person is speaking warmly and naturally to the camera on a video call, mouth moving as in "
                "relaxed conversation, small head movements and expressions, natural blinking, slight handheld "
                "sway. Background: {amb}. No cuts, no text."),
}


async def generate_scene(job_id: str) -> None:
    job = await jobs.update(job_id, status="running", progress=3, message="Preparing the place…")
    assert job
    sid = uuid.UUID(job.args["scene_id"])
    work = _tmpdir()
    try:
        async with SessionLocal() as db:
            scene = await db.get(Scene, sid)
            person = await db.get(Person, scene.person_id) if scene else None
            if not scene or not person:
                return
            scene.status, scene.progress, scene.error, scene.notes = "generating", 5, None, []
            await db.commit()
            anchors = (await db.execute(select(FaceDetection).where(
                FaceDetection.person_id == person.id, FaceDetection.is_anchor.is_(True))
                .order_by(FaceDetection.quality.desc()).limit(3))).scalars().all()
            if not anchors:
                raise RuntimeError("no anchor faces chosen")
            refs: list[Path] = []
            for a in anchors:
                mid = a.restored_media_id if a.use_restored and a.restored_media_id else a.crop_media_id
                asset = await db.get(MediaAsset, mid) if mid else None
                if asset:
                    refs.append(storage().to_temp(asset.storage_key, ".jpg"))
            cluster = await db.get(FaceCluster, person.chosen_cluster_id) if person.chosen_cluster_id else None
            ref_emb = np.asarray(cluster.centroid, dtype=np.float32) if cluster is not None else None
            place = None
            if scene.place_media_id:
                pa = await db.get(MediaAsset, scene.place_media_id)
                if pa:
                    place = storage().to_temp(pa.storage_key, ".jpg")
            prompt_text = scene_prompt(person, scene, len(refs), place is not None)
            owner = person.owner_id
            loc = locations().get("locations", {}).get(scene.location_key, {})
            amb = loc.get("ambient_motion", "soft natural movement")
            notes: list[str] = []
            still_path = work / "still.jpg"
            best: tuple[float, bytes] | None = None
            mode = "video"
            budget_hit = False
            # --- Step 1: still, identity-checked, ≤ 2 retries -------------
            if xai_media.available():
                for attempt in range(3):
                    await jobs.update(job_id, progress=10 + attempt * 8,
                                      message="Placing them in the scene…" if attempt == 0 else
                                      "Making sure it really looks like them…")
                    try:
                        img = await xai_media.image(prompt_text, refs + ([place] if place else []), user_id=owner,
                                                    idempotency_key=f"scene:{sid}:{scene.generations}:still:{attempt}")
                    except BudgetExceeded:
                        budget_hit = True
                        notes.append("Today's scene budget is used up, so we used their own photo, gently animated.")
                        break
                    except Exception as e:  # noqa: BLE001
                        log.warning("scene still attempt %d failed: %s", attempt, str(e)[:160])
                        continue
                    tmp_img = work / f"try{attempt}.jpg"
                    tmp_img.write_bytes(img)
                    score = await asyncio.to_thread(faces.identity_score, tmp_img, ref_emb) if ref_emb is not None \
                        else 1.0
                    log.info("scene %s attempt %d identity %.3f", sid, attempt, score or -1)
                    if score is not None and (best is None or score > best[0]):
                        best = (score, img)
                    if score is not None and score >= settings.identity_threshold:
                        break
            if best and best[0] >= settings.identity_threshold:
                still_path.write_bytes(best[1])
                scene.identity_score = round(best[0], 3)
            else:
                if best:
                    notes.append("The generated picture didn't look enough like them, so we used their own photo.")
                elif budget_hit:
                    pass
                elif xai_media.available():
                    notes.append("Scene generation was unavailable — we used their own photo, gently animated.")
                else:
                    notes.append("No image provider is configured — we used their own photo, gently animated.")
                mode = "animated_still"
                best_anchor = refs[0]
                await av.run("ffmpeg", "-y", "-v", "error", "-i", str(best_anchor), "-vf",
                             "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280", str(still_path))
                scene.identity_score = None
            from .watermark import mark_image
            still_path = mark_image(still_path)
            still = await save_asset(db, owner_id=owner, person_id=person.id, kind="scene_still", mime="image/png",
                                     path=still_path, ai_generated=True)
            scene.still_media_id = still.id
            scene.progress = 40
            await db.commit()
            # --- Step 2: idle / listening / talking loops ---------------
            await jobs.update(job_id, progress=45, message="Bringing the moment to life…")

            async def make(variant: str, seconds: int) -> tuple[str, Path, str]:
                out = work / f"{variant}.mp4"
                raw = work / f"{variant}_raw.mp4"
                if mode == "video":
                    try:
                        data = await xai_media.video(MOTION[variant].format(amb=amb), still_path, seconds=seconds,
                                                     user_id=owner,
                                                     idempotency_key=f"scene:{sid}:{scene.generations}:{variant}")
                        raw.write_bytes(data)
                        await av.loopify(raw, work / f"{variant}_loop.mp4")
                        await av.tag_ai_generated(work / f"{variant}_loop.mp4", out)
                        return variant, out, "video"
                    except Exception as e:  # noqa: BLE001 — degrade to animated still
                        log.warning("scene video %s failed: %s", variant, str(e)[:200])
                await av.animated_still(still_path, raw, seconds=8, variant="idle" if variant != "talking" else "talk")
                await av.tag_ai_generated(raw, out)
                return variant, out, "animated_still"

            results = await asyncio.gather(make("idle", 8), make("listening", 6), make("talking", 8))
            for variant, path, kind in results:
                if kind != mode:
                    notes.append(f"The {variant} clip uses a gently animated photo (video provider unavailable).")
                a = await save_asset(db, owner_id=owner, person_id=person.id, kind=f"scene_{variant}",
                                     mime="video/mp4", path=path, ai_generated=True,
                                     duration_s=await av.duration(path), meta={"mode": kind})
                setattr(scene, f"{variant}_media_id", a.id)
            scene.mode = "video" if all(k == "video" for _, _, k in results) else "animated_still"
            # No AI scene was made (their own photo, gently animated): give the credits back.
            if mode == "animated_still" and await refund(db, job.user_id, "scene_generation",
                                                         f"scene:{sid}:{scene.generations}"):
                notes.append("Your credits were returned.")
            scene.status, scene.progress, scene.notes = "ready", 100, notes
            scene.generations += 1
            await db.commit()
            for p in refs + ([place] if place else []):
                p.unlink(missing_ok=True)
        await jobs.update(job_id, status="done", progress=100, message="The scene is ready.",
                          result={"scene_id": str(sid), "mode": scene.mode, "notes": notes})
    except Exception as e:
        log.exception("generate_scene failed")
        async with SessionLocal() as db:
            scene = await db.get(Scene, sid)
            if scene:
                scene.status, scene.error = "failed", str(e)[:500]
                await db.commit()
                await refund(db, job.user_id, "scene_generation", f"scene:{sid}:{scene.generations}")
                await db.commit()
        await jobs.update(job_id, status="failed", message="We couldn't create this scene. Your credits were "
                                                           "returned.", error=str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# --------------------------------------------------------------------------
# 4. Letters (async voice-message reply)
# --------------------------------------------------------------------------

async def write_letter(job_id: str) -> None:
    job = await jobs.update(job_id, status="running", progress=5, message="Writing back…")
    assert job
    lid = uuid.UUID(job.args["letter_id"])
    work = _tmpdir()
    temps: list[Path] = []
    try:
        async with SessionLocal() as db:
            letter = await db.get(Letter, lid)
            person = await db.get(Person, letter.person_id) if letter else None
            user = await db.get(User, letter.user_id) if letter else None
            if not letter or not person or not user:
                return
            letter.status = "writing"
            await db.commit()
            sys = await system_prompt(db, person, user, query=letter.text)
            lang = person.call_language or "en"
            res = await llm.chat([{"role": "system", "content": sys + "\n\n" + render(
                "letter_v1", user_name=user.display_name, name=person.name,
                call_language_name={"en": "English", "bn": "Bengali", "hi": "Hindi"}.get(lang, lang))},
                {"role": "user", "content": letter.text[:4000]}], max_tokens=400, temperature=0.8,
                user_id=user.id, feature="letter")
            reply = res.text.strip()
            await jobs.update(job_id, progress=40, message="Recording their voice…")
            voice, temps = await voice_for(db, person)
            audio = await tts.synthesize(reply.replace("[sigh]", "").replace("[soft laugh]", ""), lang, voice,
                                         user_id=user.id, feature="letter")
            apath = work / ("reply.mp3" if audio.mime == "audio/mpeg" else "reply.wav")
            apath.write_bytes(audio.audio)
            a_asset = await save_asset(db, owner_id=user.id, person_id=person.id, kind="tts", mime=audio.mime,
                                       path=apath, ai_generated=True)
            await jobs.update(job_id, progress=70, message="Putting the message together…")
            scene = (await db.execute(select(Scene).where(Scene.person_id == person.id, Scene.status == "ready")
                                      .order_by(Scene.created_at.desc()))).scalars().first()
            still_id = scene.still_media_id if scene else None
            if not still_id:
                anchor = (await db.execute(select(FaceDetection).where(
                    FaceDetection.person_id == person.id, FaceDetection.is_anchor.is_(True))
                    .order_by(FaceDetection.quality.desc()))).scalars().first()
                still_id = anchor.crop_media_id if anchor else None
            if scene and scene.talking_media_id and lipsync.available():
                # Real lip-sync (fal) of the talking loop to the whole reply, looped to length.
                # Commit first: fal fetches the audio through our public signed URL, which only
                # resolves for committed rows.
                await db.commit()
                try:
                    secs = await av.duration(apath)
                    data = await lipsync.sync_urls(lipsync.public(url(scene.talking_media_id, 3600)),
                                                   lipsync.public(url(a_asset.id, 3600)), secs, user_id=user.id,
                                                   feature="letter_video", sync_mode="loop")
                    v_asset = await save_asset(db, owner_id=user.id, person_id=person.id, kind="letter_video",
                                               mime="video/mp4", data=data, ai_generated=True, duration_s=secs,
                                               meta={"lipsync": "fal"})
                    letter.reply_video_media_id = v_asset.id
                    still_id = None
                except Exception as e:  # noqa: BLE001 — fall back to the animated still
                    log.warning("letter lip-sync failed: %s", str(e)[:160])
            if still_id and not letter.reply_video_media_id:
                sa = await db.get(MediaAsset, still_id)
                img = storage().to_temp(sa.storage_key, ".jpg")
                temps.append(img)
                vpath = await av.still_with_audio(img, apath, work / "letter.mp4")
                v_asset = await save_asset(db, owner_id=user.id, person_id=person.id, kind="letter_video",
                                           mime="video/mp4", path=vpath, ai_generated=True,
                                           duration_s=await av.duration(vpath))
                letter.reply_video_media_id = v_asset.id
            letter.reply_text, letter.reply_audio_media_id = reply, a_asset.id
            letter.status, letter.delivered_at = "ready", utcnow()
            if user.email and (user.prefs or {}).get("notify_letters", True):
                db.add(EmailOutbox(to=user.email, subject=f"A message from {person.name} is waiting",
                                   body=f"Your letter has been answered. Open Miss You to listen. "
                                        f"(This is an AI recreation.) {settings.public_url}/letters", kind="letter"))
            await db.commit()
        await jobs.update(job_id, status="done", progress=100, message="A reply has arrived.",
                          result={"letter_id": str(lid)})
    except Exception as e:
        log.exception("write_letter failed")
        async with SessionLocal() as db:
            letter = await db.get(Letter, lid)
            if letter:
                letter.status = "failed"
                await refund(db, letter.user_id, "letter", f"letter:{lid}")
                await db.commit()
        await jobs.update(job_id, status="failed", message="The reply couldn't be written. Your credits were returned.",
                          error=str(e))
    finally:
        for t in temps:
            t.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)


# --------------------------------------------------------------------------
# 5. Memory-box keepsake: lip-synced clip of a saved moment (fal, async)
# --------------------------------------------------------------------------

async def lipsync_memory(job_id: str) -> None:
    job = await jobs.update(job_id, status="running", progress=10, message="Making a keepsake clip…")
    assert job
    mid = uuid.UUID(job.args["memory_id"])
    try:
        async with SessionLocal() as db:
            item = await db.get(MemoryBoxItem, mid)
            call = await db.get(Call, item.call_id) if item and item.call_id else None
            scene = await db.get(Scene, call.scene_id) if call and call.scene_id else None
            audio = await db.get(MediaAsset, item.media_id) if item and item.media_id else None
            video = await db.get(MediaAsset, scene.talking_media_id) if scene and scene.talking_media_id else None
            if not item or not audio or not video:
                raise RuntimeError("nothing to lip-sync")
            item.video_status = "making"
            await db.commit()
            secs = float(audio.duration_s or 0) or await _asset_duration(audio)
            mode = "cut_off" if secs <= float(video.duration_s or 8.0) else "loop"
            data = await lipsync.sync_urls(lipsync.public(url(video.id, 3600)), lipsync.public(url(audio.id, 3600)),
                                           secs, user_id=item.user_id, feature="memory_clip", sync_mode=mode)
            raw = av.tmp(".mp4")
            raw.write_bytes(data)
            tagged = av.tmp(".mp4")
            await av.tag_ai_generated(raw, tagged)
            v = await save_asset(db, owner_id=item.user_id, person_id=item.person_id, kind="lipsync", mime="video/mp4",
                                 path=tagged, ai_generated=True, duration_s=secs, meta={"memory_id": str(mid)})
            raw.unlink(missing_ok=True)
            tagged.unlink(missing_ok=True)
            item.video_media_id, item.video_status = v.id, "ready"
            await db.commit()
        await jobs.update(job_id, status="done", progress=100, message="Your keepsake clip is ready.")
    except Exception as e:
        log.exception("lipsync_memory failed")
        async with SessionLocal() as db:
            item = await db.get(MemoryBoxItem, mid)
            if item:
                item.video_status = "failed"
                await db.commit()
        await jobs.update(job_id, status="failed", message="The clip couldn't be made; the audio is still saved.",
                          error=str(e))


async def _asset_duration(a: MediaAsset) -> float:
    p = storage().to_temp(a.storage_key, ".mp3")
    try:
        return await av.duration(p) or 6.0
    finally:
        p.unlink(missing_ok=True)
