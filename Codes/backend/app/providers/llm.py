"""Conversation / classification LLM over an ordered fallback chain.

Chain (brief 4.3): LinkAPI (ChatGPT) → OpenAI → Anthropic → OpenRouter →
DeepSeek → Gemini. An admin may pin a different primary per capability
(admin_settings 'provider_primary'). Every attempt is metered.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any

from ..config import Endpoint, settings
from ..services.metering import BudgetExceeded, metered
from .base import ProviderError, ProviderUnavailable, client, raise_for

log = logging.getLogger("missyou.llm")


@dataclass
class LlmResult:
    text: str
    provider: str
    model: str
    tokens_in: int
    tokens_out: int
    latency_ms: int = 0


def _approx_tokens(messages: list[dict[str, Any]]) -> int:
    n = 0
    for m in messages:
        c = m.get("content")
        if isinstance(c, str):
            n += len(c) // 3
        elif isinstance(c, list):
            n += sum(len(p.get("text", "")) // 3 + (800 if p.get("type") == "image_url" else 0) for p in c)
    return n


async def _openai_compat(ep: Endpoint, messages: list[dict[str, Any]], *, model: str, max_tokens: int,
                         temperature: float, json_mode: bool) -> tuple[str, int, int]:
    body: dict[str, Any] = {"model": model, "messages": messages}
    if model.startswith(("gpt-5", "o3", "o4")):
        # GPT-5 family: no temperature; completion budget covers Bengali's heavier tokenisation.
        body["max_completion_tokens"] = max_tokens * 2 + 120
        body["reasoning_effort"] = "none"
    else:
        body.update({"temperature": temperature, "max_tokens": max_tokens})
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {ep.key}"}
    if ep.name == "openrouter":
        headers.update({"HTTP-Referer": settings.public_url, "X-Title": "Miss You"})
    async with client(45) as c:
        r = await c.post(f"{ep.base_url.rstrip('/')}/chat/completions", json=body, headers=headers)
        if r.status_code == 400 and "reasoning_effort" in r.text and "reasoning_effort" in body:
            body["reasoning_effort"] = "minimal"
            r = await c.post(f"{ep.base_url.rstrip('/')}/chat/completions", json=body, headers=headers)
        if r.status_code == 400 and json_mode and "response_format" in r.text:
            body.pop("response_format")
            r = await c.post(f"{ep.base_url.rstrip('/')}/chat/completions", json=body, headers=headers)
    raise_for(ep.name, r)
    data = r.json()
    choice = (data.get("choices") or [{}])[0]
    text = ((choice.get("message") or {}).get("content")) or ""
    usage = data.get("usage") or {}
    return text, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


async def _anthropic(ep: Endpoint, messages: list[dict[str, Any]], *, model: str, max_tokens: int,
                     temperature: float) -> tuple[str, int, int]:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system" and isinstance(m["content"], str))
    conv: list[dict[str, Any]] = []
    for m in messages:
        if m["role"] == "system":
            continue
        content = m["content"]
        if isinstance(content, list):  # convert OpenAI image parts
            parts: list[dict[str, Any]] = []
            for p in content:
                if p.get("type") == "text":
                    parts.append({"type": "text", "text": p["text"]})
                elif p.get("type") == "image_url":
                    u = p["image_url"]["url"]
                    mt, _, b64 = u.partition(";base64,")
                    parts.append({"type": "image", "source": {"type": "base64", "media_type": mt[5:], "data": b64}})
            content = parts
        conv.append({"role": m["role"], "content": content})
    body = {"model": model, "max_tokens": max_tokens, "temperature": temperature, "system": system,
            "messages": conv}
    headers = {"x-api-key": ep.key, "anthropic-version": "2023-06-01"}
    async with client(45) as c:
        r = await c.post(f"{ep.base_url.rstrip('/')}/messages", json=body, headers=headers)
    raise_for(ep.name, r)
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    u = data.get("usage") or {}
    return text, int(u.get("input_tokens") or 0), int(u.get("output_tokens") or 0)


def _mock(messages: list[dict[str, Any]], json_mode: bool) -> str:
    last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    if json_mode:
        return json.dumps({"crisis": False, "abuse": False, "category": "none", "famous": False})
    return f"(mock) I hear you. Tell me more about that — {str(last)[:40]}"


async def chain_for(capability: str) -> list[Endpoint]:
    from ..services.flags import provider_primary  # local import: avoid cycle
    from .registry import health_map
    try:
        health = await health_map()
    except Exception:  # noqa: BLE001 — redis down: use every configured provider
        health = {}
    chain = [e for e in settings.llm_chain if e.available and health.get(e.name, {}).get("status") != "down"]
    pinned = await provider_primary(capability)
    if pinned:
        chain.sort(key=lambda e: 0 if e.name == pinned else 1)
    return chain


async def chat(messages: list[dict[str, Any]], *, capability: str = "conversation", max_tokens: int = 300,
               temperature: float = 0.7, json_mode: bool = False, user_id: uuid.UUID | None = None,
               call_id: uuid.UUID | None = None, feature: str = "call",
               needs_vision: bool = False) -> LlmResult:
    if settings.mock_providers:
        return LlmResult(_mock(messages, json_mode), "mock", "mock", 0, 0)
    chain = await chain_for(capability)
    if needs_vision:
        chain = [e for e in chain if e.name not in ("deepseek",)]
    if not chain:
        raise ProviderUnavailable("llm", "none", "no LLM provider configured")
    errors: list[str] = []
    for ep in chain:
        model = ep.model
        if ep.name == "openai":
            if capability in ("safety", "translation"):
                model = settings.openai_fast_model  # must stay fast: runs before/alongside speaking
            elif feature == "letter":
                model = settings.openai_letter_model  # async: best quality
        est_in = _approx_tokens(messages)
        try:
            async with metered(provider=ep.name, capability=capability, model=model, est_usd=0.002,
                               user_id=user_id, call_id=call_id, feature=feature, unit_type="tokens") as m:
                if ep.kind == "anthropic":
                    text, tin, tout = await _anthropic(ep, messages, model=model, max_tokens=max_tokens,
                                                       temperature=temperature)
                else:
                    text, tin, tout = await _openai_compat(ep, messages, model=model, max_tokens=max_tokens,
                                                           temperature=temperature, json_mode=json_mode)
                tin = tin or est_in
                tout = tout or len(text) // 3
                from ..services.pricing import unit_price
                pin, _ = unit_price(ep.name, model, "input_mtok")
                pout, known = unit_price(ep.name, model, "output_mtok")
                m.units, m.unit_type = tin + tout, "tokens"
                m.cost_usd = (tin * pin + tout * pout) / 1_000_000 if known else None
            if not text.strip():
                raise ProviderError(ep.name, "empty", "empty completion")
            return LlmResult(text.strip(), ep.name, model, tin, tout)
        except BudgetExceeded:
            raise
        except Exception as e:  # noqa: BLE001 — fall through the chain
            log.warning("LLM %s/%s failed: %s", ep.name, model, str(e)[:160])
            errors.append(f"{ep.name}: {str(e)[:80]}")
    raise ProviderUnavailable("llm", "all_failed", "; ".join(errors))


_JSON = re.compile(r"\{.*\}", re.S)


def parse_json(text: str) -> dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{"):]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = _JSON.search(t)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {}
