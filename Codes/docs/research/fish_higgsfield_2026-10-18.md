# Fish Audio + Higgsfield — verified 2026-10-18 (docs + live calls; spend ≈ $0.26)

## Fish Audio (docs.fish.audio, api.fish.audio/openapi.json)
- Auth `Authorization: Bearer <key>`; model chosen by header `model: s2.1-pro` (s1 deprecated, retires 2026-12-31, no hi/bn).
- Persistent private voice: `POST /model` multipart (type=tts, title, train_mode=fast, visibility=private, voices=<wav>…, texts=…) → 201 `{_id, state:"trained"}` in 3.2 s. `DELETE /model/{id}` → 204.
- TTS: `POST /v1/tts` JSON `{text, reference_id, format:"mp3"}` → audio/mpeg. Instant `references` cloning requires MessagePack (JSON+base64 returns 400).
- Live latency (saved voice): English TTFB 0.56 s / total 1.39 s; Bengali 0.26 / 0.68 s; Hindi 0.28 / 0.83 s. Bengali and Hindi transcribed back exactly by Sarvam saaras:v4.
- $15 per 1M UTF-8 bytes (Bengali/Devanagari ≈ 3 bytes/char). Concurrency 5 until $100 paid.
- **Used for:** English + Hindi cloned voices. Bengali stays on Sarvam (owner's decision).

## Higgsfield (docs.higgsfield.ai; keys at console.higgsfield.ai)
- Base `https://api.higgsfield.ai`; auth `Authorization: Key <id>:<secret>`; submit `POST /<endpoint_id>` → `{request_id, status_url}`; poll `GET /requests/{id}/status`; free `POST /estimate/<endpoint_id>`; own uploads via `POST /files/generate-upload-url` (wav audio only).
- No dedicated lip-sync endpoint in the API; `wan/v2.7/image-to-video` with `audio_url` lip-syncs a portrait to supplied audio (2–15 s): live 3 s @720p completed in ~90 s, $0.255 (~$0.085/s).
- **Status:** registered as a talking-video fallback (key present), not wired — fal sync-lipsync v2 is used for letters and keepsakes (cheaper per second, verified on our scenes).
