# Miss You — Build plan (Phase 0)

> Note: the brief asks to stop for approval after this plan. The owner's instruction for this build was to implement and host end-to-end immediately, so phases 1–8 were executed in one pass; this file records the plan that was followed.

## Folder layout
```
Codes/
  backend/            FastAPI app (Python 3.12, SQLAlchemy 2 async, Alembic, arq workers)
    app/
      config.py       settings from .env + missyou.env; AWS/GCP ban
      models.py       data model (PostgreSQL 16 + pgvector)
      storage.py      AES-256-GCM chunked encryption at rest; signed URLs in security.py
      providers/      llm, stt, tts, voicebox, xai_media, lipsync (stub), registry
      services/       metering, credits, safety, persona, faces, ingest, av, pipeline, calls, privacy, flags, jobs
      routers/        auth, me (+extras), people, calls (+scenes, memory box), admin, public
      worker.py       arq WorkerSettings (MISSYOU_QUEUE=cpu|gpu)
      seed.py         jury account + fictional demo persona
    alembic/          migrations
    tests/            pytest (mocked providers; no paid calls)
  web/                React 18 + TS + Vite + Tailwind + React Query + Zustand, installable PWA
  config/             pricing.yaml, locations.yaml, languages.yaml, preset_voices.yaml, support_resources.yaml
  prompts/            persona_v1, safety_classifier_v1, wrapup_v1, interview_v1, memory_extract_v1, letter_v1
  deploy/             host scripts, Caddy block, docker-compose (dev + prod)
  scripts/deploy.sh   one-command deploy to /home/Debz/Host/missyou
  vendor/voicebox     jamiepine/voicebox (MIT), run headless on CPU, loopback only
  docs/               this folder
```

## Data model (PostgreSQL is the source of truth)
users · otp_codes · consents (attestations with time + IP) · persons (loved ones; persona JSON) · media_assets (every file, encrypted; `ai_generated` flag) · upload_sessions (resumable chunked uploads) · face_detections (512-d ArcFace `vector`, quality, age, anchor flags) · face_clusters (centroid `vector`) · speaker_clips · voice_profiles (our id → Voicebox profile id / preset speaker) · memory_notes · scenes (cache key per person/place/activity/time/weather/outfit) · calls · call_turns (per-stage timings; text only when opted in) · memory_box · provider_usage (every paid call: units, USD, INR, latency, success, idempotency key) · jobs · safety_events (categories only, no content) · reports · credit_ledger · payments · feature_flags · admin_settings (provider pins, budget caps) · special_days · family_members · persona_edit_requests · letters · mood_checks · email_outbox · deletion_reports.

## Call loop and latency budget
```
user stops speaking ─► upload utterance (WS) ─► ffmpeg → 16 kHz WAV
   ─► STT  Sarvam saaras:v4 (~1.4 s)         ┐
   ─► Safety: keywords ∥ OpenAI moderation ∥ LLM classifier (~1–2.5 s) ┐  run in parallel
   ─► Persona LLM gpt-4.1-mini (~1.2–1.8 s)                            ┘  (reply discarded if unsafe)
   ─► split sentences ─► TTS per sentence, 2 in flight
        Sarvam clone ~3.9 s · Sarvam preset ~1.8–2.2 s · Voicebox LuxTTS ~3 s (en)
   ─► first sentence audio to client  (target < 4 s; measured 3.8–3.9 s for typed turns on production,
                                        ≈ 5.3 s for spoken turns incl. STT — see below)
   ─► [lip-sync provider when configured]  (target < 10 s)
Client: idle loop → listening loop while you talk → talking loop gated by the voice envelope.
```
Stage timings are stored in `call_turns.timings` and summarised at Admin → Latency.
Measured on https://missyou.koushikdeb.com (2026-10-15): safety 0.9–1.0 s ∥ LLM 1.0–1.9 s, first TTS
sentence 2.0–2.8 s → first audio 3.8–3.9 s after a typed message; spoken turns add Sarvam STT (~1.4 s).
The next lever for spoken turns is streaming TTS (Sarvam / xAI WebSocket). Lip-synced video: not
available on this deployment (no provider) — approximate talking loop instead.

## Phases (as executed)
0 Plan & provider discovery → 1 Foundation (auth, consent, settings, AWS/GCP ban, metering, budgets, registry, admin) → 2 Person creation (upload, faces, clusters, age/public-figure refusal, anchors, restoration, voice clips, cloning, presets, persona) → 3 Scenes (identity-checked still, idle/listening/talking loops, cache, regenerate) → 4 Call (PWA call UI, STT, safety, LLM, TTS, captions, ambient, limits, goodbye, history, memory box) → 5 Safety & privacy (crisis flow, abuse filters, labels, watermark, export, hard delete with report, report button, encryption) → 6 Payments (credits ledger, pricing config, Razorpay interface stub) → 7 Extras behind flags → 8 Deployment (Caddy TLS, watchdog cron, backups, logs).

Provider selection: see PROVIDERS.md and the live PROVIDER_REPORT.md.
