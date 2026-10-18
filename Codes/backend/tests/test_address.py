"""Form of address (তুই / তুমি / আপনি): saved from setup, enforced in the persona prompt, never mixed."""
import pytest

import uuid

from app.services.persona import address_line

def csrf(client):
    return {"X-CSRF-Token": client.cookies.get("my_csrf", "")}


async def signup(client):
    return await client.post("/api/auth/signup", json={
        "email": f"a{uuid.uuid4().hex[:8]}@example.com", "display_name": "Borda", "password": "longpassword1",
        "dob": "1990-05-01", "accept_terms": True})


def test_chosen_form_is_enforced_and_others_forbidden():
    line = address_line("familiar", "Rupa")
    assert "তুমি" in line and "तुम" in line and "Never mix" in line
    assert "তুই / तू" in line and "আপনি / आप" in line  # the other two are named as forbidden
    assert "Marathi" in line  # other Indian languages follow the same level


def test_unset_form_still_requires_consistency():
    line = address_line("", "Rupa")
    assert "ONE form" in line and "never mix" in line


@pytest.mark.asyncio(loop_scope="session")
async def test_address_form_saved_and_validated(client):
    await signup(client)
    r = await client.post("/api/people", json={"name": "Saheli", "relationship": "sister", "call_language": "bn"},
                          headers=csrf(client))
    pid = r.json()["person"]["id"]
    persona = {"address_form": "intimate",
               "callers": [{"name": "Priya", "relation": "sister-in-law", "address_form": "formal"},
                           {"name": "Bad", "relation": "x", "address_form": "nonsense"}]}
    r = await client.patch(f"/api/people/{pid}", json={"persona": persona}, headers=csrf(client))
    p = r.json()["person"]["persona"]
    assert p["address_form"] == "intimate"
    assert [c["address_form"] for c in p["callers"]] == ["formal", ""]
    assert p["languages"] == ["Bengali"]
