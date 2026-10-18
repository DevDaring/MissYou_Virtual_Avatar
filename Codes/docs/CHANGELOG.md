# Changelog

## 1.0.0 — 2026-10-15
- Phase 0: plan, provider discovery with live verification, provider report.
- Phase 1: FastAPI + Postgres/pgvector + Redis/arq; email/password and email-OTP auth, 18+ gate, onboarding consent, settings; AWS/GCP ban + test; cost metering (`provider_usage`), budget caps (global day/month, provider day, user day) with admin notice; provider registry + health; admin panel.
- Phase 2: resumable chunked uploads with magic-byte validation and EXIF/GPS stripping, encrypted storage; frame extraction; InsightFace detection/embeddings/clustering with merge/split; minor and public-figure refusal; anchor selection; basic restoration with before/after; vocal clean-up, segmentation, speaker grouping, transcription; user-confirmed clips; voice cloning (LuxTTS/Chatterbox, Sarvam clone), preview, rating, "try another engine"; preset voices with audition; voice design; persona questionnaire; memory notes.
- Phase 3: 12 preset places + "their old home"; identity-checked selfie still (xAI edit, ArcFace ≥ threshold, ≤ 2 retries); idle, listening and talking loops (xAI image-to-video), seamless loop crossfade; cache per scene key; regenerate; animated-still fallback; watermark + metadata.
- Phase 4: PWA call screen (ringtone, connect chime, greeting, captions, ambient soundscapes, PiP camera local-only, push-to-talk + hands-free VAD, text input, volume); STT → safety ∥ LLM → sentence TTS; per-stage latency logging; soft time limit + goodbye; daily minutes; history, transcripts (opt-in), memory box with labelled export.
- Phase 5: crisis pause with region-configurable helplines; abuse/impersonation filter + reply rule filter; report button; export zip; hard delete with per-provider report; consecutive-day check-in.
- Phase 6: credits ledger, pricing.yaml, packs, Razorpay interface (not configured), free trial.
- Phase 7: letters, special days, family sharing with approval of edits, memory interview (neutral guide voice, extracts memories), closure journey + archive, outfits, subtitles, low-bandwidth mode, mood check-in, offline PWA caching — all behind feature flags.
- Phase 8: deployed to missyou.koushikdeb.com behind Caddy; watchdog, backups, log rotation.

## 1.0.1 — 2026-10-15 (post-deploy verification fixes)
- Fixed: signup without username crashed (NUL sentinel in query) — caught by tests.
- Fixed: prompt renderer argument collided with `{{name}}`, which stalled call greetings; greeting failures can no longer leave a call ringing.
- Fixed: looped-image ffmpeg export ran forever (memory-box download); now bounded by audio duration.
- Fixed: replies kept only the first sentence's audio; per-sentence clips are now merged for replay/memory box.
- Fixed: deleting a call no longer breaks memory-box items made from it; failed letters refund credits; admin TOTP can be entered at sign-in; demo daily limit shown correctly; special days use the user's timezone.
- Safety: child photos were not refused (InsightFace age 26 for a 7-year-old) → added vision-LLM apparent-age signal; added a focused second public-figure opinion. Both refusals verified on production.

## 1.1.0 — 2026-10-15
- Sample family kit (fictional, AI-generated) + "Use sample memories" button in setup.
- fal.ai lip-sync integration (sync-lipsync v2 via queue API): per-turn lip-synced replay video in calls and lip-synced letter videos — switches on when `FAL_KEY` is set.
- E2E: `e2e/crawl.mjs` (every button, jury) and `e2e/journey.mjs` (full user journey on the live site).

## 1.2.0 — 2026-10-18
- Bengali voice quality: native-script persona output + Sarvam bulbul:v4-flash conversational Bengali voices; English subtitles for Bengali lines (jury account).
- Fish Audio voice cloning (English/Hindi), deleted with the loved one.
- fal lip-sync now live (key added): lip-synced letter videos and memory-box keepsake clips (labelled AI on download).
- TestUser/TestUser11 presented as the jury & admin login; Admin link on mobile.
- Higher sign-up/login rate limits for shared venue Wi-Fi.
- Change photo (upload → pick their face with safety checks → recreate scene) and Edit name & details on each loved one's page.
- Calls: a message sent while the previous reply is still being voiced is queued and answered next (was silently dropped).
- Fixed: lip-synced letters failed because the reply audio wasn't committed before fal fetched it; failed fal jobs are no longer metered.
- "Who's calling?": save family members per loved one (name, how the loved one relates to them, the nickname the loved one used, what they call the loved one, and things they shared / love to talk about); the persona then speaks to that person, uses their notes as memories, and the call header shows who is talking. Editable and removable.
- Subtitles translate meaning but keep names and terms of address (Chhoto, Bouma, Babu) transliterated.
- Calls on wide screens show a centred 9:16 phone frame over a blurred fill (no face cropping).
- The PWA now applies new deploys automatically (checks every 5 minutes; never reloads during a call).
