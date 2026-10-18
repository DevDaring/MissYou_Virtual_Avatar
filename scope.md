# Scope — Miss You

## Problem statement
Grief and distance sever the everyday connection people had with a loved one. Existing tools (photo albums, videos) are passive — you can watch them but not _talk_ to them. People wish they could hear that person's voice again, see their face, and share what's new.

## Target users
- Adults mourning a family member who has passed away.
- People separated by distance from an elderly or unwell loved one.
- Families wanting to preserve a living memory for younger generations.

## Core value proposition
A short, clearly-labelled AI "video call" that recreates the experience of talking with someone you miss — built from the photos, videos, and voice notes you upload. The recreation speaks in the loved one's language and voice, remembers the stories you shared, and respects the cultural context of the family.

## What's in scope
| Feature | Priority |
|---|---|
| Upload memories (photos, videos, voice notes) with safety checks (minor, public-figure refusal) | P0 |
| AI face detection, clustering, and anchor selection | P0 |
| Voice cloning or preset voice (English, Hindi, Bengali) | P0 |
| AI scene generation showing the loved one in a familiar place | P0 |
| Live video-call UI (push-to-talk, captions, ambient soundscapes) | P0 |
| Safety pipeline (keywords, moderation, LLM classifier, crisis pause + helplines) | P0 |
| Persona system: the loved one's speech style, phrases, memories, cultural rules | P0 |
| "Who's calling" — multiple family callers with their own nicknames and topics | P1 |
| Change photo / edit name & details after setup | P1 |
| Memory box, letters, lip-synced keepsake videos | P2 |
| Budget metering, credits, admin panel | P1 |
| Installable PWA with offline caching | P1 |

## What's out of scope (for this hackathon)
- Payment integration (Razorpay interface stubbed, not wired).
- Email delivery (codes go to admin outbox).
- Google OAuth.
- Real-time lip-sync during live calls (too slow; approximate talking loop instead).
- GPU worker for restoration / faster cloning (CPU-only VPS).

## Success criteria
A jury member can sign in as TestUser, start a call with the demo persona "Ma", hold a natural Bengali/English conversation, and understand that they're talking to an AI recreation — safely, gently, and with cultural sensitivity.
