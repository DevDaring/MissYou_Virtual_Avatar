# Provider report

_Generated 2026-10-15T15:46:34.490250+00:00 at startup by `app/providers/registry.py`. Key values are never read into this file._

Ignored AWS/GCP environment variables (policy ban): **4**

| Capability | Primary | Fallbacks | Down | Missing |
|---|---|---|---|---|
| conversation | openai | openrouter, deepseek, gemini | linkapi, anthropic, linkapi-gemini | — |
| safety | keywords(local) | openai-moderation, openai, openrouter, gemini | linkapi, anthropic | — |
| stt | sarvam | openai, voicebox-whisper | — | deepgram |
| tts_clone | voicebox | sarvam_clone | — | fish, fal, elevenlabs |
| tts_preset | sarvam | openai, xai | — | — |
| scene_image | xai | — | — | fal |
| idle_video | xai | local(animated-still) | — | fal |
| lipsync | client(approximate) | — | — | fal, gpu-worker(musetalk) |
| talking_video | local(animated-still+voice) | — | — | fal |
| faces | insightface(local) | — | — | — |
| restoration | local(basic-opencv) | — | — | gpu-worker(gfpgan), fal |
| vocal_isolation | local(ffmpeg-filters+mfcc-grouping) | — | — | gpu-worker(demucs+pyannote) |
| payments | — (degraded) | — | — | razorpay |
| email | outbox(admin-visible) | — | — | resend |

## Provider health

| Provider | Status | Detail |
|---|---|---|
| anthropic | down | HTTP 400 |
| client(approximate) | ok | built in |
| deepgram | missing | no key / not configured |
| deepseek | ok | models listed; using deepseek-chat |
| elevenlabs | missing | no key / not configured |
| fal | missing | no key / not configured |
| fish | missing | no key / not configured |
| gemini | ok | models listed; using gemini-2.5-flash |
| gpu-worker(demucs+pyannote) | missing | no key / not configured |
| gpu-worker(gfpgan) | missing | no key / not configured |
| gpu-worker(musetalk) | missing | no key / not configured |
| insightface(local) | ok | buffalo_l present |
| keywords(local) | ok | built in |
| linkapi | down | ConnectError |
| linkapi-gemini | down | ConnectError |
| local(animated-still) | ok | built in |
| local(animated-still+voice) | ok | built in |
| local(basic-opencv) | ok | built in |
| local(ffmpeg-filters+mfcc-grouping) | ok | built in |
| openai | ok | models listed; using gpt-4.1-mini |
| openai-moderation | ok | models listed; using gpt-4.1-mini |
| openrouter | ok | models listed; using openai/gpt-4.1-mini |
| outbox(admin-visible) | ok | built in |
| razorpay | missing | no key / not configured |
| resend | missing | no key / not configured |
| sarvam | configured | 3 key(s); no free health endpoint (verified live 2026-10-15) |
| sarvam_clone | configured | 3 key(s); no free health endpoint (verified live 2026-10-15) |
| voicebox | ok | internal service healthy |
| voicebox-whisper | ok | internal service healthy |
| xai | ok | models listed; using grok-4.3 |
