# Technical Specification — Miss You

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Caddy (reverse proxy)                     │
│               missyou.koushikdeb.com → :8170                   │
├─────────────────────────────────────────────────────────────────┤
│  React PWA (Vite)        │       FastAPI (uvicorn × 2)         │
│  └─ Tailwind, Zustand,   │       ├─ /api/auth, /api/people,   │
│     React Query           │       │   /api/calls, /api/me      │
│                           │       ├─ SQLAlchemy 2 async        │
│                           │       ├─ Alembic migrations        │
│                           │       └─ WebSocket /ws/call/{id}   │
├───────────────────────────┼────────────────────────────────────┤
│  PostgreSQL 16 + pgvector │  Redis 7 (queues, cache, pub/sub)  │
├───────────────────────────┴────────────────────────────────────┤
│  arq workers:  cpu (ingest, face detect, audio)                │
│                gpu (scene gen, lip-sync, video loops)           │
├────────────────────────────────────────────────────────────────┤
│  Local voice engine (LuxTTS en, Chatterbox hi) — 127.0.0.1:17493 │
└────────────────────────────────────────────────────────────────┘
```

## Data model (key tables)

| Table | Purpose |
|---|---|
| `users` | Account, hashed password, language pref, prefs JSON, credit balance |
| `people` | Loved-one profile: name, relationship, persona JSON, call language, gender, age |
| `media_assets` | Uploaded and generated files; encrypted storage key, MIME, face embeddings |
| `voice_profiles` | Cloned or preset voice per person; provider, engine, provider voice ID |
| `calls` | Call session: person, caller, duration, kind (audio/video), started_at |
| `call_turns` | Per-turn transcript: role (user/ai), text, audio storage key, timings |
| `memory_notes` | Pinned notes about the loved one, full-text searched during calls |
| `memory_box_items` | Saved moments from calls (audio clip + transcript) |
| `letters` | Written letters to the loved one, with AI replies |
| `provider_usage` | Per-request cost tracking by provider and operation |
| `deletion_reports` | Audit trail for privacy hard-deletes |

## API endpoints (grouped)

### Auth
- `POST /api/auth/register` — email/password signup with 18+ attestation
- `POST /api/auth/login` — returns JWT access + refresh tokens
- `POST /api/auth/refresh` — rotate refresh token
- `POST /api/auth/verify-email` — email verification code

### People (loved ones)
- `POST /api/people` — create loved-one profile
- `GET /api/people` — list user's loved ones
- `GET /api/people/{id}` — full profile with voice, faces, scene
- `PATCH /api/people/{id}` — edit name, details, persona
- `POST /api/people/{id}/photo` — change anchor photo
- `DELETE /api/people/{id}` — hard delete with provider cleanup

### Uploads & ingest
- `POST /api/people/{id}/upload` — chunked file upload (photo/video/audio)
- `POST /api/people/{id}/ingest` — trigger face detection + clustering pipeline
- `POST /api/people/{id}/sample-kit` — load demo family memories

### Voice
- `POST /api/people/{id}/voice/clone` — start voice cloning job
- `POST /api/people/{id}/voice/audition` — preview TTS with cloned voice
- `POST /api/people/{id}/voice/preset` — assign a preset voice

### Scene
- `POST /api/people/{id}/scene` — generate scene still + video loops
- `GET /api/people/{id}/scene` — current scene with status

### Calls
- `POST /api/calls` — start a new call session
- `WebSocket /ws/call/{id}` — real-time audio stream + control messages
- `POST /api/calls/{id}/end` — end call, finalize transcript
- `GET /api/calls` — call history

### Callers
- `POST /api/people/{id}/callers` — add a family caller
- `GET /api/people/{id}/callers` — list callers for a loved one
- `PATCH /api/people/{id}/callers/{cid}` — edit caller details

### Me
- `GET /api/me` — current user profile
- `PATCH /api/me` — update display name, language, prefs
- `POST /api/me/export` — GDPR data export (ZIP)
- `DELETE /api/me` — hard account deletion

### Admin
- `GET /api/admin/stats` — usage stats, active users, provider costs
- `GET /api/admin/users` — user list with credit balances

## Call pipeline (real-time)

```
User speaks → WebSocket binary frame
  → STT (OpenAI whisper-1 / Sarvam saaras2:flash / local Whisper)
  → Safety check (parallel):
      ├─ Keyword scan
      ├─ OpenAI moderation
      └─ LLM safety classifier
  → Persona LLM (gpt-4.1-mini / gpt-5.4 for Bengali)
      with: persona prompt, memory notes, recent turns, caller context
  → Sentence-level TTS streaming
      (Fish Audio / local engine / Sarvam bulbul:v4-flash)
  → WebSocket binary frames → client audio playback
```

Target latency: first audio chunk < 4 seconds after user finishes speaking.

## Safety system

| Layer | Implementation |
|---|---|
| Keywords | Configurable keyword list with severity levels; immediate crisis pause for self-harm terms |
| Moderation | OpenAI moderation API on every user turn |
| LLM classifier | Dedicated classifier prompt; flags manipulation, identity confusion, harmful requests |
| Crisis pause | Pauses call, shows helpline numbers from `support_resources.yaml` (locale-aware) |
| Abuse filter | Rate limiting + repeated-flag detection; temporary call block |
| Content safety | Minor detection (vision LLM age check), public-figure refusal on upload |
| AI disclosure | Watermark on generated stills, metadata labels, consent attestation at signup |

## Privacy & deletion

- All media encrypted at rest (AES-256-GCM) with per-user keys derived from MISSYOU_MEDIA_KEY.
- Signed, expiring URLs for media access (no permanent public links).
- Hard delete: removes local files, calls provider-specific delete APIs (Fish Audio voice delete, local engine profile delete), writes audit `deletion_reports` row.
- Data export: ZIP with all uploaded files, call transcripts, letters, persona config.

## Voice cloning pipeline

```
Upload audio → speaker verification (confirm it's the same person)
  → Clone chain (language-dependent):
      English: [Fish Audio, local engine, Sarvam]
      Hindi:   [Fish Audio, Sarvam, local engine]
      Bengali: [Fish Audio, Sarvam, local engine]
  → First successful clone wins; fallback to next engine on failure
  → Store voice_profile with provider + provider_voice_id
```

## Scene generation

```
Anchor photo + place selection
  → xAI grok-imagine-image-2.0 (scene still)
  → ArcFace identity verification (similarity ≥ 0.32 vs cluster centroid)
  → If verified: generate video loops (idle, listening, talking)
      via xAI grok-imagine-video-1.5-lite
  → If not verified: retry with adjusted prompt (up to 3 attempts)
```

## Frontend architecture

- **Router:** React Router v6 with auth guard wrapper
- **State:** Zustand for call state + React Query for server state
- **Call UI:** 9:16 phone-frame layout; scene video loops swap based on call state; push-to-talk button or VAD toggle
- **PWA:** service worker for offline shell caching; installable on mobile
- **Responsive:** mobile-first; desktop shows phone frame centred on dark background

## Budget & metering

- Global daily caps: $10 generation, $5 essential services
- Per-user daily cap configurable by admin
- Every provider call logged to `provider_usage` with cost estimate from `pricing.yaml`
- Admin dashboard shows real-time spend breakdown

## Deployment

- **Host:** single VPS with Caddy reverse proxy
- **Processes:** uvicorn (2 workers), arq cpu worker, arq gpu worker, local voice engine
- **Database:** PostgreSQL 16 with pgvector extension
- **Cache/queue:** Redis 7 (db 7 production, db 9 tests)
- **Monitoring:** cron watchdog every 5 minutes, nightly backup, @reboot auto-start
- **CI alternative:** docker-compose with Caddy, API, workers, voice engine, Postgres, Redis
