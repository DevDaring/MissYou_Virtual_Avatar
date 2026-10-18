# Miss You

A gentle, safety-first web app (installable PWA) for a short, clearly-labelled AI "video call" with a recreation of someone you miss — built from the photos, videos and voice notes you upload. Live at **https://missyou.koushikdeb.com**.

**Jury login:** `TestUser` / `TestUser11` (shown on the landing and sign-in pages). The account includes a fictional demo loved one, "Ma", whose portrait is AI-generated, so you can start a call immediately. It is an admin account with 2FA waived for the jury.

## Hackathon

Built for **[Build With AI: Basics](https://learn-ai-basics.devpost.com/)** (Devpost). This is **new code**: the project was started from an empty folder on **15 October 2026**, inside the submission period, and everything in this repository was written for it, with Claude Code as the AI coding assistant.

## Repository layout
All source lives in [`Codes/`](Codes/): `backend/` (FastAPI), `web/` (React PWA), `config/`, `prompts/`, `docs/`, `deploy/`, `scripts/`.

## 5-minute local quick start
```bash
# prerequisites: Python 3.12, Node 20, PostgreSQL 16 + pgvector, Redis, ffmpeg
cd Codes
cp .env.example .env            # add provider keys (any subset works; features degrade gracefully)
#   create missyou.env with MISSYOU_DATABASE_URL, MISSYOU_JWT_SECRET, MISSYOU_MEDIA_KEY, …
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --port 8170 &                     # API (seeds the jury account)
MISSYOU_QUEUE=cpu .venv/bin/arq app.worker.WorkerSettings &       # CPU worker
MISSYOU_QUEUE=gpu .venv/bin/arq app.worker.WorkerSettings &       # generation worker
cd ../web && npm install && npm run dev                           # http://localhost:5173
```
Optional demo persona (spends ≈ $0.8 on xAI): `cd Codes/backend && .venv/bin/python -m app.seed --content`.

**Sample family:** in the upload step, "Use sample memories" adds a fictional family of three (birthday video with speech + photos, all AI-generated, `config/sample_kit/`) so the full flow — pick a person, confirm the voice, clone, scene, call — can be tried without personal files. Rebuild with `python -m app.sample_kit`.

## Tests
```bash
cd Codes/backend && .venv/bin/pytest -q          # 43 tests, mocked providers, no paid calls
cd Codes/web && npx tsc -b --noEmit && npx eslint src && npx vitest run   # 5 component tests
cd Codes/web && node e2e/crawl.mjs ./e2e-shots                     # clicks every non-destructive control as the jury (free)
cd Codes/web && MIC_WAV=speech.wav node e2e/journey.mjs ./e2e-shots # full new-user journey incl. a real call (~$1)
```

## Map (inside `Codes/`)
- `backend/` — FastAPI, SQLAlchemy async, Alembic, arq workers; `app/providers/` (LLM, STT, TTS/voice cloning, xAI, registry), `app/services/` (metering & budgets, safety, persona, faces, pipelines, calls, privacy)
- `web/` — React + TS + Vite + Tailwind + React Query + Zustand PWA (`src/pages/Call.tsx` is the call screen)
- `config/` — pricing, places, language routing, preset voices, helplines · `prompts/` — versioned prompts
- `docs/` — PLAN, DECISIONS, PROVIDERS, PROVIDER_REPORT, COMPLIANCE, PRICING_NOTES, DEPLOY, CHANGELOG, FAQ
- `deploy/`, `scripts/deploy.sh` — hosting (Caddy + native processes) and docker-compose
