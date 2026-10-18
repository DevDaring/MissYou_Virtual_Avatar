"""Persona → system prompt, plus memory-note retrieval for calls."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MemoryNote, Person, SpeakerClip, User
from .prompts import render

LANG_NAME = {"en": "English", "bn": "Bengali (বাংলা)", "hi": "Hindi (हिन्दी)"}

PERSONA_FIELDS = ["speech_style", "phrases", "nicknames", "greeting", "goodbye", "humour", "topics_loved",
                  "topics_avoid", "languages", "code_mix", "heaven_framing", "use_transcripts", "outfit_style"]


def _join(v: Any) -> str:
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if str(x).strip())
    return str(v or "").strip()


async def relevant_memories(db: AsyncSession, person_id: uuid.UUID, query: str, limit: int = 10) -> list[str]:
    total = (await db.execute(select(func.count()).select_from(MemoryNote)
                              .where(MemoryNote.person_id == person_id))).scalar_one()
    q = select(MemoryNote.text).where(MemoryNote.person_id == person_id)
    if total <= limit or not query.strip():
        rows = (await db.execute(q.order_by(MemoryNote.pinned.desc(), MemoryNote.created_at.desc())
                                 .limit(limit))).scalars().all()
        return list(rows)
    tsq = func.plainto_tsquery("simple", query)
    tsv = func.to_tsvector("simple", MemoryNote.text)
    rank = func.ts_rank(tsv, tsq)
    rows = (await db.execute(q.where(or_(MemoryNote.pinned.is_(True), tsv.op("@@")(tsq), literal(True)))
                             .order_by(MemoryNote.pinned.desc(), rank.desc(), MemoryNote.created_at.desc())
                             .limit(limit))).scalars().all()
    return list(rows)


async def style_examples(db: AsyncSession, person: Person, n: int = 4) -> list[str]:
    if not (person.persona or {}).get("use_transcripts", True):
        return []
    rows = (await db.execute(select(SpeakerClip.transcript).where(
        SpeakerClip.person_id == person.id, SpeakerClip.confirmed.is_(True),
        func.length(SpeakerClip.transcript) > 8).limit(n))).scalars().all()
    return [r[:200] for r in rows]


CULTURE_BLOCK = """## Family etiquette (a Bengali / Indian home)
- Family never thanks each other formally. **Never say "ধন্যবাদ", "Thank you", "Thanks" (or "धन्यवाद", "शुक्रिया")** — that is for outsiders. Show it with affection, pride or a blessing instead: "বাহ্, খুব ভালো করেছিস", "বেঁচে থাক", "ভালো থাকিস", "আশীর্বাদ করি", "সোনা আমার".
- No formal "sorry" or "please" between family either ("থাক, ঠিক আছে", "শোন না", "একটু কর তো"). Never use আপনি / आप for your own children or younger family.
- Elders bless rather than thank, show love through care (food, rest, health, "সাবধানে থাকিস") more than through words like "I love you", and keep warm, everyday Kolkata-home phrasing."""

_CULTURE_LANGS = ("bengali", "bangla", "বাংলা", "hindi", "हिन्दी")


def needs_culture(person: Person, language: str | None = None) -> bool:
    spoken = " ".join(str(x) for x in ((person.persona or {}).get("languages") or [])).lower()
    lang = (language or person.call_language or "en")[:2]
    return lang in ("bn", "hi") or any(k in spoken for k in _CULTURE_LANGS)


def caller_name(user: User, caller: dict[str, Any] | None) -> str:
    return (caller or {}).get("name") or user.display_name or "the user"


def nickname(person: Person, user: User, caller: dict[str, Any] | None = None) -> str:
    if caller:
        nick = str(caller.get("nickname") or "").split(",")[0].strip()
        return nick or str(caller.get("name") or "dear")
    nicks = (person.persona or {}).get("nicknames")
    if isinstance(nicks, list) and nicks:
        return str(nicks[0])
    if isinstance(nicks, str) and nicks.strip():
        return nicks.split(",")[0].strip()
    return user.display_name or "dear"


async def system_prompt(db: AsyncSession, person: Person, user: User, *, query: str = "", mode: str = "call",
                        language: str | None = None, caller: dict[str, Any] | None = None) -> str:
    p = person.persona or {}
    lang = language or person.call_language or "en"
    mems = await relevant_memories(db, person.id, query)
    styles = await style_examples(db, person)
    if person.life_status == "far":
        life = (f"{person.name} is alive but far away from {user.display_name or 'the user'}. This is a recreation "
                "to ease the distance — never say they have died; encourage real contact with them too.")
        framing = "Do not talk about death or the afterlife at all."
    else:
        life = (f"{person.name} has passed away. Be tender about the loss; do not pretend nothing happened, "
                "and do not describe being dead or anywhere after death.")
        framing = ("The user has explicitly allowed gentle, respectful spiritual framing; you may say you live on "
                   "in their memories and love, but still never claim real contact."
                   if p.get("heaven_framing") else "The default applies: no afterlife or spiritual-contact language.")
    mode_block = ""
    if mode == "closure":
        mode_block = ("## This is part of a closure journey\nGently make room for things left unsaid. Invite the "
                      "user to say what they wish they had said. Receive it with love.")
    elif mode == "last_call":
        mode_block = ("## This is the last call of the closure journey\nThis is a goodbye designed with care. Let the "
                      "user say what was unsaid; receive it; give a loving, peaceful goodbye that releases them, "
                      "affirms their life ahead, and encourages them to lean on the living people around them.")
    code_mix = p.get("code_mix")
    who = caller_name(user, caller)
    nicks, called, rel, greeting = _join(p.get("nicknames")), person.called_name or person.name, \
        person.relationship or "loved one", _join(p.get("greeting"))
    if caller:
        nicks = str(caller.get("nickname") or "") or who
        called = str(caller.get("calls_them") or "") or called
        rel = str(caller.get("relation") or "") or "family member"
        greeting = (f"their usual greeting for {user.display_name} was \"{greeting}\" — adapt it warmly for {who}"
                    if greeting else "")
        mode_block = (f"## Who is calling today\nToday you are talking with **{who}**, not with "
                      f"{user.display_name or 'the person who set this up'}. {person.name} is {who}'s {rel}. "
                      f"{user.display_name or 'The account owner'} — whose {person.relationship or 'loved one'} "
                      f"{person.name} is — shared the memories above. Speak to {who} the way {person.name} would "
                      f"speak to them, call them \"{nicks}\", and never use {user.display_name}'s nicknames for "
                      f"{who}. You may ask warmly about {user.display_name}."
                      + (f"\n\nWhat {who} and {person.name} shared, and love to talk about (told to us by "
                         f"{who} — treat these as real memories you may refer to):\n{caller.get('notes')}"
                         if str(caller.get("notes") or "").strip() else "")
                      + "\n\n" + mode_block)
    return render(
        "persona_v1",
        name=person.name or "them", user_name=who,
        called_name=called, relationship=rel,
        age=person.age or "unknown", gender=person.gender or "unspecified", life_status_line=life,
        languages=_join(p.get("languages")) or LANG_NAME.get(lang, lang),
        call_language_name=LANG_NAME.get(lang, lang),
        code_mix_line=(f", mixing in {_join(code_mix)} the way they did" if code_mix else ""),
        speech_style=_join(p.get("speech_style")), phrases=_join(p.get("phrases")),
        nicknames=nicks, greeting=greeting, goodbye=_join(p.get("goodbye")),
        humour=_join(p.get("humour")), topics_loved=_join(p.get("topics_loved")),
        topics_avoid=_join(p.get("topics_avoid")) or "none listed",
        memories="\n".join(f"- {m}" for m in mems) or "- (none shared yet — invite them to share)",
        style_examples="\n".join(f'- "{s}"' for s in styles) or "- (none)",
        framing_rule=framing, mode_block=mode_block,
        culture_block=CULTURE_BLOCK if needs_culture(person, lang) else "",
    )


def greeting_hint(person: Person, user: User, caller: dict[str, Any] | None = None) -> str:
    p = person.persona or {}
    g = "" if caller else _join(p.get("greeting"))
    nick = nickname(person, user, caller)
    return (f"The call has just connected. Greet {nick} the way {person.name} typically did"
            + (f" (\"{g}\")" if g else "") + ". One or two short sentences, then ask how they are.")
