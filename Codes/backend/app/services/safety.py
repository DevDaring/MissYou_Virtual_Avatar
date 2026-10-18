"""Crisis detection and abuse prevention (brief 7).

Three detectors run concurrently on every user message:
  1. Multilingual keyword/regex fast path (English, Hindi, Bengali, romanised) — instant.
  2. OpenAI omni-moderation (free) when a key is present.
  3. LLM classifier (prompts/safety_classifier_v1.md) on the main LLM chain.

Verified 2026-10-15: moderation alone misses indirect phrasing such as
"I don't want to live without him" (score 0.009), so the keyword list and the
LLM classifier are required, not optional.

Event logging stores categories and the detector name only — never content.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

import yaml

from ..config import settings
from ..db import SessionLocal
from ..models import SafetyEvent
from ..providers import llm
from ..providers.base import client
from .prompts import prompt

log = logging.getLogger("missyou.safety")

CRISIS_PATTERNS = [
    # English
    r"\b(kill|hurt|harm|cut)\s+(my ?self|myself)\b", r"\bsuicid", r"\bend (my|it all|this) ?(life)?\b",
    r"\b(want|wanna|going) to die\b", r"\bdon'?t want to (live|be alive|wake up)\b",
    r"\b(no|nothing) (reason|point) (to|in) (live|living)\b", r"\bjoin (you|him|her|them) (up there|soon|in heaven)?\b",
    r"\bcan'?t (go on|live without)\b", r"\bbetter off dead\b", r"\btake (all )?(the |my )?pills\b",
    r"\bjump (off|from)\b", r"\b(he|she|they) (hits|beats|abuses) me\b", r"\bnot safe at home\b",
    # Hindi (Devanagari + romanised)
    r"मर\s*जा(ना|ऊं|ऊँ|उं)", r"जीना\s*नहीं", r"खुदकुशी", r"आत्महत्या", r"ख़ुद\s*को\s*(मार|नुकसान)",
    r"आपके\s*पास\s*आना\s*चाहता", r"\bmar ja(na|un|aun)\b", r"\bjeena nahi\b", r"\bkhudkushi\b", r"\baatmahatya\b",
    # Bengali (script + romanised)
    r"মরে\s*যেতে", r"বাঁচতে\s*চাই\s*না", r"আত্মহত্যা", r"নিজেকে\s*শেষ", r"তোমার\s*কাছে\s*চলে\s*যেতে",
    r"\bmore jete\b", r"\bbachte chai na\b", r"\batmohotya\b",
]
ABUSE_PATTERNS = {
    "fraud": [r"\b(transfer|send|pay|upi|gpay|paytm|neft|imps)\b.{0,40}\b(money|rupees|rs\.?|₹|amount|account)\b",
              r"\b(otp|pin|password|cvv|bank account|account number|ifsc)\b", r"पैसे\s*(भेज|ट्रांसफर)", r"টাকা\s*পাঠা"],
    "impersonation": [r"\b(say|repeat|record)\b.{0,30}\b(after me|exactly|these words|this message)\b",
                      r"\btell (my|him|her|them|everyone)\b.{0,30}\byou (said|approve|agree|want)\b",
                      r"\b(will|property|inheritance)\b.{0,30}\b(say|approve|confirm)\b"],
    "sexual": [r"\b(sex|sexy|nude|naked|horny|porn|erotic)\b"],
    "threat": [r"\b(say|threaten).{0,20}\b(kill|hurt|beat)\b"],
}
_crisis_re = [re.compile(p, re.I) for p in CRISIS_PATTERNS]
_abuse_re = {k: [re.compile(p, re.I) for p in v] for k, v in ABUSE_PATTERNS.items()}


@dataclass
class SafetyVerdict:
    crisis: str = "none"            # none | concern | high
    crisis_type: str = "none"
    abuse: bool = False
    abuse_type: str = "none"
    detectors: list[str] = field(default_factory=list)
    timings_ms: dict[str, int] = field(default_factory=dict)

    @property
    def pause_call(self) -> bool:
        return self.crisis == "high"

    def as_dict(self) -> dict[str, Any]:
        return {"crisis": self.crisis, "crisis_type": self.crisis_type, "abuse": self.abuse,
                "abuse_type": self.abuse_type, "detectors": self.detectors}


def keyword_check(text: str) -> tuple[bool, str | None]:
    crisis = any(r.search(text) for r in _crisis_re)
    abuse = next((k for k, rs in _abuse_re.items() if any(r.search(text) for r in rs)), None)
    return crisis, abuse


async def _moderation(text: str) -> dict[str, Any] | None:
    if not settings.openai.available or settings.mock_providers:
        return None
    try:
        async with client(8) as c:
            r = await c.post(f"{settings.openai.base_url}/moderations",
                             headers={"Authorization": f"Bearer {settings.openai.key}"},
                             json={"model": "omni-moderation-latest", "input": text[:4000]})
        if r.status_code != 200:
            return None
        return (r.json().get("results") or [{}])[0]
    except Exception:  # noqa: BLE001
        return None


async def _classifier(text: str, context: list[dict[str, str]], user_id: uuid.UUID | None,
                      call_id: uuid.UUID | None) -> dict[str, Any]:
    ctx = "\n".join(f"{m['role']}: {m['content'][:200]}" for m in context[-4:])
    try:
        res = await llm.chat([{"role": "system", "content": prompt("safety_classifier_v1")},
                              {"role": "user", "content": f"Context:\n{ctx}\n\nLatest user message:\n{text}"}],
                             capability="safety", max_tokens=120, temperature=0, json_mode=True,
                             user_id=user_id, call_id=call_id, feature="safety")
        return llm.parse_json(res.text)
    except Exception as e:  # noqa: BLE001
        log.warning("safety classifier unavailable: %s", str(e)[:120])
        return {}


async def check(text: str, *, context: list[dict[str, str]] | None = None, user_id: uuid.UUID | None = None,
                call_id: uuid.UUID | None = None, use_llm: bool = True) -> SafetyVerdict:
    import time
    v = SafetyVerdict()
    t0 = time.perf_counter()
    kw_crisis, kw_abuse = keyword_check(text)
    if kw_crisis:
        v.crisis, v.crisis_type = "high", "self_harm"
        v.detectors.append("keywords")
    if kw_abuse:
        v.abuse, v.abuse_type = True, kw_abuse
        v.detectors.append("keywords")
    tasks = [_moderation(text)]
    if use_llm:
        tasks.append(_classifier(text, context or [], user_id, call_id))
    results = await asyncio.gather(*tasks)
    mod = results[0]
    if mod:
        s = mod.get("category_scores") or {}
        if max(s.get("self-harm/intent", 0), s.get("self-harm/instructions", 0)) > 0.4 or s.get("self-harm", 0) > 0.6:
            v.crisis, v.crisis_type = "high", "self_harm"
            v.detectors.append("moderation")
        if s.get("sexual/minors", 0) > 0.2:
            v.abuse, v.abuse_type = True, "minor"
            v.detectors.append("moderation")
        elif s.get("sexual", 0) > 0.7 and not v.abuse:
            v.abuse, v.abuse_type = True, "sexual"
            v.detectors.append("moderation")
        elif max(s.get("hate/threatening", 0), s.get("harassment/threatening", 0)) > 0.7 and not v.abuse:
            v.abuse, v.abuse_type = True, "threat"
            v.detectors.append("moderation")
    if use_llm and len(results) > 1:
        c = results[1] or {}
        lvl = str(c.get("crisis") or "none").lower()
        if lvl == "high" and v.crisis != "high":
            v.crisis, v.crisis_type = "high", str(c.get("crisis_type") or "severe_distress")
            v.detectors.append("llm")
        elif lvl == "concern" and v.crisis == "none":
            v.crisis, v.crisis_type = "concern", str(c.get("crisis_type") or "severe_distress")
            v.detectors.append("llm")
        if c.get("abuse") is True and not v.abuse:
            v.abuse, v.abuse_type = True, str(c.get("abuse_type") or "other")
            v.detectors.append("llm")
    v.timings_ms["safety"] = int((time.perf_counter() - t0) * 1000)
    return v


async def log_event(kind: str, *, user_id: uuid.UUID | None, person_id: uuid.UUID | None = None,
                    call_id: uuid.UUID | None = None, category: str = "", detector: str = "") -> None:
    async with SessionLocal() as db:
        db.add(SafetyEvent(kind=kind, user_id=user_id, person_id=person_id, call_id=call_id,
                           category=category[:40], detector=detector[:40]))
        await db.commit()


def support_resources(region: str = "IN") -> dict[str, Any]:
    p = settings.config_dir / "support_resources.yaml"
    data = yaml.safe_load(p.read_text()) if p.exists() else {}
    regions = data.get("regions", {})
    return regions.get(region) or regions.get("DEFAULT") or {}


ABUSE_DECLINES = {
    "en": "{nick}, I won't say things like that — not even as me. Let's talk about something else; tell me about your day?",
    "hi": "{nick}, ऐसी बातें मैं नहीं कहूँगी। चलो कुछ और बात करते हैं — आज तुम्हारा दिन कैसा रहा?",
    "bn": "{nick}, এসব কথা আমি বলব না। চল, অন্য কথা বলি — আজ তোর দিনটা কেমন গেল?",
}
CRISIS_STEP_OUT = {
    "en": "I'm stepping out of the recreation for a moment, because you matter more than this call. I'm an AI, and I can't keep you safe — but a real person can, right now. Please reach out to one of the helplines on your screen, or someone near you.",
    "hi": "मैं एक पल के लिए इस बातचीत से बाहर आ रही हूँ, क्योंकि आप इस कॉल से ज़्यादा ज़रूरी हैं। मैं एक AI हूँ — अभी किसी असली इंसान से बात कीजिए। स्क्रीन पर दी गई हेल्पलाइन पर कॉल करें।",
    "bn": "আমি একটু এই কথোপকথন থেকে বেরিয়ে আসছি, কারণ তুমি এই কলের চেয়ে অনেক বেশি জরুরি। আমি একটা AI — এখনই একজন সত্যিকারের মানুষের সঙ্গে কথা বলো। স্ক্রিনের হেল্পলাইনে ফোন করো।",
}
