"""Prices and credit costs from config/pricing.yaml (editable by the owner)."""
from __future__ import annotations

import time
from typing import Any

import yaml

from ..config import settings

_cache: tuple[float, dict[str, Any]] | None = None


def pricing() -> dict[str, Any]:
    global _cache
    path = settings.config_dir / "pricing.yaml"
    mtime = path.stat().st_mtime if path.exists() else 0.0
    if _cache is None or _cache[0] != mtime:
        data = yaml.safe_load(path.read_text()) if path.exists() else {}
        _cache = (mtime, data or {})
    return _cache[1]


def unit_price(provider: str, model: str, unit: str) -> tuple[float, bool]:
    """USD per unit and whether the price is verified (False = UNKNOWN, estimated)."""
    providers = pricing().get("providers", {})
    p = providers.get(provider, {})
    m = p.get(model) or p.get("default") or {}
    v = m.get(unit)
    if v is None:
        return float(pricing().get("unknown_price_fallback_usd", {}).get(unit, 0.0)), False
    known = not bool(m.get("unverified"))
    return float(v), known


def credit_cost(action: str) -> int:
    return int(pricing().get("credits", {}).get(action, 0))


def credit_packs() -> list[dict[str, Any]]:
    return list(pricing().get("packs", []))


def now() -> float:
    return time.time()
