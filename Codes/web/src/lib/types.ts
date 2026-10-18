export interface User {
  id: string; email: string | null; username: string | null; display_name: string; role: string; language: string
  timezone: string; region: string; prefs: Record<string, unknown>; credits: number; is_demo: boolean
  totp_enabled: boolean; mfa: boolean; onboarded: boolean; admin_2fa_waived: boolean
}
export interface Persona {
  speech_style?: string; phrases?: string[] | string; nicknames?: string[] | string; greeting?: string; goodbye?: string
  humour?: string; topics_loved?: string[] | string; topics_avoid?: string[] | string; languages?: string[] | string
  code_mix?: string; heaven_framing?: boolean; use_transcripts?: boolean; outfit_style?: string
  callers?: Caller[]
}
/** A family member who calls this loved one from the same account. */
export interface Caller { id: string; name: string; relation: string; nickname: string; calls_them: string; notes?: string }
export interface Person {
  id: string; name: string; called_name: string; relationship: string; age: number | null; gender: string
  life_status: 'passed' | 'far'; call_language: 'en' | 'bn' | 'hi'; persona: Persona; status: string; setup_step: string
  refused_reason: string | null; chosen_cluster_id: string | null; voice_profile_id: string | null; cover_url?: string | null
  closure: { active?: boolean; sessions_done?: number; total?: number; completed?: boolean }; is_demo: boolean
  shared?: boolean; media_counts?: Record<string, number>; voice?: Voice | null; consented?: boolean; anchor_count?: number
  is_owner?: boolean; keep_raw_uploads: boolean
}
export interface Voice { id: string; kind: string; provider: string; engine: string; label: string; language: string; rating: number | null; preview_url: string | null; voice_id?: string | null }
export interface Scene {
  id: string; person_id: string; location_key: string; location_label: string; ambient: string; activity: string
  time_of_day: string; weather: string; outfit: string; status: string; progress: number; mode: string; notes: string[]
  error: string | null; identity_score: number | null; still_url: string | null; idle_url: string | null
  listening_url: string | null; talking_url: string | null; generations: number
}
export interface CallInfo {
  id: string; person_id: string; kind: string; status: string; language: string; store_transcript: boolean
  soft_limit_s: number; started_at: string; ended_at: string | null; duration_s: number; end_reason: string
  reflection: string | null; credits_charged: number; scene?: Scene; person?: { name: string; called_name: string; relationship: string }
  place?: string; thumb?: string | null; caller?: Caller | null
}
export interface Job { id: string; kind: string; status: string; progress: number; message: string; result?: Record<string, unknown>; person_id?: string | null }
export interface SupportResources { title: string; intro: string; lines: { name: string; phone: string; alt?: string; hours: string; url: string }[]; emergency?: { name: string; phone: string } }
