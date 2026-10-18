"""The call loop (brief 6.5) — one CallSession per WebSocket.

Turn pipeline, with per-stage timings stored on call_turns.timings:

  user audio ──► STT ──┬─► safety check (keywords ∥ moderation ∥ LLM) ─┐
                       └─► persona LLM reply (speculative, in parallel) ┴─► gate
  gate ok ──► split into sentences ──► TTS per sentence (2 in flight) ──► audio to client in order
          └─► (lip-sync provider, when configured) ──► video to client

The client plays the talking/idle loops while audio plays (audio-first).
Transcripts are only written to the database when the user opted in; the
working history lives in Redis for the duration of the call.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import WebSocket
from sqlalchemy import func, select

from ..config import settings
from ..db import SessionLocal
from ..models import Call, CallTurn, MemoryNote, Person, SafetyEvent, User, utcnow
from ..providers import llm, lipsync, stt, tts
from ..providers.base import ProviderUnavailable
from ..redis_client import redis
from . import av, safety
from .assets import save_asset, url
from .credits import adjust
from .metering import BudgetExceeded
from .persona import LANG_NAME, greeting_hint, nickname, system_prompt
from .pipeline import voice_for
from .pricing import credit_cost
from .prompts import render

log = logging.getLogger("missyou.calls")
_SENT = re.compile(r"(?<=[.!?।])\s+")
_TAGS = re.compile(r"\[(sigh|soft laugh|laughs?|pause)\]", re.I)
_FORBIDDEN = [re.compile(p, re.I) for p in (
    r"watching (over )?(you )?from (heaven|above)", r"\bfrom heaven\b", r"\bI('m| am) (still )?alive\b",
    r"\b(transfer|send) (me )?(the )?money\b", r"\b(otp|password|pin)\b", r"\bupi\b",
    # wellbeing: never push the user to keep calling (brief 6.5)
    r"ফোন কর(বি|িস|বে|ো|তে)", r"(রোজ|প্রতিদিন|দিনে).{0,15}(ফোন|কল)", r"फ़?ोन कर(ना|ते|ो)", r"\bcall me (again|every|daily|tomorrow)")]
NEUTRAL_VOICE = {"en": ("sarvam", "priya"), "hi": ("sarvam", "priya"), "bn": ("sarvam", "roopa")}


_CLAUSE = re.compile(r"(?<=[,;—–])\s*")
FIRST_CHUNK_MAX = 40


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT.split(text.strip()) if p.strip()]
    out: list[str] = []
    for p in parts:
        if out and len(out[-1]) < 12:
            out[-1] = out[-1] + " " + p
        else:
            out.append(p)
    out = out or [text.strip()]
    # The first clip decides how soon they start speaking: voice a long first sentence in two parts,
    # cut at its first comma or dash (shorter text comes back from the voice provider sooner).
    first = out[0]
    if len(first) > FIRST_CHUNK_MAX:
        for m in _CLAUSE.finditer(first):
            head, tail = first[:m.start()].strip(), first[m.end():].strip()
            if 12 <= len(head) <= FIRST_CHUNK_MAX and len(tail) >= 8:
                out[0:1] = [head, tail]
                break
    return out


def clean_reply(text: str) -> str:
    t = text.strip().replace("*", "").replace("#", "")
    t = re.sub(r"^\s*\w[\w ]{0,30}:\s", "", t)  # "Ma: ..." prefixes
    return re.sub(r"\s+", " ", t).strip().strip('"“”').strip()


def violates_rules(text: str) -> bool:
    return any(p.search(text) for p in _FORBIDDEN)


_FORMAL_THANKS = re.compile(r"ধন্যবাদ|धन्यवाद|शुक्रिया|\bthank(s| you)\b", re.I)


def formal_with_family(text: str) -> bool:
    """A Bengali/Hindi family elder doesn't thank family formally (owner feedback, 2026-10-18)."""
    return bool(_FORMAL_THANKS.search(text))


async def minutes_today(db: Any, user_id: uuid.UUID) -> float:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    s = (await db.execute(select(func.coalesce(func.sum(Call.duration_s), 0)).where(
        Call.user_id == user_id, Call.started_at >= since))).scalar_one()
    return float(s) / 60.0


async def consecutive_days(db: Any, user_id: uuid.UUID) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=40)
    days = (await db.execute(select(func.date(Call.started_at)).where(
        Call.user_id == user_id, Call.started_at >= since).distinct())).scalars().all()
    have = set(days)
    n, d = 0, datetime.now(timezone.utc).date()
    while d in have:
        n += 1
        d -= timedelta(days=1)
    return n


class CallSession:
    def __init__(self, ws: WebSocket, call_id: uuid.UUID, user_id: uuid.UUID) -> None:
        self.ws, self.call_id, self.user_id = ws, call_id, user_id
        self.busy = False
        self.ended = False
        self.paused = False
        self.turn_idx = 0
        self.connected_at: float | None = None
        self.soft_limit = 900
        self.warned = False
        self.lang = "en"
        self.kind = "call"
        self.subtitle_lang = ""
        self.temps: list[Path] = []
        self.voice: tts.Voice | None = None
        self.person_id: uuid.UUID | None = None
        self.tts_lang = "en"
        self.caller: dict[str, Any] | None = None
        self.pending: dict[str, Any] | None = None
        self.current: asyncio.Task[None] | None = None
        self.hist_key = f"missyou:call:{call_id}:history"
        self._send_lock = asyncio.Lock()

    # ---------------------------------------------------------------- utils
    async def send(self, msg: dict[str, Any]) -> None:
        if self.ended and msg.get("type") not in ("ended", "goodbye_audio"):
            return
        async with self._send_lock:
            try:
                await self.ws.send_text(json.dumps(msg, default=str))
            except Exception:  # noqa: BLE001 — client went away
                self.ended = True

    async def history(self) -> list[dict[str, str]]:
        raw = await redis().lrange(self.hist_key, -14, -1)
        return [json.loads(r) for r in raw]

    async def remember(self, role: str, content: str) -> None:
        await redis().rpush(self.hist_key, json.dumps({"role": role, "content": content}))
        await redis().expire(self.hist_key, 6 * 3600)

    def elapsed(self) -> float:
        return time.time() - self.connected_at if self.connected_at else 0.0

    # ---------------------------------------------------------------- setup
    async def load(self) -> tuple[Call, Person, User]:
        async with SessionLocal() as db:
            call = await db.get(Call, self.call_id)
            if not call or call.user_id != self.user_id:
                raise PermissionError("not your call")
            person = await db.get(Person, call.person_id)
            user = await db.get(User, call.user_id)
            assert person and user
            return call, person, user

    async def start(self) -> None:
        call, person, user = await self.load()
        self.person_id = person.id
        self.caller = call.caller or None
        self.lang, self.kind = call.language, call.kind
        # A Bengali-speaking persona keeps one Bengali voice for the whole call (it reads English words
        # naturally); otherwise the call language decides.
        spoken = " ".join(str(x) for x in ((person.persona or {}).get("languages") or [])).lower()
        self.tts_lang = "bn" if ("bengali" in spoken or "bangla" in spoken or self.lang == "bn") and \
            self.kind != "interview" else self.lang
        self.soft_limit = call.soft_limit_s
        self.subtitle_lang = (user.prefs or {}).get("subtitle_lang", "") or ""
        if call.status == "ended":
            await self.send({"type": "ended", "reason": "already_ended"})
            self.ended = True
            return
        async with SessionLocal() as db:
            if self.kind == "interview":
                eng, vid = NEUTRAL_VOICE.get(self.lang, NEUTRAL_VOICE["en"])
                self.voice = tts.Voice(engine=eng, voice_id=vid, gender="f")
            else:
                self.voice, self.temps = await voice_for(db, person)
            streak = await consecutive_days(db, user.id)
        await self.send({"type": "state", "status": "ringing", "soft_limit_s": self.soft_limit,
                         "lipsync": settings.lipsync_live and lipsync.available(), "kind": self.kind})
        if streak >= settings.consecutive_days_checkin and self.kind == "call":
            await safety.log_event("dependency_checkin", user_id=user.id, person_id=person.id, call_id=call.id)
            await self.send({"type": "checkin", "days": streak,
                             "message": f"You've talked with {person.called_name or person.name} {streak} days in a "
                                        f"row. That's okay — and it's also okay to take a day for yourself, or to "
                                        f"call someone who's here with you."})
        asyncio.create_task(self._safe_greet(person, user))
        asyncio.create_task(self.watch_time(person, user))

    async def _safe_greet(self, person: Person, user: User) -> None:
        try:
            await self.greet(person, user)
        except Exception:  # noqa: BLE001 — never leave the caller stuck on "ringing"
            log.exception("greeting failed")
            if not self.connected_at:
                self.connected_at = time.time()
                await self.send({"type": "state", "status": "active", "soft_limit_s": self.soft_limit})
            await self.send({"type": "error", "message": "They're here — say hello."})

    async def greet(self, person: Person, user: User) -> None:
        t0 = time.perf_counter()
        ring_min = 2.8
        try:
            async with SessionLocal() as db:
                if self.kind == "interview":
                    sys = render("interview_v1", user_name=user.display_name, name=person.name,
                                 relationship=person.relationship, call_language_name=LANG_NAME.get(self.lang),
                                 memories="\n".join(f"- {m.text}" for m in (await db.execute(select(MemoryNote).where(
                                     MemoryNote.person_id == person.id).limit(30))).scalars()))
                    hint = (f"Start the memory interview: greet {user.display_name or 'them'} warmly as the app's "
                            f"guide (not as {person.name}), explain in one sentence, and ask your first question.")
                else:
                    sys = await system_prompt(db, person, user, mode=self.kind, language=self.lang, caller=self.caller)
                    hint = greeting_hint(person, user, self.caller)
            res = await llm.chat([{"role": "system", "content": sys}, {"role": "user", "content": hint}],
                                 max_tokens=120, user_id=user.id, call_id=self.call_id, feature="greeting")
            text = clean_reply(res.text)
            if violates_rules(text):
                text = f"{nickname(person, user, self.caller)}… it's so good to see you. How are you?"
        except (ProviderUnavailable, BudgetExceeded):
            text = {"bn": "কেমন আছিস?", "hi": "कैसे हो?"}.get(self.lang, "Hello, my dear. How are you?")
        await self.remember("assistant", _TAGS.sub("", text))
        turn_id = await self.save_turn("assistant", text, {"llm_ms": int((time.perf_counter() - t0) * 1000)})
        wait = ring_min - (time.perf_counter() - t0)
        if wait > 0:
            await asyncio.sleep(wait)
        async with SessionLocal() as db:
            call = await db.get(Call, self.call_id)
            if call and call.status == "ringing":
                call.status, call.connected_at = "active", utcnow()
                await db.commit()
        self.connected_at = time.time()
        await self.send({"type": "state", "status": "active", "soft_limit_s": self.soft_limit})
        await self.speak(turn_id, text, {"t0": t0})

    # ------------------------------------------------------------ speaking
    async def speak(self, turn_id: uuid.UUID, text: str, timings: dict[str, Any],
                    voice: tts.Voice | None = None) -> None:
        voice = voice or self.voice
        assert voice
        caption = _TAGS.sub("", text).strip()
        await self.send({"type": "reply_text", "turn_id": str(turn_id), "text": caption})
        if self.subtitle_lang and tts.script_language(caption, self.lang) != self.subtitle_lang:
            asyncio.create_task(self.subtitle(turn_id, caption))
        sentences = split_sentences(caption)
        voice_lang = tts.script_language(caption, self.tts_lang)
        sem = asyncio.Semaphore(2)
        t_start = time.perf_counter()

        async def one(i: int, s: str) -> tuple[int, Any]:
            async with sem:
                try:
                    return i, await tts.synthesize(s, voice_lang, voice, user_id=self.user_id, call_id=self.call_id,
                                                   force_language=True)
                except (ProviderUnavailable, BudgetExceeded) as e:
                    return i, e

        tasks = [asyncio.create_task(one(i, s)) for i, s in enumerate(sentences)]
        done: dict[int, Any] = {}
        nxt = 0
        first_ms = None
        audio_ids: list[uuid.UUID] = []
        for fut in asyncio.as_completed(tasks):
            i, res = await fut
            done[i] = res
            while nxt in done:
                r = done.pop(nxt)
                if isinstance(r, Exception):
                    await self.send({"type": "reply_audio", "turn_id": str(turn_id), "seq": nxt, "url": None,
                                     "final": nxt == len(sentences) - 1, "error": "voice_unavailable"})
                else:
                    async with SessionLocal() as db:
                        a = await save_asset(db, owner_id=self.user_id, person_id=self.person_id, kind="tts", mime=r.mime,
                                             data=r.audio, ai_generated=True,
                                             meta={"engine": r.engine, "call_id": str(self.call_id)})
                        await db.commit()
                    audio_ids.append(a.id)
                    if first_ms is None:
                        first_ms = int((time.perf_counter() - t_start) * 1000)
                        timings["tts_first_ms"] = first_ms
                        if "t0" in timings:
                            timings["first_audio_ms"] = int((time.perf_counter() - timings["t0"]) * 1000)
                    await self.send({"type": "reply_audio", "turn_id": str(turn_id), "seq": nxt, "url": url(a.id),
                                     "mime": r.mime, "engine": r.engine, "final": nxt == len(sentences) - 1})
                nxt += 1
        timings["tts_total_ms"] = int((time.perf_counter() - t_start) * 1000)
        timings.pop("t0", None)
        turn_audio = await self._merge_audio(audio_ids) if len(audio_ids) > 1 else (audio_ids[0] if audio_ids else None)
        async with SessionLocal() as db:
            t = await db.get(CallTurn, turn_id)
            if t:
                t.timings = {**(t.timings or {}), **timings}
                t.audio_media_id = turn_audio
                await db.commit()
        if settings.lipsync_live and lipsync.available() and audio_ids:
            asyncio.create_task(self.lipsync(turn_id, audio_ids))
        await self.send({"type": "timings", "turn_id": str(turn_id), "timings": timings})

    async def _merge_audio(self, ids: list[uuid.UUID]) -> uuid.UUID | None:
        """One clip per reply (for replay / memory box), joined from the per-sentence clips."""
        from ..models import MediaAsset
        from ..storage import storage
        parts: list[Path] = []
        out = av.tmp(".mp3")
        try:
            async with SessionLocal() as db:
                for i in ids:
                    a = await db.get(MediaAsset, i)
                    if a:
                        parts.append(storage().to_temp(a.storage_key, ".wav" if a.mime == "audio/wav" else ".mp3"))
                args = ["ffmpeg", "-y", "-v", "error"]
                for p in parts:
                    args += ["-i", str(p)]
                args += ["-filter_complex", "".join(f"[{k}:a]" for k in range(len(parts))) +
                         f"concat=n={len(parts)}:v=0:a=1[a]", "-map", "[a]", "-ac", "1", "-b:a", "96k", str(out)]
                await av.run(*args)
                merged = await save_asset(db, owner_id=self.user_id, person_id=self.person_id, kind="tts",
                                          mime="audio/mpeg", path=out, ai_generated=True,
                                          meta={"call_id": str(self.call_id), "merged": len(parts)})
                await db.commit()
                return merged.id
        except Exception:  # noqa: BLE001 — fall back to the first sentence
            return ids[0]
        finally:
            for p in parts:
                p.unlink(missing_ok=True)
            out.unlink(missing_ok=True)

    async def subtitle(self, turn_id: uuid.UUID, text: str) -> None:
        try:
            res = await llm.chat([{"role": "system", "content": f"Translate into {LANG_NAME.get(self.subtitle_lang, self.subtitle_lang)}. "
                                                                 "Translate the meaning into natural, fluent English "
                                                                 "sentences. Only names, nicknames and terms of address stay "
                                                                 "as they are, written in Latin letters (e.g. 'কী রে ছোটো, "
                                                                 "খেয়েছিস?' → 'Hey Chhoto, have you eaten?') — never replace "
                                                                 "them with a different word. Return only the translation."},
                                  {"role": "user", "content": text}], max_tokens=200, temperature=0,
                                 capability="translation", user_id=self.user_id, call_id=self.call_id,
                                 feature="subtitles")
            await self.send({"type": "subtitle", "turn_id": str(turn_id), "text": res.text.strip()})
        except Exception:  # noqa: BLE001
            pass

    async def lipsync(self, turn_id: uuid.UUID, audio_ids: list[uuid.UUID]) -> None:
        t0 = time.perf_counter()
        try:
            video_url = await lipsync.render(self.call_id, turn_id, audio_ids)
            if video_url:
                await self.send({"type": "reply_video", "turn_id": str(turn_id), "url": video_url,
                                 "lipsync_ms": int((time.perf_counter() - t0) * 1000)})
        except Exception as e:  # noqa: BLE001
            log.info("lipsync unavailable: %s", str(e)[:120])

    async def save_turn(self, role: str, text: str, timings: dict[str, Any] | None = None,
                        safety_info: dict[str, Any] | None = None) -> uuid.UUID:
        async with SessionLocal() as db:
            call = await db.get(Call, self.call_id)
            t = CallTurn(call_id=self.call_id, idx=self.turn_idx, role=role,
                         text=text if call and call.store_transcript else None, language=self.lang,
                         timings={k: v for k, v in (timings or {}).items() if k != "t0"},
                         safety=safety_info or {})
            self.turn_idx += 1
            db.add(t)
            await db.commit()
            return t.id

    # --------------------------------------------------------------- turns
    async def handle_audio(self, data_b64: str, mime: str) -> None:
        t0 = time.perf_counter()
        raw = av.tmp(".webm" if "webm" in mime else ".ogg" if "ogg" in mime else ".m4a")
        wav = None
        try:
            raw.write_bytes(base64.b64decode(data_b64))
            wav = await av.to_wav16k(raw)
            dur = await av.duration(wav)
            if dur < 0.4:
                await self.send({"type": "stage", "stage": "idle", "note": "too_short"})
                return
            await self.send({"type": "stage", "stage": "transcribing"})
            res = await stt.transcribe(wav, duration_s=min(dur, 60), language=None if self.lang == "en" else self.lang,
                                       user_id=self.user_id, call_id=self.call_id)
            stt_ms = int((time.perf_counter() - t0) * 1000)
            if not res.text.strip():
                await self.send({"type": "stage", "stage": "idle", "note": "no_speech"})
                return
            await self.handle_text(res.text, {"t0": t0, "stt_ms": stt_ms, "stt_provider": res.provider,
                                              "audio_s": round(dur, 2)}, detected_lang=res.language)
        except (ProviderUnavailable, BudgetExceeded) as e:
            await self.send({"type": "error", "message": "I couldn't hear that clearly — could you type it instead?",
                             "detail": type(e).__name__})
        finally:
            raw.unlink(missing_ok=True)
            if wav:
                wav.unlink(missing_ok=True)

    async def handle_text(self, text: str, timings: dict[str, Any] | None = None,
                          detected_lang: str | None = None) -> None:
        timings = timings or {"t0": time.perf_counter()}
        text = text.strip()[:2000]
        if not text:
            return
        call, person, user = await self.load()
        utid = await self.save_turn("user", text, {k: v for k, v in timings.items() if k != "t0"})
        await self.send({"type": "user_transcript", "turn_id": str(utid), "text": text,
                         "language": detected_lang})
        await self.send({"type": "stage", "stage": "thinking"})
        hist = await self.history()
        async with SessionLocal() as db:
            if self.kind == "interview":
                mems = (await db.execute(select(MemoryNote.text).where(MemoryNote.person_id == person.id)
                                         .order_by(MemoryNote.created_at.desc()).limit(30))).scalars().all()
                sys = render("interview_v1", user_name=user.display_name, name=person.name,
                             relationship=person.relationship, call_language_name=LANG_NAME.get(self.lang),
                             memories="\n".join(f"- {m}" for m in mems))
            else:
                sys = await system_prompt(db, person, user, query=text, mode=self.kind, language=self.lang,
                                          caller=self.caller)
        msgs = [{"role": "system", "content": sys}] + hist + [{"role": "user", "content": text}]
        t_llm = time.perf_counter()
        safety_task = asyncio.create_task(safety.check(text, context=hist, user_id=user.id, call_id=call.id))
        reply_task = asyncio.create_task(llm.chat(msgs, max_tokens=140, temperature=0.75, user_id=user.id,
                                                  call_id=call.id))
        verdict = await safety_task
        timings["safety_ms"] = verdict.timings_ms.get("safety")
        if verdict.pause_call:
            reply_task.cancel()
            await self.crisis(call, person, user, verdict)
            return
        if verdict.abuse:
            reply_task.cancel()
            await safety.log_event("abuse_blocked", user_id=user.id, person_id=person.id, call_id=call.id,
                                   category=verdict.abuse_type, detector=",".join(verdict.detectors))
            line = safety.ABUSE_DECLINES.get(self.lang, safety.ABUSE_DECLINES["en"]).format(
                nick=nickname(person, user, self.caller))
            await self.remember("user", text)
            await self.remember("assistant", line)
            tid = await self.save_turn("assistant", line, timings, verdict.as_dict())
            await self.send({"type": "blocked", "reason": verdict.abuse_type})
            await self.send({"type": "stage", "stage": "speaking"})
            await self.speak(tid, line, timings)
            return
        try:
            res = await reply_task
            reply = clean_reply(res.text)
            timings["llm_ms"] = int((time.perf_counter() - t_llm) * 1000)
            timings["llm_provider"] = res.provider
        except (ProviderUnavailable, BudgetExceeded):
            await self.send({"type": "error", "message": "The line is a little unclear right now. "
                                                        "Please try again in a moment."})
            return
        from .persona import needs_culture
        if needs_culture(person, self.lang) and formal_with_family(reply):
            try:  # one quick rewrite in the family register
                fix = await llm.chat(msgs + [{"role": "assistant", "content": reply},
                                            {"role": "user", "content": "(Rewrite your last reply for the same moment: family "
                                             "never says thank you / ধন্যবাদ — show it with affection or a blessing "
                                             "instead. Reply with the rewritten line only.)"}],
                                     max_tokens=140, user_id=user.id, call_id=call.id)
                if not formal_with_family(fix.text):
                    reply = clean_reply(fix.text)
                    timings["culture_rewrite"] = True
            except (ProviderUnavailable, BudgetExceeded):
                pass
        if violates_rules(reply):
            reply = {"bn": "জানিস, তোর কথা শুনতেই ভালো লাগছে। বল, আর কী হল?",
                     "hi": "तुम्हारी बातें सुनकर अच्छा लग रहा है। और बताओ, क्या चल रहा है?"}.get(
                self.lang, "I just love hearing you talk. Tell me more — what else is happening?")
            timings["rule_filter"] = True
        await self.remember("user", text)
        await self.remember("assistant", _TAGS.sub("", reply))
        if verdict.crisis == "concern":
            timings["wellbeing_concern"] = True
        tid = await self.save_turn("assistant", reply, timings, verdict.as_dict())
        await self.send({"type": "stage", "stage": "speaking"})
        await self.speak(tid, reply, timings)
        if self.kind == "interview":
            asyncio.create_task(self.extract_memories(person, user, text))

    async def extract_memories(self, person: Person, user: User, answer: str) -> None:
        try:
            res = await llm.chat([{"role": "system", "content": render("memory_extract_v1", name=person.name)},
                                  {"role": "user", "content": answer}], max_tokens=200, temperature=0,
                                 json_mode=True, user_id=user.id, feature="interview_extract")
            data = llm.parse_json(res.text)
            async with SessionLocal() as db:
                for n in (data.get("notes") or [])[:3]:
                    if isinstance(n, str) and n.strip():
                        db.add(MemoryNote(person_id=person.id, author_id=user.id, text=n.strip()[:400],
                                          source="interview"))
                p = await db.get(Person, person.id)
                if p:
                    persona = dict(p.persona or {})
                    for key in ("phrases", "nicknames"):
                        new = [x for x in (data.get(key) or []) if isinstance(x, str) and x.strip()]
                        if new:
                            cur = persona.get(key) or []
                            if isinstance(cur, str):
                                cur = [c.strip() for c in cur.split(",") if c.strip()]
                            persona[key] = list(dict.fromkeys([*cur, *new]))[:20]
                    p.persona = persona
                await db.commit()
            await self.send({"type": "memory_saved", "count": len(data.get("notes") or [])})
        except Exception:  # noqa: BLE001
            log.info("memory extraction skipped", exc_info=True)

    async def crisis(self, call: Call, person: Person, user: User, verdict: safety.SafetyVerdict) -> None:
        await safety.log_event("crisis", user_id=user.id, person_id=person.id, call_id=call.id,
                               category=verdict.crisis_type, detector=",".join(verdict.detectors))
        self.paused = True
        async with SessionLocal() as db:
            c = await db.get(Call, call.id)
            if c:
                c.status, c.crisis_paused = "paused", True
                await db.commit()
        line = safety.CRISIS_STEP_OUT.get(self.lang, safety.CRISIS_STEP_OUT["en"])
        await self.send({"type": "crisis", "message": line, "resources": safety.support_resources(user.region)})
        eng, vid = NEUTRAL_VOICE.get(self.lang, NEUTRAL_VOICE["en"])
        tid = await self.save_turn("assistant", line, {}, verdict.as_dict())
        await self.speak(tid, line, {}, voice=tts.Voice(engine=eng, voice_id=vid, gender="f"))

    async def resume(self) -> None:
        self.paused = False
        async with SessionLocal() as db:
            c = await db.get(Call, self.call_id)
            if c and c.status == "paused":
                c.status = "active"
                await db.commit()
        await self.send({"type": "state", "status": "active", "soft_limit_s": self.soft_limit})

    # ------------------------------------------------------------- ending
    async def watch_time(self, person: Person, user: User) -> None:
        while not self.ended:
            await asyncio.sleep(5)
            if not self.connected_at or self.paused:
                continue
            left = self.soft_limit - self.elapsed()
            if left <= 60 and not self.warned:
                self.warned = True
                await self.send({"type": "time_warning", "remaining_s": int(max(left, 0))})
            if left <= 0 and not self.busy:
                await self.goodbye(person, user, reason="time_limit")
                return

    async def goodbye(self, person: Person, user: User, reason: str = "user") -> None:
        if self.ended:
            return
        self.busy = True
        if reason != "crisis" and self.kind != "interview" and self.connected_at:
            try:
                async with SessionLocal() as db:
                    sys = await system_prompt(db, person, user, mode=self.kind, language=self.lang,
                                              caller=self.caller)
                hist = await self.history()
                wrap = render("wrapup_v1", call_language_name=LANG_NAME.get(self.lang), name=person.name,
                              goodbye=(person.persona or {}).get("goodbye", ""), someone_living="the people around you")
                res = await llm.chat([{"role": "system", "content": sys}] + hist +
                                     [{"role": "user", "content": wrap}], max_tokens=90, user_id=user.id,
                                     call_id=self.call_id, feature="goodbye")
                line = clean_reply(res.text)
                if violates_rules(line):
                    line = "Take care of yourself, okay? Eat properly, rest. Bye for now."
                tid = await self.save_turn("assistant", line, {})
                await self.send({"type": "goodbye", "reason": reason})
                await self.speak(tid, line, {})
            except Exception:  # noqa: BLE001
                log.info("goodbye generation failed", exc_info=True)
        await self.finish(reason)

    async def finish(self, reason: str) -> None:
        if self.ended:
            return
        dur = int(self.elapsed())
        charged = 0
        async with SessionLocal() as db:
            call = await db.get(Call, self.call_id)
            if call and call.status != "ended":
                call.status, call.ended_at, call.duration_s, call.end_reason = "ended", utcnow(), dur, reason
                per_min = credit_cost("call_minute") if call.kind != "interview" else credit_cost("interview_minute")
                charged = per_min * max(1, math.ceil(dur / 60)) if dur > 5 else 0
                user = await db.get(User, call.user_id)
                if charged and user:
                    charged = min(charged, max(user.credits, 0))
                    if charged:
                        await adjust(db, call.user_id, -charged, "call_minutes", f"call:{call.id}")
                call.credits_charged = charged
                if call.kind in ("closure", "last_call"):
                    p = await db.get(Person, call.person_id)
                    if p:
                        cl = dict(p.closure or {})
                        cl["sessions_done"] = int(cl.get("sessions_done", 0)) + 1
                        if call.kind == "last_call":
                            cl["completed"] = True
                        p.closure = cl
                await db.commit()
        self.ended = True
        try:
            await self.ws.send_text(json.dumps({"type": "ended", "reason": reason, "duration_s": dur,
                                                "credits": charged}))
        except Exception:  # noqa: BLE001
            pass
        await redis().expire(self.hist_key, 600)
        for t in self.temps:
            t.unlink(missing_ok=True)

    # ---------------------------------------------------------------- loop
    async def _turn(self, msg: dict[str, Any]) -> None:
        try:
            if msg.get("type") == "user_audio":
                await self.handle_audio(str(msg.get("data") or ""), str(msg.get("mime") or "audio/webm"))
            else:
                await self.handle_text(str(msg.get("text") or ""))
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("turn failed")
            await self.send({"type": "error", "message": "Something went quiet on the line. Try again?"})
        finally:
            self.busy = False
            await self.send({"type": "stage", "stage": "idle"})
            if self.pending and not self.ended and not self.paused:
                nxt, self.pending = self.pending, None
                self.busy = True
                self.current = asyncio.create_task(self._turn(nxt))

    async def run(self) -> None:
        await self.start()
        if self.ended:
            return
        call, person, user = await self.load()
        current: asyncio.Task[None] | None = None
        while not self.ended:
            try:
                raw = await self.ws.receive_text()
            except Exception:  # noqa: BLE001 — disconnect
                if current and not current.done():
                    current.cancel()
                await self.finish("disconnected")
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            t = msg.get("type")
            if t == "ping":
                await self.send({"type": "pong", "elapsed": int(self.elapsed())})
            elif t == "end":
                self.pending = None
                current = self.current or current
                if current and not current.done():
                    current.cancel()
                    self.busy = False
                if msg.get("now"):
                    await self.finish("user_now")
                else:
                    asyncio.create_task(self.goodbye(person, user, reason="user"))
            elif t == "resume":
                await self.resume()
            elif t in ("user_audio", "user_text"):
                if self.paused or not self.connected_at:
                    await self.send({"type": "busy"})
                    continue
                if self.busy:
                    # Still answering the last message: keep the newest one and answer it next.
                    self.pending = msg
                    await self.send({"type": "queued"})
                    continue
                self.busy = True
                self.current = asyncio.create_task(self._turn(msg))
                current = self.current


async def safety_counts(db: Any, days: int = 30) -> list[dict[str, Any]]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(select(SafetyEvent.kind, SafetyEvent.category, func.count()).where(
        SafetyEvent.created_at >= since).group_by(SafetyEvent.kind, SafetyEvent.category))).all()
    return [{"kind": k, "category": c, "count": n} for k, c, n in rows]
