# Pricing notes (proposed — the owner sets final numbers in config/pricing.yaml)

Measured on the demo build (2026-10-15, provider_usage table):
| Action | Measured provider cost |
|---|---|
| Scene (1 still incl. 1 retry-free edit + 3 × 8 s video loops) | $0.13 images + $0.69 video ≈ **$0.82** (xAI billed $0.69 for 3 × 8 s at 720p vs $0.48 list — use actual ticks) |
| Call minute (≈4 turns: STT + safety + LLM + TTS) | ≈ $0.004 STT + $0.003 LLM + $0.006 TTS ≈ **$0.013** |
| Voice clone (preview only; cloning itself is local or per-request) | < $0.002 |
| Letter (LLM + ~100 words TTS + local video) | ≈ $0.01 |

Proposed credits with 1 credit ≈ ₹1 and a target margin ≥ 50 % at ₹88/USD:
| Action | Cost ₹ | Credits | Margin |
|---|---|---|---|
| Scene generation | ≈ ₹72 | 60 *(below cost — subsidised because it is cached and reused for every future call)* | −17 % one-off |
| Call minute | ≈ ₹1.2 | 5 | ~76 % |
| Interview minute | ≈ ₹0.8 | 2 | ~60 % |
| Voice clone | ≈ ₹0.2 | 20 | covers setup compute |
| Letter | ≈ ₹1 | 15 | ~93 % |
Free trial: 200 credits (≈ 1 scene + ~25 call minutes). Packs: 200/₹199, 600/₹499, 1500/₹1099.
**Decision needed:** raise `scene_generation` to ≥ 120 credits, or keep it subsidised.
