from __future__ import annotations

import logging

import httpx

log = logging.getLogger("missyou.providers")


class ProviderError(RuntimeError):
    def __init__(self, provider: str, kind: str, message: str, status: int | None = None) -> None:
        super().__init__(f"{provider}: {kind}: {message}")
        self.provider, self.kind, self.status = provider, kind, status


class ProviderUnavailable(ProviderError):
    """No configured provider can serve this capability right now."""


def classify(status: int) -> str:
    if status in (401, 403):
        return "auth"
    if status == 402:
        return "no_credit"
    if status == 429:
        return "rate_limited"
    if status >= 500:
        return "server"
    return "bad_request"


def raise_for(provider: str, resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    # Body excerpt only; providers never echo our key back.
    raise ProviderError(provider, classify(resp.status_code), resp.text[:240], resp.status_code)


def client(timeout: float = 60.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0))
