# Product Requirements — Miss You

## Overview
Miss You is a safety-first web application (installable PWA) for a short, clearly-labelled AI "video call" with a recreation of someone you miss. It is built from the photos, videos, and voice notes the user uploads.

## User journey

### 1. Sign up & consent
- Email/password signup with 18+ attestation.
- Consent screen explaining what happens to uploaded files (encryption at rest, which AI services receive data, how deletion works).
- Jury shortcut: TestUser / TestUser11 skips signup with admin access.

### 2. Create a loved one
- Name, relationship, call language (English, Bengali, Hindi), gender, age, life status (passed away / living but far).

### 3. Upload memories
- Photos (JPG, PNG, HEIC, WebP), videos (MP4, MOV, WebM), voice notes (MP3, WAV, M4A, OGG).
- Resumable chunked upload; EXIF/GPS stripped; encrypted at rest (AES-256-GCM).
- Sample family kit for demo.

### 4. Face detection & selection
- InsightFace buffalo_l on CPU: detection, ArcFace 512-d embeddings, agglomerative clustering.
- User picks which cluster is the loved one.
- Safety: minors (vision-LLM apparent age) and public figures (vision-LLM + second opinion) are refused.

### 5. Voice
- Clone from confirmed speaker clips (Fish Audio, local engine, Sarvam), or choose a preset.
- Bengali voices use Sarvam bulbul:v4-flash with native-script text.
- Voice design and audition available.

### 6. Persona
- Questionnaire: speech style, phrases, nicknames, greeting, humour, topics loved/avoided, languages, code-mix.
- Memory notes (pinned, full-text-searched during calls).
- Culture block for Bengali/Hindi families: no formal thanks, blessings over thanks.

### 7. Scene
- AI-generated scene still (xAI grok-imagine-image-2.0) showing the loved one in a chosen place.
- Identity verification: ArcFace similarity ≥ 0.32 vs cluster centroid.
- Idle, listening, and talking video loops (xAI grok-imagine-video-1.5-lite).

### 8. Call
- Push-to-talk or hands-free VAD.
- STT → Safety (parallel with LLM) → Persona LLM → Sentence TTS → Audio to client.
- Target: first audio < 4 s after the user stops speaking.
- Captions, ambient soundscapes, time limit with gentle goodbye.
- Desktop: 9:16 phone frame to prevent face cropping.

### 9. After-call
- Memory box: save moments from the call.
- Lip-synced keepsake videos (fal sync-lipsync v2, async).
- Letters feature.

### 10. Callers
- Multiple family members can call the same loved one.
- Each caller has a name, relationship, nickname the loved one used, and personal topics.
- The persona adapts its language and memories per caller.

## Non-functional requirements
- **Privacy:** encrypted storage, signed expiring URLs, opt-in transcripts, hard delete with per-provider report.
- **Safety:** keywords + moderation + LLM classifier; crisis pause with helplines; abuse filter; no-call-push rule.
- **Budget:** global daily cap ($10 generation, $5 essential), per-user daily cap.
- **Performance:** 2 uvicorn workers, arq background jobs, Redis caching.
- **AI disclosure:** watermark on stills, metadata labels, consent attestation.

## Tech stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2 async, PostgreSQL 16 + pgvector, Redis, arq workers.
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Query, Zustand, installable PWA.
- **AI providers:** OpenAI (LLM, STT, TTS), Sarvam AI (Bengali/Hindi STT, TTS, cloning), xAI (scenes, video loops), Fish Audio (voice cloning), fal.ai (lip-sync).
