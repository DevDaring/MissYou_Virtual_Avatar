# Miss You: verified provider facts

Read and tested on **2026-10-15**. Live calls ran from this machine at about 15:00 UTC.

Keys are redacted throughout. Where a value is shown, it is never more than the first 4 characters.

Labels used below:
- **LIVE**: we called the API and saw the result.
- **DOC**: we read it in the provider's documentation.
- **UNKNOWN**: we could not verify it.

Raw downloaded docs are in `/tmp/claude-1000/-home-Debz-Hackathon-MissYou-Virtual-Avatar/08baf763-9c8b-4969-a28a-e294e5cf643a/scratchpad/dl/`. Probe scripts and outputs are in `/tmp/claude-1000/-home-Debz-Hackathon-MissYou-Virtual-Avatar/08baf763-9c8b-4969-a28a-e294e5cf643a/scratchpad/probe/`.

Spend on 2026-10-15:
- xAI image generation: $0.04, from `usage.cost_in_usd_ticks`.
- xAI image edit: $0.05, from `usage.cost_in_usd_ticks`.
- Everything else was under about $0.005 in total (tiny chats, TTS and STT).

---

## 1. xAI (`Grok_API_KEY` works; base `https://api.x.ai/v1`; auth `Authorization: Bearer`)

### 1.1 Models the key can access (LIVE, `GET /v1/models` returned 200)

- **Text:** `grok-4.20-0309-non-reasoning`, `grok-4.20-0309-reasoning`, `grok-4.20-multi-agent-0309`, `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `grok-build-0.1`
- **Image:** `grok-imagine-image`, `grok-imagine-image-2.0`, `grok-imagine-image-quality`
- **Video:** `grok-imagine-video`, `grok-imagine-video-1.5`, `grok-imagine-video-1.5-lite`

These endpoints also answered 200 for free:
- `GET /v1/image-generation-models`. It reports exact per-quality prices (see 1.2).
- `GET /v1/video-generation-models`
- `GET /v1/language-models`
- `GET /v1/tts/voices`
- `GET /v1/custom-voices`. It returned `{"voices":[],"total_count":0,"cap":30}`.

### 1.2 Image generation: `POST /v1/images/generations` (DOC + LIVE)

Sources (read 2026-10-15):
- https://docs.x.ai/developers/rest-api-reference/inference/images.md
- https://docs.x.ai/developers/model-capabilities/images/generation.md

Request body fields:
- `model`
- `prompt`
- `n` (up to 10)
- `aspect_ratio`: one of `1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 9:19.5, 19.5:9, 9:20, 20:9, 1:2, 2:1, 21:9, 5:2, auto`. Default `auto`.
- `resolution`: `1k` (default), `1.5k`, or `2k`
- `quality`: `low`, `medium`, or `auto`. Only `grok-imagine-image-2.0` accepts it. `auto` means low for generation and medium for edits.
- `response_format`: `url` (default) or `b64_json`
- `deferred`, which you then poll with `GET /v1/images/{request_id}`
- `storage_options`
- `output.upload_urls`
- `user`

Response:
- `data[]`, where each item has `url` or `b64_json` (raw base64 with no `data:` prefix) and `mime_type`.
- `usage.cost_in_usd_ticks`. 1 USD = 10,000,000,000 ticks.
- The docs say URLs are temporary, so download the image promptly.

**LIVE request that worked** (HTTP 200, 20.3 s):
```json
POST https://api.x.ai/v1/images/generations
Authorization: Bearer xai-***
{"model":"grok-imagine-image-2.0","prompt":"Photorealistic head-and-shoulders portrait of a fictional elderly Bengali man ...","n":1,"aspect_ratio":"3:4","resolution":"1k","quality":"low"}
```
Response:
```json
{"data":[{"url":"https://imgen.x.ai/xai-imgen/xai-tmp-imgen-<uuid>.jpeg","mime_type":"image/jpeg"}],"usage":{"cost_in_usd_ticks":400000000}}
```
The result was an 864x1152 JPEG and cost $0.04.

**Prices**, from the pricing page (https://docs.x.ai/developers/pricing.md) and the live `GET /v1/image-generation-models`:

`grok-imagine-image-2.0` (from the live model listing):

| Quality | 1k | 1.5k | 2k |
|---|---|---|---|
| low | $0.04 | $0.05 | $0.06 |
| medium | $0.06 | $0.07 | $0.08 |

Other image models:
- `grok-imagine-image`: $0.02 per image.
- `grok-imagine-image-quality`: $0.05 per image. It retires on **2026-11-02** and will then redirect to 2.0 at low quality (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2.md).
- The docs say: "Edits: billed for both the input image and the generated output image."

### 1.3 Image editing for identity preservation: `POST /v1/images/edits` (DOC + LIVE)

- The endpoint exists and takes a JSON body only. The docs say: "The OpenAI SDK's `images.edit()` method is not supported ... uses multipart/form-data, while the xAI API requires application/json."
- **Single input:** `image: {"url": "<public URL or data:image/jpeg;base64,...>", "type": "image_url"}`. `image.file_id` from the Files API also works. Allowed formats are JPEG, PNG and WebP.
- **Multiple inputs:** `images: [{url}, ...]`, up to 5 images. Refer to them in the prompt as `<IMAGE_0>`, `<IMAGE_1>`, and so on. `images` cannot be combined with `image`.
- Output aspect ratio follows the first input image unless you set `aspect_ratio`.
- The other fields are the same as for generation.
- Sources: https://docs.x.ai/developers/model-capabilities/images/editing.md and https://docs.x.ai/developers/model-capabilities/images/multi-image-editing.md

**LIVE request that worked** (HTTP 200, 6.3 s). The input was the generated JPEG above, sent as a **base64 data URI**:
```json
POST https://api.x.ai/v1/images/edits
{"model":"grok-imagine-image-2.0","prompt":"Keep the exact same person, face, glasses and identity. Change only the expression to a gentle warm smile and the background to a softly lit living room.","image":{"url":"data:image/jpeg;base64,<...>","type":"image_url"},"n":1,"quality":"low","resolution":"1k","response_format":"b64_json"}
```
Response:
```json
{"data":[{"b64_json":"<367300 chars>","mime_type":"image/jpeg"}],"usage":{"cost_in_usd_ticks":500000000}}
```
- Cost was $0.05, which covers the input image plus the output.
- The output was 864x1152.
- **Identity was preserved very well when we looked at the two images**: the same face, glasses, hair and kurta. Only the expression and background changed.
- Files: `probe/gen.jpg` and `probe/edit.jpg`.

### 1.4 Video generation: `POST /v1/videos/generations`, then poll `GET /v1/videos/{request_id}` (DOC; no live call made)

Sources (read 2026-10-15):
- https://docs.x.ai/developers/rest-api-reference/inference/videos.md
- https://docs.x.ai/developers/model-capabilities/video/overview.md
- https://docs.x.ai/developers/model-capabilities/video/image-to-video.md
- https://docs.x.ai/developers/model-capabilities/video/generation.md
- https://docs.x.ai/developers/model-capabilities/video/reference-to-video.md

Request body:
- `model`
- `prompt`: optional for image-to-video
- `duration`: integer from 1 to 15. Default 8. `seconds` is also accepted.
- `aspect_ratio`: one of `1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9, 5:2`. **It is ignored for image-to-video**, where the output matches the input image.
- `resolution`: `480p` (default), `720p`, or `1080p`
- `image: {url | file_id}`. The REST reference says the url field takes a "Public URL or base64-encoded data URL of the image (JPEG, PNG, or WebP)". **So yes, a data URI is accepted, according to the docs.**
- `reference_images[]`
- `last_frame`
- `keyframes[]`
- `reference_audios[]`
- `output.upload_url`
- `storage_options`
- `user`
- `generate_audio: false` gives a silent clip. This is in the guide, not the REST reference.

What `image` does in each mode:
- `image` on its own means image-to-video. The image becomes the first frame.
- `image` together with `reference_images`, `last_frame` or `keyframes` means reference-to-video, with the image pinned as the first frame.

Responses:
- Submitting returns `{"request_id": "..."}`.
- Polling returns `status` (`pending`, `done`, `failed` or `expired`), `progress` (0 to 100), `video.url`, `video.duration`, `video.respect_moderation`, `model`, `usage.cost_in_usd_ticks` and `error{code,message}`.
- Video URLs are temporary.

Models (overview page):

| Model | Text/image-to-video | Reference images | Voice refs | Price |
|---|---|---|---|---|
| `grok-imagine-video-1.5` | up to 1080p, native | up to 14, 15 s, 720p | up to 3 preset voices | **$0.080/s** |
| `grok-imagine-video-1.5-lite` | up to 1080p (upscaled from 720p) | not supported | not supported | **$0.020/s** |
| `grok-imagine-video` | up to 720p | up to 7, 10 s, 720p | not supported | **$0.050/s** |

- Duration is 1 to 15 s on all three models.
- **Audio:** "Generated videos include an audio track by default, with lip-synced speech on grok-imagine-video-1.5 and -1.5-lite."
- **Voice:** `reference_audios[{voice_id}]` takes **preset voices only**. The docs say: "voice references with your own audio files are available to trusted partners on request". The REST schema does show a `url` field for caller audio clips of 15 s or less, but the guide says that is partner-gated.
- **So we cannot give the clip our own cloned voice through public access.** Render it silent with `generate_audio:false`, or mute it, and lay our own TTS over it.
- The overview says "Per-second prices by resolution are listed on the Models page", but the model pages only show a single per-second rate. **Whether the price varies by resolution is UNKNOWN.** Bill from `usage.cost_in_usd_ticks`.
- The reference code at `/home/Debz/Host/adotopia/backend/app/llm/xaivideo.py` already uses this shape and confirms some limits by testing (2026-09-24):
  - `grok-imagine-video` with references is capped at 10 s.
  - `grok-imagine-video` returns "Combining `image` with reference inputs is not supported".
  - Prompts are limited to 4096 characters.

### 1.5 xAI TTS and voice cloning (DOC + free LIVE listing)

**TTS** (https://docs.x.ai/developers/model-capabilities/audio/text-to-speech.md):
- `POST https://api.x.ai/v1/tts`, JSON body. It returns audio bytes, MP3 at 24 kHz by default.
- Fields:
  - `text`: up to 60,000 characters
  - `voice_id`: default `eve`
  - `language`: BCP-47 or `auto`. Required.
  - `output_format{codec,sample_rate,bit_rate}`
  - `speed`: 0.7 to 1.5
  - `text_normalization`
  - `with_timestamps`
  - `replace`
- WebSocket streaming: `wss://api.x.ai/v1/tts`.
- **Bengali (`bn`) and Hindi (`hi`) are on the supported list of 20 languages.** Any voice can speak any of them.
- Price: **$15.00 per 1M characters** (pricing page).
- We did not call TTS, so audio quality in Bengali has not been heard.

**Voices** (LIVE, `GET /v1/tts/voices`): 28 voices, all multilingual.
- Female: ara, aurora, carina, celeste, eve, iris, liora, luna, ursa
- Male: altair, atlas, castor, cosmo, helios, helix, kepler, leo, lumen, lux, naksh, orion, perseus, rex, rigel, sal, sirius, zagan, zenith

**Custom voices / cloning** (https://docs.x.ai/developers/model-capabilities/audio/custom-voices.md):
- How it works:
  - Create the voice with `POST /v1/custom-voices` (multipart: `file` up to 120 s, `name`, `language`, `gender`, `tone`, `use_case`).
  - The response returns a `voice_id`.
  - Use that `voice_id` with `/v1/tts`, the TTS WebSocket, or realtime.
- **Restrictions:**
  - The docs say: "Custom Voices is currently only available in the **United States**, with the exception of Illinois."
  - Creating voices through the API is **Enterprise-only**.
  - The console lets you create up to 30 voices for free.
  - The live listing on our key shows `cap: 30` and 0 voices.
- **For an India-based app, treat xAI voice cloning as NOT available.**

**xAI STT**:
- `POST https://api.x.ai/v1/stt`, multipart, using `grok-voice-transcribe-2.0`.
- Price: $0.10/hr (REST).
- Bengali is not in the published language table; Hindi is. Source: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text.md

---

## 2. LLM chat providers

All tests sent the same tiny prompt, `"Reply with exactly: OK"`, to `POST {base}/chat/completions`. Latency is wall-clock from this machine.

| Provider / key | Base URL | Model | Result | Latency |
|---|---|---|---|---|
| **LinkAPI** `LINKAPI_AzureOpenAI_KEY` | `https://api.linkapi.org/v1` | (none) | **FAILED: TLS handshake** | – |
| **LinkAPI** `LINKAPI_Gemini_Cheap_KEY` | `https://api.linkapi.org/v1` | (none) | **FAILED: TLS handshake** | – |
| OpenAI `Open_AI_2009_Key` | `https://api.openai.com/v1` | `gpt-4.1-mini` (served as `gpt-4.1-mini-2025-04-14`) | 200 "OK" | 2.35 s |
| OpenAI | same | `gpt-4o-mini` | 200 | 1.21 s |
| OpenAI | same | `gpt-5-mini` (`reasoning_effort:"minimal"`, `max_completion_tokens`) | 200, 0 reasoning tokens | 1.11 s |
| OpenAI | same | `gpt-5.4-mini` (`reasoning_effort:"none"`) | 200 | 1.49 s |
| OpenAI | same | `gpt-5.4-nano` (`reasoning_effort:"none"`) | 200 | 0.68 s |
| OpenRouter `OPENROUTER_API_KEY_1` | `https://openrouter.ai/api/v1` | `openai/gpt-4.1-mini` | 200, usage.cost $0.000008 | 1.15 s |
| OpenRouter | same | `google/gemini-2.5-flash` | 200 | 0.60 s |
| DeepSeek `DEEPSEEK_API_KEY_1` | `https://api.deepseek.com` | `deepseek-flash` | 200 | 1.30 s |
| Gemini `GEMINI_API_KEY_1` | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | **401** "API key not valid", reason `ACCESS_TOKEN_TYPE_UNSUPPORTED` | – |
| Gemini `GEMINI_API_KEY_3` (also `_4` lists models) | same | `gemini-2.5-flash` (`reasoning_effort:"none"`) | 200 | 0.51 s |
| Gemini `GEMINI_API_KEY_3` | same | `gemini-3.5-flash-lite` | 200 | 0.77 s |

Notes on the table:
- **LinkAPI is down over HTTPS, 2026-10-15 15:00 to 15:15 UTC.**
  - Every HTTPS request failed in the TLS handshake with `SSL alert 80`, "tlsv1 alert internal error". `curl`, `httpx` and `openssl s_client` all failed the same way, and so did TLS 1.2-only. The server presents no certificate.
  - DNS is fine: `api.linkapi.org` resolves via CNAME `agent.bltcy.cn` and `api.cdn2.closeai.fans` to `64.32.23.99`, the same answer from Google and Cloudflare DNS-over-HTTPS.
  - The host does answer on **plain HTTP**. An unauthenticated `GET http://api.linkapi.org/v1/models` returned 401 `{"error":{"code":"invalid_request","message":"Token not provided ...","type":"new_api_error"}}`, so it is a "new-api" relay.
  - **We did NOT send keys over plain HTTP.** As a result, the LinkAPI model list, chat, `/audio/transcriptions` and `/audio/speech` are all **UNKNOWN**.
  - Keep LinkAPI as an optional fallback only. Use OpenAI direct (or OpenRouter) as the primary.
- `GEMINI_API_KEY_1` begins `AQ.A` and is rejected (401). `GEMINI_API_KEY_2` is rejected (400, "API key not valid"). `GEMINI_API_KEY_3` and `GEMINI_API_KEY_4` work.
  - Models on key 3 include: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-flash-latest`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-2.5-flash-preview-tts`, `gemini-3.8-flash-tts`.
  - The OpenAI-compatible listing returns ids prefixed `models/`, but chat accepts the bare id.
- DeepSeek's `/models` lists `deepseek-flash` and `deepseek-v4-pro`.
- OpenAI's `/models` (133 ids) includes `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5.4-mini`, `gpt-5.4-nano`, `omni-moderation-latest`, `gpt-4o-mini-tts`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `gpt-transcribe` and `whisper-1`.

### 2.1 OpenAI moderation (LIVE): `POST https://api.openai.com/v1/moderations`

- Body: `{"model":"omni-moderation-latest","input": "<str or list>"}`. It returned 200 in 1.31 s.
- Response shape: `results[].{flagged, categories, category_scores, category_applied_input_types}`.
- Categories: harassment, harassment/threatening, sexual, hate, hate/threatening, illicit, illicit/violent, self-harm, self-harm/intent, self-harm/instructions, sexual/minors, violence, violence/graphic.
- Price: **Free** (https://developers.openai.com/api/docs/pricing.md).
- **Safety finding:**

| Input | Flagged | `self-harm/intent` |
|---|---|---|
| "I miss my father so much, I don't want to live without him." | no | 0.009 |
| "I want to end my life and join my father." | yes | 0.999 |
| Bengali "বাবাকে ছাড়া আমি আর বাঁচতে চাই না।" ("I don't want to live without father") | no | 0.121 |

  **Moderation alone misses passive and Bengali suicidal ideation.** Pair it with an LLM risk classifier and a keyword list in Bengali, Hindi and English, and use a low threshold on `self-harm*` scores, for example 0.05 or higher, to trigger a check-in.

### 2.2 OpenAI audio (LIVE)

- **TTS:** `POST /v1/audio/speech` with `{"model":"gpt-4o-mini-tts","voice":"coral","input":"Hello, I am here with you.","response_format":"mp3","instructions":"Warm, gentle, slow."}`. It returned 200 in 1.38 s, `audio/mpeg`, 56 KB.
- **Transcription:** `POST /v1/audio/transcriptions`, multipart `file`, `model`, `language`. All three models returned 200 and the text "Hello, I am here with you.":

| Model | Latency | `usage` in response |
|---|---|---|
| `gpt-4o-mini-transcribe` | 0.57 s | token usage |
| `gpt-4o-transcribe` | 1.56 s | token usage |
| `whisper-1` | 0.99 s | `{"type":"duration","seconds":4}` |

- `gpt-transcribe` also appears in the model list. We did not test it.

---

## 3. Sarvam AI (base `https://api.sarvam.ai`; header `api-subscription-key`)

**All three keys work** for TTS and STT: `SARVAM_2009_API_KEY`, `SARVAM_88_API_KEY` and `SARVAM_PHD_API_KEY` (LIVE, 2026-10-15).

### 3.1 TTS: `POST /text-to-speech` (DOC + LIVE)

Sources:
- https://docs.sarvam.ai/api-reference/text-to-speech/convert.md
- https://docs.sarvam.ai/api/getting-started/models/bulbul.md

Models:
- `bulbul:v3` is "stable, API default".
- `bulbul:v4-flash` is "latest, recommended for new integrations". It has persona voices; the Bengali ones are `arnab_bn_conversation`, `roopa_bn_conversational` and `bimal_bn_suspense`. v3 speaker names are not valid on it. We did not test it.
- `bulbul:v2` is legacy.
- The docs index says: "Bulbul V3 reaches end of life on Voice Agents on November 10, 2026". That notice is for the Voice Agents product only (https://docs.sarvam.ai/llms.txt).

Fields:
- `text`: up to 2500 characters on v3
- `language_code`: required. The current docs use this name. **The older `target_language_code` also still works (LIVE 200).**
- `model`
- `speaker`: lowercase
- `pace`: 0.5 to 2.0
- `temperature`: 0.01 to 1.0, default 0.6
- `speech_sample_rate`: 8000, 16000, 22050 (default), 24000, 32000, 44100 or 48000
- `output_audio_codec`: mp3, linear16, mulaw, alaw, flac, aac or wav (default). `opus` is rejected on v3.
- `dict_id`
- `pitch` and `loudness` are **not supported on v3**.

Response: `{"request_id": "...", "audios": ["<base64>"]}`.

Languages: bn-IN, en-IN, gu-IN, hi-IN, kn-IN, ml-IN, mr-IN, od-IN, pa-IN, ta-IN, te-IN.

Streaming:
- HTTP: `POST /text-to-speech/stream`
- WebSocket: `wss://api.sarvam.ai/text-to-speech/ws`

**bulbul:v3 speakers: 37 in total.** The live API's 400 error lists exactly these names. Gender comes from https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/how-to/change-the-speaker-voice.md
- Male (23): shubh (default), aditya, rahul, rohan, amit, dev, ratan, varun, manan, sumit, kabir, aayan, ashutosh, advait, anand, tarun, sunny, mani, gokul, vijay, mohit, rehan, soham
- Female (14): ritu, priya, neha, pooja, simran, kavya, ishita, shreya, roopa, tanya, shruti, suhani, kavitha, rupali
- Docs recommend for bn-IN: male `rehan`, female `roopa` or `suhani`.
- The docs say `varun` sounds "deep, dramatic".

**LIVE request that worked** (each key returned 200 in about 1.7 to 2.1 s):
```json
POST https://api.sarvam.ai/text-to-speech
api-subscription-key: sk_***
{"text":"আমি তোমার পাশে আছি।","language_code":"bn-IN","model":"bulbul:v3","speaker":"roopa","speech_sample_rate":16000,"output_audio_codec":"wav"}
```
- Response: `{"request_id":"20261015_<uuid>","audios":["<base64 WAV>"]}`.
- Decoded audio: RIFF WAV, PCM 16-bit mono.
- The same request also worked with `"target_language_code":"bn-IN","speaker":"shubh","speech_sample_rate":24000`.
- Invalid speaker: returns 400 `{"error":{"message":"Speaker 'zzz' is not recognized. Available speakers for bulbul:v3 are: ...","code":"invalid_request_error","request_id":...}}`.

### 3.2 STT: `POST /speech-to-text`, multipart (DOC + LIVE)

Sources:
- https://docs.sarvam.ai/api-reference/speech-to-text/transcribe.md
- https://docs.sarvam.ai/api/getting-started/models/saaras.md

Models:
- **Current: `saaras:v4`** (the default and recommended model).
- `saaras:v3` is still available.
- `saarika:v2.5` is "will be deprecated soon".

Fields:
- `file`
- `model`
- `language_code`: `unknown` for auto-detect, or bn-IN, hi-IN, en-IN and about 20 more
- `mode`: transcribe (default), translate, verbatim, translit or codemix
- `with_timestamps`
- `input_audio_codec`: only for PCM
- `keyterms`: a JSON array of up to 50 terms, v4 only

Formats: wav, mp3, aac, ogg, opus, flac, m4a, webm and others. 16 kHz is recommended.

**Max 30 s of audio on the sync REST endpoint.** Longer audio uses the Batch API (up to 2 h per file) or WebSocket streaming.

Response: `{request_id, transcript, language_code, language_probability?, timestamps?}`.

**LIVE** (all 3 keys returned 200 in about 1.4 s), sending the Sarvam TTS output back:
```
POST https://api.sarvam.ai/speech-to-text   (multipart)
file=a.wav (audio/wav), model=saaras:v4, language_code=unknown, mode=transcribe
-> {"request_id":"20261015_<uuid>","transcript":"আমি তোমার পাশে আছি।","language_code":"bn-IN","language_probability":1.0}
```
With `language_code=bn-IN`, the response is the same but without `language_probability`. The round-trip transcript was an exact match.

### 3.3 Sarvam voice cloning: YES (public API, beta). DOC only, not tested.

Sources:
- https://docs.sarvam.ai/api/api-guides-tutorials/voice-cloning/overview.md
- https://docs.sarvam.ai/api-reference/voice-cloning/create-voice.md
- https://docs.sarvam.ai/api-reference/voice-cloning/clone.md

Creating a saved voice:
- `POST /voices/create`, multipart: `file` (up to 50 MB; 10 to 15 s recommended), `name`, `language`, and optionally `style` and `gender`.
- It returns `voice_id` immediately.
- The voice cap is stated inconsistently: "3 voices on starter tier" in one place, "free plan's voice limit of 5" in another. Paid plans are uncapped.

Generating speech:
- `POST /voices/clone`, multipart, with exactly one of `voice_id` or `ref_audio` (up to 10 MB and 15 s, plus optional `ref_text`).
- Other fields: `text` (up to 1000 characters), `language_code` (bn-IN, hi-IN, en-IN and others), and optional `pace`, `output_audio_codec` and `speech_sample_rate`.
- Response: `{audio_b64, request_id, audio_duration}`.
- Works across languages.
- Streaming: `/voices/clone/stream` and `/voices/clone/ws`.

### 3.4 Sarvam pricing (INR; USD is UNKNOWN because no USD is published)

Two sources disagree slightly:

| Service | docs.sarvam.ai/api/getting-started/pricing.md | sarvam.ai/api-pricing (pay-as-you-go) |
|---|---|---|
| STT | ₹30/hour, billed per second | ₹0.49/min (about ₹29.4/h) |
| STT with diarization | ₹45/hour | ₹0.59/min (batch) |
| Bulbul v3 TTS | ₹30 per 10K characters | ₹3 per 1K characters (= ₹30 per 10K) |
| Bulbul v4-flash TTS | – | ₹2 per 1K characters |
| Voice cloning | ₹30 per 10K characters | ₹2 per 1K characters (₹20 per 10K) |
| Free credits | ₹100 for new users | "free credits", no amount given |

---

## 4. Fish Audio (DOC only; no key)

Sources:
- https://docs.fish.audio/developer-guide/models-pricing/models-overview.md
- https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech.md
- https://docs.fish.audio/api-reference/endpoint/model/create-model.md
- https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits.md
- https://huggingface.co/fishaudio/s2-pro

Models:
- `s2.1-pro` is the default and recommended model, with 83 languages.
- `s2.1-pro-free` costs $0 under fair use.
- `s1` supports 13 languages, **not including Bengali**, and retires on 2026-12-31.

Bengali:
- **Bengali (`bn`) is listed for S2-Pro** as an "other supported language", below Tier 1 and Tier 2.
- Bengali on S2.1-Pro specifically is not itemised. **Treat Bengali quality as UNVERIFIED.**

API:
- TTS: `POST https://api.fish.audio/v1/tts`, `Authorization: Bearer`, with a `model` header.
- Use a saved voice by passing `reference_id`.
- For an instant clone, pass `references:[{audio, text}]`. This requires a **MessagePack** body, not JSON.
- To create a persistent voice: `POST https://api.fish.audio/model`, multipart, with `type=tts`, `title`, `train_mode=fast` and `voices` files.

Price: **$15 per 1M UTF-8 bytes**. Bengali script takes about 3 bytes per character, so Bengali text costs roughly 3x what English does per character. That multiplier is our inference.

---

## 5. Safety: Indian crisis helplines (read 2026-10-15)

| Helpline | Number | Hours | Source |
|---|---|---|---|
| **Tele-MANAS** (MoHFW, Govt of India) | **14416** or **1-800-891-4416** (toll-free) | 24x7, about 20 languages depending on state | https://www.pib.gov.in/PressReleasePage.aspx?PRID=2063830 ; https://www.pib.gov.in/PressReleasePage.aspx?PRID=2224522 ; the official site https://telemanas.mohfw.gov.in/home has `phoneNumber:"1-800 891 4416",phoneNumbertwo:14416` in its JS bundle |
| **Vandrevala Foundation** | **+91 9999 666 555** (call or WhatsApp) | "Available 24 X 7 X 365" | https://www.vandrevalafoundation.com/free-counseling |
| **iCall** (TISS) | **9152987821** | **Mon–Sat 8:00 am–9:00 pm only** (not 24x7) | https://icallhelpline.org/ |
| **AASRA** | **+91-22-27546669** | 24x7 | http://www.aasra.info/ |

Notes:
- **Tele-MANAS:**
  - The 2022 launch release says "24X7 ... Toll Free Number- 14416" (https://www.pib.gov.in/PressReleasePage.aspx?PRID=1866498).
  - That same release misprints the alternate number as 1-800-91-4416. Use 1-800-891-4416.
- **Vandrevala:**
  - Its site banner says services will be affected on 20 and 27 Oct, 8–11 AM IST. The banner gives no year, but the page was published 2026-10-07, so this probably means October 2026.
- **AASRA:**
  - 9820466726 is a named contact person, not the helpline (http://www.aasra.info/contact.html).
- **KIRAN 1800-599-0019 has been merged into Tele-MANAS.**
  - PIB, 15 Feb 2024: "calls from KIRAN will be diverted to TeleMANAS and eventually, the first helpline will be phased out" (https://www.pib.gov.in/PressReleasePage.aspx?PRID=2006265).
  - Whether the number still forwards calls today: UNVERIFIED.
  - Do not list KIRAN.

## 6. Compliance: synthetically generated information (SGI) under the IT Rules 2021 (read 2026-10-15)

### Dates

| Step | Date | Source |
|---|---|---|
| Draft amendment | 22 Oct 2025, comments due 6 Nov 2025 | https://www.meity.gov.in/static/uploads/2025/10/38be31bac9d39bbe22f24fc42442d5d1.pdf |
| **Notified** | **G.S.R. 120(E), dated 10 Feb 2026** | MeitY FAQ: https://www.meity.gov.in/static/uploads/2025/10/065b6deb585441b5ccdf8be42502a49c.pdf |
| **In force** | **20 Feb 2026** | same FAQ |
| Corrigendum | G.S.R. 148(E), 26 Feb 2026 | consolidated rules: https://www.meity.gov.in/static/uploads/2026/03/0b576f2071694b52e4cd6bb1b6dfab1e.pdf |

We spot-checked the G.S.R. 120(E) / 10 Feb 2026 citation in the downloaded MeitY texts. The egazette.gov.in copy itself was not fetched.

### Definition: Rule 2(1)(wa)

The text: "audio, visual or audio-visual information which is artificially or algorithmically created, generated, modified or altered using a computer resource, in a manner that such information appears to be real, authentic or true and depicts or portrays any individual or event in a manner that is, or is likely to be perceived as indistinguishable from a natural person or real-world event".

What is excluded:
- Routine or good-faith editing.
- Good-faith documents and educational material.
- Accessibility and translation uses.
- Pure text. The FAQ says: "Pure text / written outputs, by themselves, are not SGI".

### Labelling and metadata: Rule 3(3)

- **Rule 3(3)(a)(ii)** requires content to be:
  - "prominently labelled ... easily noticeable and adequately perceivable, or, in the case of audio content, through a prominently prefixed audio disclosure", and
  - "embedded with a permanent metadata or other appropriate technical provenance mechanisms, to the extent technically feasible, including a unique identifier, to identify the computer resource of the intermediary used to create" it.
- **Rule 3(3)(b)**: the intermediary must "not enable the modification, suppression or removal of the label, permanent metadata, including the unique identifier".
- The FAQ gives guidance on both points:
  - An example audio disclosure: "This audio is synthetically generated".
  - No features such as "remove watermark" or "export without metadata".
- The **draft's 10%-of-screen and first-10%-of-audio rule was dropped** in the final text. Sources: the draft at https://www.meity.gov.in/static/uploads/2025/10/9de47fb06522b9e40a61e4731bc7de51.pdf, and Khaitan & Co at https://www.khaitanco.com/thought-leadership/MeitY-notifies-the-IT-Amendment-Rules-2026.

### Obligations on platforms that provide SGI creation tools

- **Rule 3(3)(a)(i)**: use technical measures to stop unlawful SGI from being created. This covers:
  - CSAM and non-consensual intimate imagery;
  - false documents;
  - content that "falsely depicts or portrays a natural person ... likely to deceive".
- **Rule 3(1)(ca)**: warn users about the penalties for misuse.
- **Rule 3(1)(c)**: send user notices "at least once every three months".

### Significant social media intermediaries (50 lakh or more users): Rule 4(1A)

- Users must declare whether content is SGI.
- The platform must verify that declaration.
- The platform must label SGI content.

### Timelines

| Action | New limit | Old limit |
|---|---|---|
| Takedown after a court or government order | **3 h** | 36 h |
| Intimate imagery or impersonation, including morphed images | **2 h** | 24 h |
| Grievance resolution | 7 days | 15 days |
| Removal requests | 36 h | 72 h |

Source: PIB, 6 Aug 2026, https://www.pib.gov.in/PressReleasePage.aspx?PRID=2295500.

### Pending

- **Draft Second Amendment Rules, 2026.** Published 30 Mar 2026; comments were due 7 May 2026 (https://www.meity.gov.in/static/uploads/2026/04/ec197f1206279efb4964965f0dede6c1.pdf).
  - It proposes a "continuous and clearly visible display of label ... throughout the duration of the content".
  - Whether it has been notified: UNVERIFIED, and no notification was found.
- **MeitY advisory of 8 Oct 2026** on labelling synthetic content. Reported by MediaNama (https://www.medianama.com/2026/10/223-meity-labelling-social-media-synthetic-content/); the original is UNVERIFIED.

### What this means for Miss You

The avatar's video and voice depict a real natural person, so they are SGI. To be safe:
- Show a persistent on-screen "AI-generated" label for the whole call, which also covers the pending continuous-label proposal.
- Play a spoken prefix such as "This is an AI-generated voice".
- Embed C2PA or XMP metadata with an app and session unique id in any exported media.
- Offer no export that strips the label.
- Block generation of intimate or deceptive content.
- Show the quarterly user notice.

The app is not an SSMI unless it reaches 50 lakh users.

---

## 7. Pricing summary (USD, read 2026-10-15)

| Item | Price | Source |
|---|---|---|
| OpenAI `gpt-4.1-mini` | $0.40 in / $0.10 cached / $1.60 out per 1M tokens | developers.openai.com/api/docs/pricing.md |
| OpenAI `gpt-4o-mini` | $0.15 / $0.075 / $0.60 per 1M | same |
| OpenAI `gpt-5-mini` | $0.25 / $0.025 / $2.00 per 1M | same |
| OpenAI `gpt-5.4-nano` | $0.20 / $0.02 / $1.25 per 1M | same |
| OpenAI `gpt-5.4-mini` | $0.75 / $0.075 / $4.50 per 1M | same |
| OpenRouter pass-through | gpt-4.1-mini $0.40/$1.60; gpt-4o-mini $0.15/$0.60; gemini-2.5-flash $0.30/$2.50 | LIVE `GET openrouter.ai/api/v1/models` |
| LinkAPI chat models | **UNKNOWN** (endpoint unreachable) | – |
| DeepSeek `deepseek-flash` | $0.30 in (cache miss) / $1.20 out per 1M at peak; half that off-peak | api-docs.deepseek.com/quick_start/pricing |
| Gemini `gemini-2.5-flash` (direct) | $0.30 in (text) / $2.50 out per 1M | ai.google.dev/gemini-api/docs/pricing |
| OpenAI moderation `omni-moderation-latest` | **Free** | OpenAI pricing |
| OpenAI `gpt-4o-mini-transcribe` | **$0.003/min** (est.); tokens $1.25 in / $5 out | OpenAI pricing |
| OpenAI `gpt-4o-transcribe` / `whisper-1` | $0.006/min | OpenAI pricing |
| OpenAI `gpt-transcribe` | $0.0045/min | OpenAI pricing |
| OpenAI `gpt-4o-mini-tts` | $0.60 per 1M text input tokens + **$12.00 per 1M audio output tokens**. Per-minute figure: **UNKNOWN** (not on page) | OpenAI pricing |
| Sarvam STT (saaras:v4) | ₹30/h, about ₹29.4/h on the website. USD: UNKNOWN | Sarvam pricing |
| Sarvam TTS bulbul:v3 | ₹30 per 10K characters. USD: UNKNOWN | Sarvam pricing |
| xAI image `grok-imagine-image-2.0` | $0.04 (low 1k) to $0.08 (medium 2k) per image; an edit costs more because the input image is billed (LIVE $0.05 for low 1k) | xAI pricing + LIVE |
| xAI image `grok-imagine-image` | $0.02 per image | xAI pricing |
| xAI video `grok-imagine-video-1.5-lite` / `-video` / `-video-1.5` | $0.020 / $0.050 / $0.080 per second (whether it varies by resolution is UNKNOWN) | xAI pricing |
| xAI TTS | $15 per 1M characters | xAI pricing |
| Fish Audio s2.1-pro | $15 per 1M UTF-8 bytes | Fish docs |
