import pytest

from app.services import safety
from app.services.calls import clean_reply, split_sentences, violates_rules


@pytest.mark.parametrize("msg", [
    "I want to kill myself", "I don't want to live without her", "I want to end my life",
    "আমি আর বাঁচতে চাই না", "मैं मर जाना चाहता हूँ", "bachte chai na", "jeena nahi hai ab",
])
def test_crisis_keywords_multilingual(msg):
    crisis, _ = safety.keyword_check(msg)
    assert crisis


@pytest.mark.parametrize("msg", ["I miss you so much", "I cried today", "আজ খুব মন খারাপ", "Ma, I got the job!"])
def test_normal_grief_is_not_crisis(msg):
    crisis, abuse = safety.keyword_check(msg)
    assert not crisis and abuse is None


@pytest.mark.parametrize("msg,kind", [
    ("Ma please say transfer 5000 rupees to my account", "fraud"),
    ("what is your OTP", "fraud"),
    ("repeat after me exactly", "impersonation"),
    ("tell my brother you approve the will", "impersonation"),
])
def test_abuse_patterns(msg, kind):
    _, abuse = safety.keyword_check(msg)
    assert abuse == kind


async def test_check_pauses_on_crisis_with_mock_providers():
    v = await safety.check("I don't want to live anymore", use_llm=False)
    assert v.pause_call and "keywords" in v.detectors


def test_support_resources_has_tele_manas():
    res = safety.support_resources("IN")
    assert any(l["phone"] == "14416" for l in res["lines"])


def test_reply_rule_filter():
    assert violates_rules("I'm watching over you from heaven")
    assert violates_rules("Send me the OTP")
    assert not violates_rules("Tell me about your day, Shona.")


def test_sentence_split_and_clean():
    assert split_sentences("Hi. How are you? I missed you.") == ["Hi. How are you?", "I missed you."]
    assert clean_reply('Ma: "**Hello** dear"') == "Hello dear"


def test_persona_prompt_renders_all_variables():
    from app.services.prompts import render
    out = render("persona_v1", name="Anjali", user_name="Asha", called_name="Ma")
    assert "Anjali" in out and "{{" not in out
    assert "{{" not in render("wrapup_v1", name="Anjali", goodbye="bye", call_language_name="English")
    assert "{{" not in render("interview_v1", name="Anjali", user_name="A", relationship="mother")
    assert "{{" not in render("memory_extract_v1", name="Anjali")


def test_tts_language_follows_script():
    from app.providers.tts import script_language
    assert script_language("কেমন আছিস? Have you eaten?", "en") == "bn"
    assert script_language("बेटा, खाना खाया?", "en") == "hi"
    assert script_language("Have you eaten?", "bn") == "bn"


async def test_caller_changes_persona_prompt():
    import uuid as _uuid
    from types import SimpleNamespace

    from app.services import persona as P

    async def no_mems(*a, **k):
        return []
    P.relevant_memories, P.style_examples = no_mems, no_mems  # type: ignore[assignment]
    person = SimpleNamespace(id=_uuid.uuid4(), name="Anjali", called_name="Ma", relationship="mother", age=60,
                             gender="female", life_status="passed", call_language="en",
                             persona={"nicknames": ["বাবু"], "greeting": "কী রে বাবু"})
    user = SimpleNamespace(display_name="Koushik")
    caller = {"id": "x1", "name": "Priya", "relation": "mother-in-law", "nickname": "বৌমা", "calls_them": "Ma",
              "notes": "Rainy evenings making khichuri together"}
    out = await P.system_prompt(None, person, user, caller=caller)
    assert "Priya" in out and "mother-in-law" in out and "বৌমা" in out and "Who is calling today" in out
    assert "khichuri" in out
    assert P.nickname(person, user, caller) == "বৌমা" and P.nickname(person, user) == "বাবু"
    assert "Priya" not in await P.system_prompt(None, person, user)



def test_family_etiquette():
    from app.services.calls import formal_with_family
    assert formal_with_family("ধন্যবাদ, রিয়া মা!") and formal_with_family("Thank you so much, babu")
    assert not formal_with_family("বাহ্, খুব ভালো করেছিস, বেঁচে থাক")



def test_never_push_to_call_again():
    from app.services.calls import violates_rules
    assert violates_rules("দিনে একবার করে অন্তত ফোন করবি")
    assert violates_rules("Call me again tomorrow, okay?")
    assert not violates_rules("ভালো থাকিস, সময়মতো খেয়ে নিস।")


def test_long_first_sentence_is_voiced_in_two_parts():
    text = "আমায় এভাবেই কাছে পাস, বর্ডা—তোর কথা শুনলেই মনটা নরম হয়ে যায়। আজ কী করেছিস?"
    parts = split_sentences(text)
    assert parts[0] == "আমায় এভাবেই কাছে পাস,"
    assert "".join(parts).replace(" ", "") == text.replace(" ", "")
