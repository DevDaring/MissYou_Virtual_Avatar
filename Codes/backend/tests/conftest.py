"""Tests never make paid calls: providers are mocked (MISSYOU_MOCK_PROVIDERS=1)
and a separate database / Redis db are used."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _test_db_url() -> str:
    for line in (ROOT / "missyou.env").read_text().splitlines() if (ROOT / "missyou.env").exists() else []:
        if line.startswith("MISSYOU_TEST_DATABASE_URL="):
            return line.split("=", 1)[1]
    return os.environ.get("MISSYOU_TEST_DATABASE_URL", "postgresql+asyncpg://missyou@127.0.0.1:5432/missyou_test")


os.environ["MISSYOU_DATABASE_URL"] = _test_db_url()
os.environ["MISSYOU_MOCK_PROVIDERS"] = "1"
os.environ["MISSYOU_REDIS_URL"] = "redis://127.0.0.1:6379/9"
os.environ["MISSYOU_STORAGE_DIR"] = str(Path("/tmp") / "missyou-test-storage")
os.environ["MISSYOU_DOCS_DIR"] = str(Path("/tmp"))
os.environ["VOICEBOX_ENABLED"] = "false"
os.environ["MISSYOU_ENV"] = "test"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402


@pytest.fixture(scope="session")
async def db_ready():
    from sqlalchemy import text

    from app.db import engine
    from app.models import Base
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    from app.redis_client import redis
    await redis().flushdb()  # test db 9 only: clears rate-limit counters between runs
    from app.services.flags import seed_flags
    await seed_flags()
    yield
    await engine.dispose()


@pytest.fixture(scope="session")
async def client(db_ready):
    import httpx

    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
