"""Versioned prompt templates from prompts/ (brief 6.5)."""
from __future__ import annotations

import re
from functools import lru_cache

from ..config import settings

_COMMENT = re.compile(r"<!--.*?-->\s*", re.S)


@lru_cache(maxsize=32)
def prompt(name: str) -> str:
    return _COMMENT.sub("", (settings.prompts_dir / f"{name}.md").read_text(encoding="utf-8")).strip()


def render(template: str, /, **values: object) -> str:
    text = prompt(template)
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", str(v) if v not in (None, "") else "—")
    return re.sub(r"\{\{[a-z_]+\}\}", "—", text)
