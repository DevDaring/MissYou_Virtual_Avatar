"""Brief 4.1: no code path may use AWS or GCP."""
import ast
from pathlib import Path

from app.config import banned_env_names, mask

BANNED = ("boto3", "botocore", "google.cloud", "vertexai", "aiobotocore", "google.auth")
APP = Path(__file__).resolve().parents[1] / "app"


def test_no_module_imports_aws_or_gcp_sdks():
    offenders = []
    for py in APP.rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                if any(n == b or n.startswith(b + ".") for b in BANNED):
                    offenders.append(f"{py.relative_to(APP)}: {n}")
    assert not offenders, offenders


def test_no_aws_or_gcp_endpoints_in_code():
    bad = ("amazonaws.com", "googleapis.com/storage", "aiplatform.googleapis", "texttospeech.googleapis",
           "speech.googleapis")
    hits = [str(p) for p in APP.rglob("*.py") if any(b in p.read_text() for b in bad)]
    assert not hits, hits


def test_banned_env_names_detected_and_masked():
    env = {"AWS_ACCESS_KEY": "x", "GCP_PROJECT": "y", "GOOGLE_APPLICATION_CREDENTIALS": "z", "GEMINI_API_KEY_1": "ok"}
    assert banned_env_names(env) == ["AWS_ACCESS_KEY", "GCP_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"]
    assert mask("sk-abcdef123") == "sk-a…"


def test_settings_never_read_banned_values():
    from app.config import settings
    flat = repr({k: v for k, v in vars(settings).items() if k != "env"})
    for k in banned_env_names(settings.env):
        v = settings.env.get(k)
        if v:
            assert v not in flat
