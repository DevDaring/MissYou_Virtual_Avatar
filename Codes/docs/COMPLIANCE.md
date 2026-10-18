# Compliance notes (draft — for the owner's legal review)

## India: labelling synthetically generated information
Checked 2026-10-15 (sources in research/provider_findings_2026-10-15.md, §6):
- IT (Intermediary Guidelines and Digital Media Ethics Code) Amendment Rules notified as **G.S.R. 120(E), 10 Feb 2026**, in force **20 Feb 2026**.
- Rule 2(1)(wa) defines synthetically generated audio/visual information that appears real and depicts an individual.
- Rule 3(3)(a)(ii): prominent visible label (or prefixed audio disclosure) **and** permanent metadata / provenance with a unique identifier where technically feasible; 3(3)(b): label and metadata must not be removable.
- A draft Second Amendment (30 Mar 2026) proposing a continuous label for the whole video — notification status **unverified**; we already label continuously.

### How Miss You complies
- Persistent "AI recreation" badge on every screen that shows the loved one, including the full-screen call header (always visible).
- Generated stills: PNG text + EXIF "AI-generated" labels and a keyed invisible watermark (`services/watermark.py`, test-verified).
- Generated videos: container metadata (`comment/title/artist` = AI-generated); served with `X-AI-Generated: true`.
- Exports (memory-box clips) burn a visible "AI-generated recreation · Miss You" banner; no clean voice audio export of arbitrary text exists.
- The recreation answers "are you real?" honestly (persona prompt rule 2).
- Gap: Chatterbox likely embeds Resemble's Perth audio watermark (unverified); Sarvam/OpenAI audio carries no watermark — mitigated by in-app labels and spoken honesty.

## Crisis resources (verified from official pages)
Tele-MANAS 14416 / 1-800-891-4416 (24×7) · Vandrevala Foundation +91 9999 666 555 (24×7) · AASRA 022-27546669 (24×7) · iCall 9152987821 (Mon–Sat 8–21) · emergency 112. KIRAN was merged into Tele-MANAS (PIB 2006265) and is not listed. Region-configurable in `config/support_resources.yaml`; re-verify before each release.

## Other safeguards implemented
18+ DOB gate · consent attestations stored with time, IP, user agent · minor and public-figure refusal (logged as counts) · crisis pause on every message · abuse/impersonation filter · daily minute limit and consecutive-day check-in · no public sharing (invite-only family access) · encryption at rest · export and hard delete with a per-provider report · report button in every call.

## Open items for legal review
Terms of Use and Privacy Policy pages are clearly-marked drafts. DPDP Act 2023 consent/notice wording, data-fiduciary obligations, grievance officer details, and the InsightFace model-weights licence (non-commercial) need review before commercial launch.
