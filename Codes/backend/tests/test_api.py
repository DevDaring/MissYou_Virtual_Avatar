"""Integration: auth, consent, upload, refusals, budget caps — mocked providers."""
import io
import uuid

import pytest
from PIL import Image

pytestmark = pytest.mark.asyncio(loop_scope="session")


def csrf(client):
    return {"X-CSRF-Token": client.cookies.get("my_csrf", "")}


async def signup(client, dob="1990-05-01"):
    email = f"u{uuid.uuid4().hex[:8]}@example.com"
    return await client.post("/api/auth/signup", json={"email": email, "display_name": "Asha", "password": "longpassword1",
                                                       "dob": dob, "accept_terms": True})


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["db"]


async def test_under_18_blocked(client):
    r = await signup(client, dob="2012-01-01")
    assert r.status_code == 403 and r.json()["detail"] == "under_18"


async def test_full_setup_flow(client):
    r = await signup(client)
    assert r.status_code == 200
    me = r.json()["user"]
    assert me["credits"] > 0
    # CSRF is enforced on writes
    r = await client.post("/api/people", json={"name": "Ma"})
    assert r.status_code == 403
    r = await client.post("/api/people", json={"name": "Anjali", "called_name": "Ma", "relationship": "mother"},
                          headers=csrf(client))
    pid = r.json()["person"]["id"]
    # Upload refused before consent
    r = await client.post(f"/api/people/{pid}/uploads", json={"filename": "a.jpg", "size": 100}, headers=csrf(client))
    assert r.status_code == 403
    st = (await client.get("/api/consent/media")).json()["statements"]
    r = await client.post(f"/api/people/{pid}/consent", json={"statements": st}, headers=csrf(client))
    assert r.status_code == 200
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), (180, 140, 120)).save(buf, "JPEG")
    data = buf.getvalue()
    r = await client.post(f"/api/people/{pid}/uploads", json={"filename": "a.jpg", "size": len(data)},
                          headers=csrf(client))
    sid = r.json()["upload_id"]
    half = len(data) // 2
    r = await client.put(f"/api/uploads/{sid}?offset=0", content=data[:half], headers=csrf(client))
    assert r.json()["received"] == half
    r = await client.put(f"/api/uploads/{sid}?offset=0", content=data[half:], headers=csrf(client))
    assert r.json().get("resync")  # wrong offset is refused, client resumes
    r = await client.put(f"/api/uploads/{sid}?offset={half}", content=data[half:], headers=csrf(client))
    r = await client.post(f"/api/uploads/{sid}/complete", headers=csrf(client))
    assert r.status_code == 200, r.text
    media = r.json()["media"]
    assert media["kind"] == "photo"
    # The media link is signed and works
    r = await client.get(media["url"])
    assert r.status_code == 200 and r.content[:2] == b"\xff\xd8"
    r = await client.get(media["url"].split("?")[0] + "?exp=1&sig=bad")
    assert r.status_code == 403
    # A call needs a ready scene first
    r = await client.post("/api/calls", json={"person_id": pid}, headers=csrf(client))
    assert r.status_code == 400
    # Export and delete with report
    r = await client.get("/api/me/export")
    assert r.status_code == 200 and r.content[:2] == b"PK"
    r = await client.delete(f"/api/people/{pid}?confirm=Anjali", headers=csrf(client))
    assert r.status_code == 200
    rep = r.json()["report"]
    assert rep["local"]["media_records"] >= 1 and rep["local"]["person_profile"] == 1


async def test_budget_cap_stops_spending(client):
    from app.models import AdminSetting
    from app.db import SessionLocal
    from app.services.metering import BudgetExceeded, metered
    async with SessionLocal() as db:
        db.add(AdminSetting(key="budget_caps", value={"global_daily": 0.01}))
        await db.commit()
    async with metered(provider="xai", capability="scene_image", model="m", est_usd=0.005) as m:
        m.cost_usd = 0.009
    with pytest.raises(BudgetExceeded):
        async with metered(provider="xai", capability="scene_image", model="m", est_usd=0.005):
            pass
    # a live call keeps working: conversation has its own budget
    async with metered(provider="openai", capability="conversation", model="m", est_usd=0.002) as m:
        m.cost_usd = 0.001
    async with SessionLocal() as db:
        row = await db.get(AdminSetting, "budget_caps")
        await db.delete(row)
        await db.commit()


async def test_admin_requires_admin(client):
    await signup(client)
    r = await client.get("/api/admin/overview")
    assert r.status_code == 403
