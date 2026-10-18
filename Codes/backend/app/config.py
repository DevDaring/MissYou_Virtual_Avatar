"""Settings for Miss You.

Two env files are read, later ones overriding earlier ones:

  <root>/.env          provider keys (may contain many unrelated keys)
  <root>/missyou.env   this app's own settings (database, secrets, caps)

`<root>` is MISSYOU_ROOT if set, else the parent of `backend/`. Real process
environment variables override both. Values are never logged; use `mask()`.

AWS and GCP are banned outright (brief 4.1): any env name with a banned
prefix is reported once at startup and then ignored — no setting below reads
one, and tests/test_ban.py fails if any module imports their SDKs.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("missyou.config")

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("MISSYOU_ROOT") or BACKEND_DIR.parent)
BANNED_PREFIXES = ("AWS_", "GOOGLE_CLOUD_", "GCP_", "GCLOUD_", "GOOGLE_APPLICATION_CREDENTIALS")


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:]
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        if k:
            out[k] = v
    return out


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for name in (".env", "missyou.env"):
        env.update(_parse_env_file(ROOT / name))
    env.update({k: v for k, v in os.environ.items()})
    return env


def banned_env_names(env: dict[str, str]) -> list[str]:
    return sorted(k for k in env if k.upper().startswith(BANNED_PREFIXES))


def mask(value: str | None) -> str:
    if not value:
        return "(unset)"
    return value[:4] + "…"


@dataclass(frozen=True)
class Endpoint:
    """One OpenAI-compatible (or native) API account."""
    name: str
    base_url: str
    model: str
    keys: tuple[str, ...]
    kind: str = "openai"  # openai | anthropic

    @property
    def available(self) -> bool:
        return any(self.keys)

    @property
    def key(self) -> str:
        return next((k for k in self.keys if k), "")


def _f(env: dict[str, str], name: str, default: float) -> float:
    try:
        return float(env.get(name, default))
    except ValueError:
        return default


def _i(env: dict[str, str], name: str, default: int) -> int:
    try:
        return int(float(env.get(name, default)))
    except ValueError:
        return default


def _b(env: dict[str, str], name: str, default: bool) -> bool:
    v = env.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    env: dict[str, str] = field(default_factory=load_env, repr=False)

    def __post_init__(self) -> None:
        e = self.env
        g = e.get
        self.app_env = g("MISSYOU_ENV", "development")
        self.public_url = g("MISSYOU_PUBLIC_URL", "http://localhost:5173").rstrip("/")
        self.database_url = g("MISSYOU_DATABASE_URL", "postgresql+asyncpg://missyou@127.0.0.1:5432/missyou")
        self.test_database_url = g("MISSYOU_TEST_DATABASE_URL", "")
        self.redis_url = g("MISSYOU_REDIS_URL", "redis://127.0.0.1:6379/7")
        self.jwt_secret = g("MISSYOU_JWT_SECRET", "dev-only-change-me")
        self.media_key = g("MISSYOU_MEDIA_KEY", "")  # 32-byte urlsafe base64
        self.url_signing_secret = g("MISSYOU_URL_SECRET", self.jwt_secret + ":urls")
        self.storage_dir = Path(g("MISSYOU_STORAGE_DIR", str(ROOT / "storage")))
        self.config_dir = Path(g("MISSYOU_CONFIG_DIR", str(ROOT / "config")))
        self.prompts_dir = Path(g("MISSYOU_PROMPTS_DIR", str(ROOT / "prompts")))
        self.docs_dir = Path(g("MISSYOU_DOCS_DIR", str(ROOT / "docs")))
        self.mock_providers = _b(e, "MISSYOU_MOCK_PROVIDERS", False)
        self.secure_cookies = _b(e, "MISSYOU_SECURE_COOKIES", self.public_url.startswith("https"))
        self.session_hours = _i(e, "MISSYOU_SESSION_HOURS", 72)
        self.signed_url_ttl = _i(e, "MISSYOU_SIGNED_URL_TTL", 900)

        # Jury / demo account (credentials shown on the landing page on purpose).
        self.demo_username = g("MISSYOU_DEMO_USERNAME", g("User", "TestUser"))
        self.demo_password = g("MISSYOU_DEMO_PASSWORD", g("Password", "TestUser11"))
        self.demo_admin_2fa_waived = _b(e, "MISSYOU_DEMO_ADMIN_2FA_WAIVED", True)

        # Upload limits.
        self.max_photo_mb = _i(e, "MISSYOU_MAX_PHOTO_MB", 25)
        self.max_video_mb = _i(e, "MISSYOU_MAX_VIDEO_MB", 400)
        self.max_audio_mb = _i(e, "MISSYOU_MAX_AUDIO_MB", 60)
        self.upload_chunk_mb = _i(e, "MISSYOU_UPLOAD_CHUNK_MB", 4)

        # Budget caps (USD). 0 = no cap.
        self.cap_global_daily = _f(e, "MISSYOU_CAP_GLOBAL_DAILY_USD", 10.0)
        self.cap_global_monthly = _f(e, "MISSYOU_CAP_GLOBAL_MONTHLY_USD", 100.0)
        self.cap_provider_daily = _f(e, "MISSYOU_CAP_PROVIDER_DAILY_USD", 6.0)
        self.cap_user_daily = _f(e, "MISSYOU_CAP_USER_DAILY_USD", 3.0)
        # Calls (LLM, safety, speech) have their own budget (~$0.01–0.03 per call minute).
        self.cap_essential_daily = _f(e, "MISSYOU_CAP_ESSENTIAL_DAILY_USD", 5.0)
        self.cap_essential_user_daily = _f(e, "MISSYOU_CAP_ESSENTIAL_USER_DAILY_USD", 2.0)
        self.inr_per_usd = _f(e, "MISSYOU_INR_PER_USD", 88.0)
        self.admin_email = g("MISSYOU_ADMIN_EMAIL", "")

        # Wellbeing defaults.
        self.call_soft_limit_min = _i(e, "MISSYOU_CALL_SOFT_LIMIT_MIN", 15)
        self.call_admin_max_min = _i(e, "MISSYOU_CALL_ADMIN_MAX_MIN", 30)
        self.daily_minutes_default = _i(e, "MISSYOU_DAILY_MINUTES", 30)
        self.consecutive_days_checkin = _i(e, "MISSYOU_CHECKIN_AFTER_DAYS", 7)
        self.free_trial_credits = _i(e, "MISSYOU_FREE_TRIAL_CREDITS", 200)
        self.identity_threshold = _f(e, "MISSYOU_IDENTITY_THRESHOLD", 0.32)
        self.minor_age_threshold = _f(e, "MISSYOU_MINOR_AGE_THRESHOLD", 16.0)

        # --- Providers -----------------------------------------------------
        self.linkapi = Endpoint(
            "linkapi", g("LINKAPI_BASE_URL", "https://api.linkapi.org/v1"),
            g("LINKAPI_CHAT_MODEL", "gpt-4o-mini"),
            (g("LINKAPI_API_KEY", ""), g("LINKAPI_AzureOpenAI_KEY", "")))
        self.linkapi_gemini = Endpoint(
            "linkapi-gemini", g("LINKAPI_BASE_URL", "https://api.linkapi.org/v1"),
            g("LINKAPI_GEMINI_MODEL", "gemini-2.5-flash"),
            (g("LINKAPI_Gemini_Cheap_KEY", ""),))
        self.openai = Endpoint(
            "openai", g("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            g("OPENAI_CHAT_MODEL", "gpt-5.4"),
            (g("OPENAI_API_KEY", ""), g("Open_AI_2009_Key", "")))
        # Bengali head-to-head on the real persona prompt (2026-10-18): gpt-5.4 kept তুই/তুমি consistent and
        # natural at ~2.3 s; gpt-4.1-mini mixed forms. Fast model for safety/subtitles; best model for letters.
        self.openai_fast_model = g("OPENAI_FAST_MODEL", "gpt-4.1-mini")
        self.openai_letter_model = g("OPENAI_LETTER_MODEL", "gpt-5.5")
        self.openai_fallback = Endpoint(
            "openai-4.1", g("OPENAI_BASE_URL", "https://api.openai.com/v1"), g("OPENAI_FALLBACK_MODEL", "gpt-4.1"),
            (g("OPENAI_API_KEY", ""), g("Open_AI_2009_Key", "")))
        self.anthropic = Endpoint(
            "anthropic", g("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
            g("ANTHROPIC_CHAT_MODEL", "claude-haiku-5-5"),
            (g("ANTHROPIC_API_KEY", ""), g("Calude_2009_API_Key", "")), kind="anthropic")
        self.openrouter = Endpoint(
            "openrouter", g("OPENROUTER_API_BASE_URL", "https://openrouter.ai/api/v1"),
            g("MISSYOU_OPENROUTER_MODEL", "openai/gpt-4.1-mini"),
            (g("OPENROUTER_API_KEY_1", ""), g("OPENROUTER_API_KEY_2", "")))
        self.deepseek = Endpoint(
            "deepseek", g("DEEPSEEK_API_BASE_URL", "https://api.deepseek.com/v1"),
            g("DEEPSEEK_PRIMARY_MODEL_NAME", "deepseek-chat"),
            (g("DEEPSEEK_API_KEY_1", ""), g("DEEPSEEK_API_KEY_2", "")))
        self.gemini = Endpoint(
            "gemini", g("GEMINI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
            g("MISSYOU_GEMINI_MODEL", "gemini-2.5-flash"),
            # Keys 3 and 4 verified 2026-10-15; 1 and 2 were rejected, so they go last.
            (g("GEMINI_API_KEY", ""),) + tuple(g(f"GEMINI_API_KEY_{i}", "") for i in (3, 4, 1, 2)))
        self.xai = Endpoint(
            "xai", g("XAI_BASE_URL", "https://api.x.ai/v1"), g("XAI_CHAT_MODEL", "grok-4.3"),
            (g("XAI_API_KEY", ""), g("Grok_API_KEY", "")))
        self.xai_image_model = g("XAI_IMAGE_MODEL", "grok-imagine-image-2.0")
        self.xai_video_model = g("XAI_VIDEO_MODEL", "grok-imagine-video-1.5-lite")
        self.sarvam_base = g("SARVAM_BASE_URL", "https://api.sarvam.ai")
        self.sarvam_keys = tuple(k for k in (g("SARVAM_API_KEY", ""), g("SARVAM_2009_API_KEY", ""),
                                             g("SARVAM_88_API_KEY", ""), g("SARVAM_PHD_API_KEY", "")) if k)
        self.sarvam_stt_model = g("SARVAM_STT_MODEL", "saaras:v4")
        self.sarvam_tts_model = g("SARVAM_TTS_MODEL", "bulbul:v3")
        self.fish_key = g("FISH_AUDIO_API_KEY", "") or g("Fish_Audio_88_API_KEY", "")
        self.fal_key = g("FAL_KEY", "") or g("FAL_AI_88_Admin_API_KEY", "")
        # fal lip-sync takes ~80 s per reply, so live call turns stay audio-first unless enabled.
        self.lipsync_live = _b(e, "MISSYOU_LIPSYNC_LIVE", False)
        self.higgsfield_key = g("HIGGSFIELD_API_KEY", "") or g("higgsfield_2009_API_KEY", "")
        self.elevenlabs_key = g("ELEVENLABS_API_KEY", "")
        self.deepgram_key = g("DEEPGRAM_API_KEY", "")
        self.razorpay_key_id = g("RAZORPAY_KEY_ID", "")
        self.razorpay_key_secret = g("RAZORPAY_KEY_SECRET", "")
        self.resend_key = g("RESEND_API_KEY", "")
        self.email_from = g("MISSYOU_EMAIL_FROM", "Miss You <hello@missyou.koushikdeb.com>")
        self.sentry_dsn = g("SENTRY_DSN", "")
        self.voice_engine_url = g("VOICE_ENGINE_URL", g("VOICEBOX_URL", "http://127.0.0.1:17493")).rstrip("/")
        self.voice_engine_default = g("VOICE_ENGINE_DEFAULT", g("VOICEBOX_ENGINE", "chatterbox"))
        self.voice_engine_enabled = _b(e, "VOICE_ENGINE_ENABLED", _b(e, "VOICEBOX_ENABLED", True))
        self.gpu_worker_shared_secret = g("MISSYOU_GPU_WORKER_SECRET", "")

    @property
    def is_prod(self) -> bool:
        return self.app_env == "production"

    @property
    def llm_chain(self) -> list[Endpoint]:
        return [self.linkapi, self.openai, self.openai_fallback, self.anthropic, self.openrouter, self.deepseek,
                self.linkapi_gemini, self.gemini]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    banned = banned_env_names(s.env)
    if banned:
        log.warning("Ignoring %d AWS/GCP environment variable(s) (banned by policy): %s",
                    len(banned), ", ".join(banned))
    return s


settings = get_settings()
