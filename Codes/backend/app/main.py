"""Miss You API (FastAPI)."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .providers import registry, voice_engine
from .routers import admin, auth, calls, me, people, public
from .security import CSRF_COOKIE, CSRF_HEADER
from .services import flags


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"), "level": record.levelname,
               "logger": record.name, "msg": record.getMessage()}
        rid = getattr(record, "request_id", None)
        if rid:
            out["request_id"] = rid
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)[-2000:]
        return json.dumps(out, ensure_ascii=False)


def setup_logging() -> None:
    h = logging.StreamHandler()
    h.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(logging.INFO)
    for noisy in ("httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


setup_logging()
log = logging.getLogger("missyou.api")


async def _voice_engine_watch() -> None:
    while True:
        await voice_engine.health()
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await flags.seed_flags()
    from .seed import ensure_demo
    try:
        await ensure_demo()
    except Exception:  # noqa: BLE001
        log.exception("demo seed failed")
    tasks = [asyncio.create_task(_voice_engine_watch()), asyncio.create_task(registry.periodic(900))]
    try:
        await registry.refresh(write_report=True)
    except Exception:  # noqa: BLE001
        log.exception("provider report failed")
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Miss You API", version="1.0.0", lifespan=lifespan,
              docs_url=None if settings.is_prod else "/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=[settings.public_url], allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["*"])

CSRF_EXEMPT = ("/api/auth/login", "/api/auth/signup", "/api/auth/otp/request", "/api/auth/otp/verify")


@app.middleware("http")
async def guard(request: Request, call_next):  # type: ignore[no-untyped-def]
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/") \
            and request.url.path not in CSRF_EXEMPT:
        cookie = request.cookies.get(CSRF_COOKIE)
        header = request.headers.get(CSRF_HEADER)
        if not cookie or not header or cookie != header:
            return JSONResponse({"detail": "csrf_failed"}, status_code=403)
    try:
        resp = await call_next(request)
    except Exception:
        log.exception("unhandled error", extra={"request_id": rid})
        return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)
    resp.headers["X-Request-Id"] = rid
    ms = int((time.perf_counter() - t0) * 1000)
    if not request.url.path.startswith("/api/media/"):
        log.info("%s %s %s %dms", request.method, request.url.path, resp.status_code, ms,
                 extra={"request_id": rid})
    return resp


for r in (public.router, auth.router, me.router, people.router, calls.router, admin.router):
    app.include_router(r)
