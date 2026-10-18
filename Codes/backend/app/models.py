"""Data model. PostgreSQL is the single source of truth (Voicebox and hosted
providers only ever hold copies keyed by ids stored here)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer,
                        String, Text, UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

EMBED_DIM = 512


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> uuid.UUID:
    return uuid.uuid4()


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSONB, list[Any]: JSONB}


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(), index=True)


def _fk(target: str, nullable: bool = False, ondelete: str = "CASCADE") -> Mapped[Any]:
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    username: Mapped[str | None] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str | None] = mapped_column(String(255))
    dob: Mapped[date | None] = mapped_column(Date)
    role: Mapped[str] = mapped_column(String(20), default="user")  # user | family_member | admin
    language: Mapped[str] = mapped_column(String(8), default="en")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    region: Mapped[str] = mapped_column(String(8), default="IN")
    prefs: Mapped[dict[str, Any]] = mapped_column(default=dict)
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    credits: Mapped[int] = mapped_column(Integer, default=0)
    trial_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str] = mapped_column(String(320), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    purpose: Mapped[str] = mapped_column(String(20), default="login")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID | None] = _fk("persons.id", nullable=True)
    kind: Mapped[str] = mapped_column(String(40))  # onboarding | media_rights | voice_clone
    version: Mapped[str] = mapped_column(String(20))
    statements: Mapped[list[Any]] = mapped_column(default=list)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(400), default="")
    created_at: Mapped[datetime] = _created()


class Person(Base):
    """A loved one."""
    __tablename__ = "persons"
    id: Mapped[uuid.UUID] = _id()
    owner_id: Mapped[uuid.UUID] = _fk("users.id")
    name: Mapped[str] = mapped_column(String(120), default="")
    called_name: Mapped[str] = mapped_column(String(120), default="")
    relationship: Mapped[str] = mapped_column(String(80), default="")
    age: Mapped[int | None] = mapped_column(Integer)
    gender: Mapped[str] = mapped_column(String(20), default="")
    life_status: Mapped[str] = mapped_column(String(20), default="passed")  # passed | far
    call_language: Mapped[str] = mapped_column(String(8), default="en")
    persona: Mapped[dict[str, Any]] = mapped_column(default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # draft | processing | choose_face | ready | refused | archived
    setup_step: Mapped[str] = mapped_column(String(30), default="upload")
    refused_reason: Mapped[str | None] = mapped_column(String(40))
    chosen_cluster_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    voice_profile_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    keep_raw_uploads: Mapped[bool] = mapped_column(Boolean, default=True)
    closure: Mapped[dict[str, Any]] = mapped_column(default=dict)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[uuid.UUID] = _id()
    owner_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID | None] = _fk("persons.id", nullable=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    # photo | video | audio | frame | face_thumb | restored | voice_clip | place_photo |
    # scene_still | scene_idle | scene_listening | scene_talking | tts | user_audio | lipsync | letter_video | export
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_key: Mapped[str] = mapped_column(String(300))
    sha256: Mapped[str] = mapped_column(String(64), default="")
    original_name: Mapped[str] = mapped_column(String(255), default="")
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[float | None] = mapped_column(Float)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    meta: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = _created()


class UploadSession(Base):
    __tablename__ = "upload_sessions"
    id: Mapped[uuid.UUID] = _id()
    owner_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    filename: Mapped[str] = mapped_column(String(255))
    declared_size: Mapped[int] = mapped_column(BigInteger)
    received: Mapped[int] = mapped_column(BigInteger, default=0)
    purpose: Mapped[str] = mapped_column(String(30), default="memory")  # memory | place_photo
    status: Mapped[str] = mapped_column(String(20), default="open")
    media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _created()


class FaceCluster(Base):
    __tablename__ = "face_clusters"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    label: Mapped[int] = mapped_column(Integer, default=0)
    size: Mapped[int] = mapped_column(Integer, default=0)
    best_face_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    centroid: Mapped[Any] = mapped_column(Vector(EMBED_DIM), nullable=True)
    median_age: Mapped[float | None] = mapped_column(Float)
    gender: Mapped[str] = mapped_column(String(4), default="")
    created_at: Mapped[datetime] = _created()


class FaceDetection(Base):
    __tablename__ = "face_detections"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    media_id: Mapped[uuid.UUID] = _fk("media_assets.id")
    cluster_id: Mapped[uuid.UUID | None] = _fk("face_clusters.id", nullable=True, ondelete="SET NULL")
    thumb_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    crop_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    frame_time_s: Mapped[float | None] = mapped_column(Float)
    bbox: Mapped[list[Any]] = mapped_column(default=list)
    det_score: Mapped[float] = mapped_column(Float, default=0)
    quality: Mapped[float] = mapped_column(Float, default=0)
    age: Mapped[float | None] = mapped_column(Float)
    gender: Mapped[str] = mapped_column(String(4), default="")
    is_anchor: Mapped[bool] = mapped_column(Boolean, default=False)
    restored_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    use_restored: Mapped[bool] = mapped_column(Boolean, default=False)
    embedding: Mapped[Any] = mapped_column(Vector(EMBED_DIM))
    created_at: Mapped[datetime] = _created()


class SpeakerClip(Base):
    __tablename__ = "speaker_clips"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    source_media_id: Mapped[uuid.UUID] = _fk("media_assets.id")
    clip_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    speaker_label: Mapped[int] = mapped_column(Integer, default=0)
    transcript: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(8), default="")
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    kind: Mapped[str] = mapped_column(String(20))  # clone | preset | designed
    provider: Mapped[str] = mapped_column(String(30))  # voicebox | sarvam | openai | fish ...
    provider_voice_id: Mapped[str] = mapped_column(String(200), default="")
    engine: Mapped[str] = mapped_column(String(60), default="")
    language: Mapped[str] = mapped_column(String(8), default="en")
    label: Mapped[str] = mapped_column(String(120), default="")
    rating: Mapped[int | None] = mapped_column(Integer)
    preview_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(String(20), default="ready")
    meta: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = _created()


class MemoryNote(Base):
    __tablename__ = "memory_notes"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    author_id: Mapped[uuid.UUID | None] = _fk("users.id", nullable=True, ondelete="SET NULL")
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="user")  # user | interview | transcript
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()


class Scene(Base):
    __tablename__ = "scenes"
    __table_args__ = (UniqueConstraint("person_id", "cache_key"),)
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    location_key: Mapped[str] = mapped_column(String(40))
    place_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    activity: Mapped[str] = mapped_column(String(20), default="sitting")
    time_of_day: Mapped[str] = mapped_column(String(20), default="golden_hour")
    weather: Mapped[str] = mapped_column(String(20), default="clear")
    outfit: Mapped[str] = mapped_column(String(40), default="")
    cache_key: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | generating | ready | failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    still_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    idle_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    listening_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    talking_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    identity_score: Mapped[float | None] = mapped_column(Float)
    mode: Mapped[str] = mapped_column(String(20), default="video")  # video | animated_still
    notes: Mapped[list[Any]] = mapped_column(default=list)
    error: Mapped[str | None] = mapped_column(Text)
    generations: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _created()


class Call(Base):
    __tablename__ = "calls"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    scene_id: Mapped[uuid.UUID | None] = _fk("scenes.id", nullable=True, ondelete="SET NULL")
    kind: Mapped[str] = mapped_column(String(20), default="call")  # call | interview | closure | last_call
    status: Mapped[str] = mapped_column(String(20), default="ringing")  # ringing | active | paused | ended
    language: Mapped[str] = mapped_column(String(8), default="en")
    store_transcript: Mapped[bool] = mapped_column(Boolean, default=False)
    caller: Mapped[dict[str, Any]] = mapped_column(default=dict)  # {} = the account owner
    soft_limit_s: Mapped[int] = mapped_column(Integer, default=900)
    started_at: Mapped[datetime] = _created()
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    end_reason: Mapped[str] = mapped_column(String(30), default="")
    reflection: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    crisis_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    credits_charged: Mapped[int] = mapped_column(Integer, default=0)


class CallTurn(Base):
    __tablename__ = "call_turns"
    id: Mapped[uuid.UUID] = _id()
    call_id: Mapped[uuid.UUID] = _fk("calls.id")
    idx: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(12))  # user | assistant
    text: Mapped[str | None] = mapped_column(Text)  # null unless transcripts opted in (kept in memory during call)
    language: Mapped[str] = mapped_column(String(8), default="")
    audio_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    video_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    timings: Mapped[dict[str, Any]] = mapped_column(default=dict)
    safety: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = _created()


class MemoryBoxItem(Base):
    __tablename__ = "memory_box"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    call_id: Mapped[uuid.UUID | None] = _fk("calls.id", nullable=True, ondelete="SET NULL")
    text: Mapped[str] = mapped_column(Text, default="")
    media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    video_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    video_status: Mapped[str] = mapped_column(String(20), default="")  # "" | making | ready | failed
    created_at: Mapped[datetime] = _created()


class ProviderUsage(Base):
    __tablename__ = "provider_usage"
    id: Mapped[uuid.UUID] = _id()
    provider: Mapped[str] = mapped_column(String(40), index=True)
    capability: Mapped[str] = mapped_column(String(40), index=True)
    model: Mapped[str] = mapped_column(String(120), default="")
    feature: Mapped[str] = mapped_column(String(40), default="")
    units: Mapped[float] = mapped_column(Float, default=0)
    unit_type: Mapped[str] = mapped_column(String(20), default="")
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    cost_inr: Mapped[float] = mapped_column(Float, default=0)
    price_known: Mapped[bool] = mapped_column(Boolean, default=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    call_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), index=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = _created()


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    person_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    queue: Mapped[str] = mapped_column(String(20), default="cpu")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed | cancelled
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String(300), default="")
    args: Mapped[dict[str, Any]] = mapped_column(default=dict)
    result: Mapped[dict[str, Any]] = mapped_column(default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SafetyEvent(Base):
    """Counts and categories only — never message content."""
    __tablename__ = "safety_events"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    person_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    call_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(String(30), index=True)
    # crisis | abuse_blocked | minor_refused | public_figure_refused | dependency_checkin
    category: Mapped[str] = mapped_column(String(40), default="")
    detector: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(20), default="open")
    admin_note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = _created()


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    call_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    person_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str] = mapped_column(String(60))
    details: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open")
    admin_note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = _created()


class CreditLedger(Base):
    __tablename__ = "credit_ledger"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    delta: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(60))
    ref: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = _created()


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    provider: Mapped[str] = mapped_column(String(20))
    pack: Mapped[str] = mapped_column(String(40))
    amount_inr: Mapped[float] = mapped_column(Float)
    credits: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="created")
    provider_order_id: Mapped[str] = mapped_column(String(120), default="")
    provider_payment_id: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = _created()


class FeatureFlag(Base):
    __tablename__ = "feature_flags"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str] = mapped_column(String(300), default="")


class AdminSetting(Base):
    __tablename__ = "admin_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(default=dict)


class SpecialDay(Base):
    __tablename__ = "special_days"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    title: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(30), default="birthday")
    month: Mapped[int] = mapped_column(Integer)
    day: Mapped[int] = mapped_column(Integer)
    notify: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = _created()


class FamilyMember(Base):
    __tablename__ = "family_members"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    user_id: Mapped[uuid.UUID | None] = _fk("users.id", nullable=True)
    invited_by: Mapped[uuid.UUID] = _fk("users.id")
    invite_code: Mapped[str] = mapped_column(String(40), unique=True)
    invited_email: Mapped[str] = mapped_column(String(320), default="")
    status: Mapped[str] = mapped_column(String(20), default="invited")  # invited | active | revoked
    created_at: Mapped[datetime] = _created()


class PersonaEditRequest(Base):
    __tablename__ = "persona_edit_requests"
    id: Mapped[uuid.UUID] = _id()
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    requester_id: Mapped[uuid.UUID] = _fk("users.id")
    patch: Mapped[dict[str, Any]] = mapped_column(default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = _created()


class Letter(Base):
    __tablename__ = "letters"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    person_id: Mapped[uuid.UUID] = _fk("persons.id")
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | writing | ready | failed | blocked
    reply_text: Mapped[str | None] = mapped_column(Text)
    reply_audio_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reply_video_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MoodCheck(Base):
    __tablename__ = "mood_checks"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    call_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    phase: Mapped[str] = mapped_column(String(10))  # before | after
    score: Mapped[int] = mapped_column(Integer)  # 1..5
    created_at: Mapped[datetime] = _created()


class EmailOutbox(Base):
    __tablename__ = "email_outbox"
    id: Mapped[uuid.UUID] = _id()
    to: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(30), default="")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | sent | not_configured | failed
    created_at: Mapped[datetime] = _created()


class DeletionReport(Base):
    __tablename__ = "deletion_reports"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    scope: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[str] = mapped_column(String(60))
    report: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = _created()


Index("ix_usage_day", ProviderUsage.created_at, ProviderUsage.provider)
