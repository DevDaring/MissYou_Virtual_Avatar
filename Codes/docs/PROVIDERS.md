# Providers

Every integration below was checked against the provider's current docs and/or a live call on **2026-10-15**. Full notes with request/response shapes (keys redacted): [research/provider_findings_2026-10-15.md](research/provider_findings_2026-10-15.md). Live status: [PROVIDER_REPORT.md](PROVIDER_REPORT.md) (regenerated at every startup).

**Banned:** AWS and GCP (any SDK, endpoint or key). `.env` contains 4 `AWS_*` names — they are logged once and ignored; `tests/test_ban.py` fails on any boto3/botocore/google.cloud/vertexai import or AWS/GCP endpoint.

| Capability | Provider · model | Endpoint (verified) | Docs | Data use |
|---|---|---|---|---|
| Conversation LLM | **OpenAI** gpt-4.1-mini (primary in practice) | POST /v1/chat/completions — 200, ~1.2–2.3 s | developers.openai.com/api/docs | API data not used for training by default |
| | LinkAPI (OpenAI-compatible relay) | https://api.linkapi.org/v1 — **TLS handshake failed** from this host; auto-skipped while down | — | unknown — verify before enabling |
| | OpenRouter openai/gpt-4.1-mini · DeepSeek · Gemini (AI Studio key, keys 3–4 valid) · Anthropic (models endpoint returned 400 — down) | fallbacks | openrouter.ai/docs, api-docs.deepseek.com, ai.google.dev | per provider terms |
| Moderation | OpenAI omni-moderation-latest (free) | POST /v1/moderations — 200 | platform docs | as above |
| STT | **Sarvam saaras:v4** | POST https://api.sarvam.ai/speech-to-text (multipart file, model, mode=transcribe, language_code=unknown) — 200 ~1.4 s, ≤30 s audio | docs.sarvam.ai/api-reference/speech-to-text/transcribe | see Sarvam terms |
| | OpenAI gpt-4o-mini-transcribe | POST /v1/audio/transcriptions — 200 | | |
| | Local Whisper small | POST 127.0.0.1:17493/transcribe | local service | stays on host |
| TTS preset | **Sarvam bulbul:v3** (37 speakers; roopa/suhani/rehan recommended for bn) | POST /text-to-speech {text, language_code, model, speaker} → audios[base64] — 200 ~1.8 s | docs.sarvam.ai/api-reference/text-to-speech/convert | |
| | OpenAI gpt-4o-mini-tts · xAI /v1/tts (bn, hi supported) | 200 (OpenAI live); xAI docs only | docs.x.ai/.../text-to-speech | |
| Voice clone | **Local voice engine** — LuxTTS (English) · Chatterbox Multilingual (en+hi) | /profiles, /profiles/{id}/samples, /generate, /history/{id}, /audio/{id} | local service | **stays on host** (loopback only) |
| | **Sarvam /voices/clone** (beta) — `ref_audio` ≤15 s per request | live test 200 in 3.9 s (bn-IN) | docs.sarvam.ai/api-reference/voice-cloning/clone | no saved voice created |
| | **Fish Audio s2.1-pro** — saved private voice (`POST /model`) + `POST /v1/tts {reference_id}`; first clone engine for en/hi (Bengali stays on Sarvam) | live 2026-10-18: 0.3–0.8 s/sentence | docs.fish.audio — [notes](research/fish_higgsfield_2026-10-18.md) | voice deleted with the loved one |
| | xAI custom voices — US-only & Enterprise API → not usable from India | docs | docs.x.ai/.../custom-voices | |
| Scene still | **xAI grok-imagine-image-2.0** multi-image edit | POST /v1/images/edits {images:[{url:data-uri,type:image_url}], response_format:b64_json} — 200, $0.05–0.07 | docs.x.ai/.../images/multi-image-editing | xAI terms; no deletion API |
| Idle/listening/talking loops | **xAI grok-imagine-video-1.5-lite** image-to-video, `generate_audio:false` | POST /v1/videos/generations → poll GET /v1/videos/{id} — live 200 | docs.x.ai/.../video/image-to-video | as above |
| Lip-sync / talking head | fal `fal-ai/sync-lipsync/v2` ($3/min) or `fal-ai/latentsync` ($0.60/min, `MISSYOU_LIPSYNC_MODEL=latentsync`) — implemented, **enabled when FAL_KEY is set** | POST https://queue.fal.run/{model} {video_url, audio_url, sync_mode} → poll status_url (202 while running) → response_url {video.url}; same shape as the working adotopia integration on this host | fal.ai/models/fal-ai/sync-lipsync/v2 | fal fetches signed, expiring URLs |
| Faces | InsightFace buffalo_l (local, onnxruntime CPU) | — | github.com/deepinsight/insightface | stays on host (model licence: non-commercial research weights — **review before commercial launch**) |
| Restoration | local OpenCV (denoise + CLAHE + unsharp); GFPGAN/CodeFormer need the GPU worker | — | | stays on host |
| Email | Resend — not configured; outbox only | POST https://api.resend.com/emails (not verified live) | resend.com/docs | |
| Payments | Razorpay — not configured | interface only | razorpay.com/docs | |

## Local voice engine

Our local voice service runs headless on CPU, bound to 127.0.0.1:17493 (never public). It handles cloned voice profiles + samples, queued generation (chunking + crossfade), and local Whisper STT. Postgres maps `voice_profiles.provider_voice_id → profile id` and enforces all access control; deleting a loved one deletes the voice profile. Consent attestation and AI disclosure labelling are built in.

### Engine capabilities
| Engine | Langs | Used |
|---|---|---|
| LuxTTS | en | ✅ English calls (~3 s/sentence) |
| Chatterbox Multilingual | 23 incl. hi | ✅ Hindi letters/previews (slow on CPU) |

## Language routing (config/languages.yaml)
| Lang | Clone | Preset/fallback | STT |
|---|---|---|---|
| en | Fish → LuxTTS (local) → Sarvam clone | Sarvam → OpenAI → xAI | Sarvam → OpenAI → Local Whisper |
| hi | Fish → Sarvam clone → Chatterbox (local) | Sarvam → OpenAI → xAI | Sarvam → OpenAI |
| bn | **Sarvam clone** (owner's choice) | **Sarvam bulbul:v4-flash conversational** → v3 | Sarvam → OpenAI |

Any reply containing Bengali script is voiced in Bengali by Sarvam (reads mixed English words naturally); Bengali-speaking personas keep that voice for the whole call.
