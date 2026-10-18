import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, errorText, get, patch, post } from '../lib/api'
import type { Person, User } from '../lib/types'
import { useAuth } from '../store/auth'
import { Chip, Modal, Notice, PageHeader, Progress, Spinner, useToast } from '../components/ui'

// ------------------------------------------------------------------ types

interface Prefs {
  store_transcripts: boolean; daily_minutes_limit: number; call_soft_limit_min: number; captions: boolean; ambient: boolean
  audio_first: boolean; subtitle_lang: '' | 'en' | 'bn' | 'hi'; low_bandwidth: boolean; mood_checkin: boolean
  notify_letters: boolean; notify_special_days: boolean
}
interface Pack { id: string; credits: number; inr: number; label: string }
interface CreditsResp {
  balance: number; ledger: { delta: number; reason: string; balance: number; at: string }[]
  costs: Record<string, number>; packs: Pack[]; payments_configured: boolean
}
interface WellbeingResp { minutes_today: number; daily_limit: number; moods: { score: number; phase: string; at: string }[] }
interface SpecialDay { id: string; person_id: string; person_name: string; called_name: string; title: string; kind: string; month: number; day: number; notify: boolean; today: boolean }
interface DaysResp { days: SpecialDay[]; festivals: { title: string; month: number; day: number }[] }

const MAX_DAILY = 30
const LANGS = [{ v: 'en', l: 'English' }, { v: 'bn', l: 'বাংলা (Bengali)' }, { v: 'hi', l: 'हिन्दी (Hindi)' }]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_KINDS = [{ v: 'birthday', l: 'Birthday' }, { v: 'anniversary', l: 'Anniversary' }, { v: 'remembrance', l: 'Remembrance day' }, { v: 'festival', l: 'Festival' }, { v: 'other', l: 'Other' }]
const COST_LABEL: Record<string, string> = { voice_clone: 'Recreating a voice', scene_generation: 'Making a new place', call_minute: 'Each call minute', interview_minute: 'Each interview minute', letter: 'Sending a letter' }
const REASON_LABEL: Record<string, string> = { free_trial: 'Welcome credits', demo_grant: 'Demo credits', admin_adjustment: 'Added by an admin', call_minute: 'Call', interview_minute: 'Memory interview', letter: 'Letter', scene_generation: 'New place', voice_clone: 'Voice', refund: 'Refund' }

function readPrefs(u: User | null): Prefs {
  const p = (u?.prefs || {}) as Partial<Prefs>
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)
  return {
    store_transcripts: !!p.store_transcripts,
    daily_minutes_limit: Math.min(MAX_DAILY, Math.max(5, num(p.daily_minutes_limit, MAX_DAILY))),
    call_soft_limit_min: Math.min(30, Math.max(1, num(p.call_soft_limit_min, 15))),
    captions: p.captions ?? false,
    ambient: p.ambient ?? true,
    audio_first: p.audio_first ?? true,
    subtitle_lang: (p.subtitle_lang as Prefs['subtitle_lang']) || '',
    low_bandwidth: !!p.low_bandwidth,
    mood_checkin: !!p.mood_checkin,
    notify_letters: p.notify_letters ?? true,
    notify_special_days: p.notify_special_days ?? true,
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ------------------------------------------------------------------ small pieces

function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const hid = `${id || title.replace(/\W+/g, '-').toLowerCase()}-h`
  return (
    <section id={id} aria-labelledby={hid} className="card scroll-mt-24 space-y-4">
      <div>
        <h2 id={hid} className="text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-cream-200/70">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block font-semibold text-cream-50">{label}</span>
        {hint && <span className="block text-sm text-cream-200/65">{hint}</span>}
      </label>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 ring-1 transition before:absolute before:-inset-2 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-300 ${checked ? 'bg-ember-500 ring-ember-400' : 'bg-white/10 ring-white/20'}`}>
        <span className={`h-6 w-6 rounded-full bg-cream-50 shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ page

export default function Settings() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(() => {
    if (!loc.hash) return
    const id = loc.hash.slice(1)
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
    return () => window.clearTimeout(t)
  }, [loc.hash])

  if (!user) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={28} /></div>

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Settings" subtitle="Everything here is yours to change, at any time." />
      <ProfileSection user={user} />
      <PrefsSection user={user} />
      <WellbeingSection />
      <CreditsSection />
      <SpecialDaysSection />
      {user.role === 'admin' && !user.totp_enabled && <TwoFactorSection user={user} />}
      <DataSection user={user} />

      <section className="card space-y-4" aria-label="More">
        <nav aria-label="Help and legal" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Link className="btn-ghost text-sm" to="/faq">FAQ</Link>
          <Link className="btn-ghost text-sm" to="/support">Support</Link>
          <Link className="btn-ghost text-sm" to="/terms">Terms</Link>
          <Link className="btn-ghost text-sm" to="/privacy">Privacy</Link>
        </nav>
        <button className="btn-ghost w-full" onClick={async () => { await logout(); nav('/') }}>Sign out</button>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ profile

function ProfileSection({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser)
  const toast = useToast((s) => s.show)
  const [name, setName] = useState(user.display_name)
  const [lang, setLang] = useState(user.language || 'en')
  const save = useMutation({
    mutationFn: () => patch<{ user: User }>('/api/me', { display_name: name.trim(), language: lang }),
    onSuccess: (r) => { setUser(r.user); toast('Saved.') },
    onError: (e) => toast(errorText(e), 'error'),
  })
  const dirty = name.trim() !== user.display_name || lang !== user.language
  return (
    <Section title="You" subtitle={user.username ? `Signed in as ${user.username}` : user.email || undefined}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}>
        <div>
          <label className="label" htmlFor="display-name">What should we call you?</label>
          <input id="display-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
        </div>
        <div>
          <label className="label" htmlFor="ui-lang">App language</label>
          <select id="ui-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-cream-200/60">Calls follow each loved one's own language, set on their page.</p>
        </div>
        <button className="btn-primary w-full sm:w-auto" disabled={!dirty || !name.trim() || save.isPending}>{save.isPending && <Spinner size={18} />} Save</button>
      </form>
    </Section>
  )
}

// ------------------------------------------------------------------ prefs

function PrefsSection({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser)
  const toast = useToast((s) => s.show)
  const initial = readPrefs(user)
  const [p, setP] = useState<Prefs>(initial)
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((s) => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(p) !== JSON.stringify(initial)
  const save = useMutation({
    mutationFn: () => patch<{ user: User }>('/api/me', { prefs: p }),
    onSuccess: (r) => { setUser(r.user); setP(readPrefs(r.user)); toast('Your call preferences are saved.') },
    onError: (e) => toast(errorText(e), 'error'),
  })
  return (
    <Section title="Calls" subtitle="How calls feel, and how long they last.">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Toggle id="pref-transcripts" label="Keep the words from calls" hint="So you can read them back later. Off by default." checked={p.store_transcripts} onChange={(v) => set('store_transcripts', v)} />
        <Toggle id="pref-captions" label="Captions" hint="Show what's said on screen during calls. Off by default; tap CC in a call to show or hide them." checked={p.captions} onChange={(v) => set('captions', v)} />
        <div className="py-2">
          <label htmlFor="pref-sub" className="label">Captions in a second language</label>
          <select id="pref-sub" className="input" value={p.subtitle_lang} onChange={(e) => set('subtitle_lang', e.target.value as Prefs['subtitle_lang'])}>
            <option value="">None</option>
            <option value="en">English</option>
            <option value="bn">বাংলা (Bengali)</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </select>
        </div>
        <Toggle id="pref-ambient" label="Ambient sound" hint="Soft sounds of the place you're in." checked={p.ambient} onChange={(v) => set('ambient', v)} />
        <Toggle id="pref-audio" label="Start with voice first" hint="The picture joins once it's ready." checked={p.audio_first} onChange={(v) => set('audio_first', v)} />
        <Toggle id="pref-lowbw" label="Low data mode" hint="Voice with a gently animated photo instead of video." checked={p.low_bandwidth} onChange={(v) => set('low_bandwidth', v)} />
        <Toggle id="pref-mood" label="Quiet mood check" hint="One optional question before and after a call. Private to you." checked={p.mood_checkin} onChange={(v) => set('mood_checkin', v)} />

        <div className="space-y-2 py-3">
          <label htmlFor="pref-daily" className="flex justify-between gap-2 font-semibold text-cream-50">
            <span>Daily call time</span><span className="text-ember-300">{p.daily_minutes_limit} min</span>
          </label>
          <input id="pref-daily" type="range" min={5} max={MAX_DAILY} step={1} value={p.daily_minutes_limit}
            onChange={(e) => set('daily_minutes_limit', Number(e.target.value))} className="h-12 w-full accent-ember-500" aria-describedby="pref-daily-h" />
          <p id="pref-daily-h" className="text-sm text-cream-200/65">You can lower this to keep calls gentle. {MAX_DAILY} minutes a day is the most we offer.</p>
        </div>
        <div className="space-y-2 py-3">
          <label htmlFor="pref-soft" className="flex justify-between gap-2 font-semibold text-cream-50">
            <span>Gentle reminder after</span><span className="text-ember-300">{p.call_soft_limit_min} min</span>
          </label>
          <input id="pref-soft" type="range" min={1} max={30} step={1} value={p.call_soft_limit_min}
            onChange={(e) => set('call_soft_limit_min', Number(e.target.value))} className="h-12 w-full accent-ember-500" aria-describedby="pref-soft-h" />
          <p id="pref-soft-h" className="text-sm text-cream-200/65">During a call, they'll softly suggest saying goodbye around this time.</p>
        </div>

        <h3 className="pt-2 text-lg">Gentle notes</h3>
        <Toggle id="pref-nl" label="When a letter reply arrives" checked={p.notify_letters} onChange={(v) => set('notify_letters', v)} />
        <Toggle id="pref-nd" label="On special days" hint="A quiet reminder on dates you've saved." checked={p.notify_special_days} onChange={(v) => set('notify_special_days', v)} />

        <div className="flex flex-col gap-2 pt-3 sm:flex-row">
          <button className="btn-primary" disabled={!dirty || save.isPending}>{save.isPending && <Spinner size={18} />} Save call preferences</button>
          {dirty && <button type="button" className="btn-ghost" onClick={() => setP(initial)}>Undo changes</button>}
        </div>
      </form>
    </Section>
  )
}

// ------------------------------------------------------------------ wellbeing

function Sparkline({ moods }: { moods: { score: number; at: string; phase: string }[] }) {
  const w = 280
  const h = 64
  const pad = 6
  if (moods.length < 2) return null
  const xs = moods.map((_, i) => pad + (i * (w - pad * 2)) / (moods.length - 1))
  const ys = moods.map((m) => pad + ((5 - Math.min(5, Math.max(1, m.score))) * (h - pad * 2)) / 4)
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  const avg = (s: number[]) => s.reduce((a, b) => a + b, 0) / (s.length || 1)
  const half = Math.floor(moods.length / 2)
  const trend = avg(moods.slice(half).map((m) => m.score)) - avg(moods.slice(0, half).map((m) => m.score))
  const summary = trend > 0.3 ? 'a little lighter lately' : trend < -0.3 ? 'a little heavier lately' : 'fairly steady'
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full max-w-[320px]" role="img" aria-label={`Your mood over the last 30 days: ${summary}. ${moods.length} check-ins.`}>
        <line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} stroke="currentColor" strokeOpacity=".12" strokeDasharray="3 4" className="text-cream-200" />
        <path d={d} fill="none" stroke="#f7b07c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r="4" fill="#f7b07c" stroke="#1e1838" strokeWidth="2">
            <title>{`${fmtDate(moods[i].at)} (${moods[i].phase}): ${moods[i].score} of 5`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="text-sm text-cream-200/75">Your mood has been {summary}.</figcaption>
    </figure>
  )
}

function WellbeingSection() {
  const q = useQuery({ queryKey: ['wellbeing'], queryFn: () => get<WellbeingResp>('/api/me/wellbeing') })
  const d = q.data
  return (
    <Section title="Wellbeing" subtitle="Private to you, never used for engagement.">
      {q.isLoading && <Spinner />}
      {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}
      {d && (
        <div className="space-y-5">
          <div>
            <Progress value={d.daily_limit ? (d.minutes_today / d.daily_limit) * 100 : 0} label={`Today: ${d.minutes_today} of ${d.daily_limit} minutes`} />
          </div>
          {d.moods.length >= 2 ? <Sparkline moods={d.moods} /> : (
            <p className="text-sm text-cream-200/70">If you turn on the quiet mood check, a small private picture of how you've been feeling will appear here.</p>
          )}
          <p className="text-sm text-cream-200/70">If calls start to feel harder rather than softer, it's okay to take a break. <Link to="/support" className="font-semibold text-ember-300 underline">Talk to someone</Link></p>
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ credits

function CreditsSection() {
  const toast = useToast((s) => s.show)
  const [showAll, setShowAll] = useState(false)
  const [buyErr, setBuyErr] = useState('')
  const q = useQuery({ queryKey: ['credits'], queryFn: () => get<CreditsResp>('/api/me/credits') })
  const buy = useMutation({
    mutationFn: (pack: string) => post('/api/payments/order', { pack }),
    onMutate: () => setBuyErr(''),
    onSuccess: () => toast('Order created.'),
    onError: (e) => setBuyErr(errorText(e)),
  })
  const d = q.data
  const ledger = d ? (showAll ? d.ledger : d.ledger.slice(0, 5)) : []
  return (
    <Section id="credits" title="Credits" subtitle="Credits pay for the AI work behind each call, voice and letter.">
      {q.isLoading && <Spinner />}
      {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}
      {d && (
        <div className="space-y-5">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-4xl text-ember-300">✦ {d.balance}</span>
            <span className="text-cream-200/70">credits</span>
          </div>
          <div>
            <h3 className="mb-2 text-lg">What things cost</h3>
            <ul className="divide-y divide-white/5 rounded-2xl bg-night-950/40 ring-1 ring-white/10">
              {Object.entries(d.costs).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span className="text-cream-100/85">{COST_LABEL[k] || k}</span><span className="font-semibold text-cream-50">{v}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-lg">Add credits</h3>
            {!d.payments_configured && <div className="mb-3"><Notice>Payments aren't set up on this deployment yet. An admin can add credits for you.</Notice></div>}
            <div className="grid gap-2 sm:grid-cols-3">
              {d.packs.map((p) => (
                <button key={p.id} className="btn-ghost h-auto flex-col py-3" disabled={!d.payments_configured || buy.isPending}
                  onClick={() => buy.mutate(p.id)} aria-label={`Buy ${p.label} for ₹${p.inr}`}>
                  <span className="text-base text-cream-50">{p.label}</span>
                  <span className="text-sm text-cream-200/70">₹{p.inr}</span>
                </button>
              ))}
            </div>
            {buyErr && <div className="mt-3"><Notice tone="error">{buyErr}</Notice></div>}
          </div>
          {d.ledger.length > 0 && (
            <div>
              <h3 className="mb-2 text-lg">Recent activity</h3>
              <ul className="divide-y divide-white/5 rounded-2xl bg-night-950/40 ring-1 ring-white/10">
                {ledger.map((r, i) => (
                  <li key={`${r.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0"><span className="block truncate text-cream-100/85">{REASON_LABEL[r.reason] || r.reason.replace(/_/g, ' ')}</span><span className="text-xs text-cream-200/55">{fmtDate(r.at)}</span></span>
                    <span className={`shrink-0 font-semibold ${r.delta >= 0 ? 'text-emerald-300' : 'text-cream-100'}`}>{r.delta >= 0 ? '+' : ''}{r.delta}</span>
                  </li>
                ))}
              </ul>
              {d.ledger.length > 5 && <button className="btn-ghost mt-2 text-sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show less' : `Show all ${d.ledger.length}`}</button>}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ special days

function SpecialDaysSection() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const days = useQuery({ queryKey: ['special-days'], queryFn: () => get<DaysResp>('/api/special-days') })
  const people = useQuery({ queryKey: ['people'], queryFn: () => get<{ people: Person[] }>('/api/people') })
  const list = (people.data?.people ?? []).filter((p) => p.status !== 'refused')
  const [form, setForm] = useState({ person_id: '', title: '', kind: 'birthday', month: new Date().getMonth() + 1, day: new Date().getDate(), notify: true })
  const personId = form.person_id || list[0]?.id || ''
  const chosen = list.find((p) => p.id === personId)
  const chosenName = chosen ? chosen.called_name || chosen.name : 'them'

  const add = useMutation({
    mutationFn: (body: typeof form) => post('/api/special-days', body),
    onSuccess: () => {
      toast('Saved. We will gently remind you.')
      setForm((f) => ({ ...f, title: '' }))
      void qc.invalidateQueries({ queryKey: ['special-days'] })
    },
    onError: (e) => toast(errorText(e), 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/special-days/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['special-days'] }),
    onError: (e) => toast(errorText(e), 'error'),
  })
  const maxDay = new Date(2024, form.month, 0).getDate()

  return (
    <Section title="Special days" subtitle="Birthdays, anniversaries and festivals. We'll only send a quiet note if you want one.">
      {days.isError && <Notice tone="error">{errorText(days.error)}</Notice>}
      {days.data && days.data.days.length > 0 && (
        <ul className="space-y-2">
          {days.data.days.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-2xl bg-night-950/40 px-4 py-2 ring-1 ring-white/10">
              <div className="min-w-0">
                <div className="truncate font-semibold text-cream-50">{d.title} {d.today && <span className="ml-1 rounded-full bg-ember-500/20 px-2 py-0.5 text-xs text-ember-300">Today</span>}</div>
                <div className="text-sm text-cream-200/65">{d.day} {MONTHS[d.month - 1]} · {d.called_name || d.person_name}{!d.notify && ' · no reminder'}</div>
              </div>
              <button className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-cream-200/60 hover:bg-white/10 hover:text-red-200"
                aria-label={`Remove ${d.title}`} disabled={remove.isPending} onClick={() => remove.mutate(d.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {people.isSuccess && list.length === 0 ? (
        <p className="text-sm text-cream-200/70">Once you've set up someone you miss, you can save their special days here.</p>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (form.title.trim() && personId) add.mutate({ ...form, person_id: personId, title: form.title.trim() }) }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="sd-person">For</label>
              <select id="sd-person" className="input" value={personId} onChange={(e) => setForm({ ...form, person_id: e.target.value })}>
                {list.map((p) => <option key={p.id} value={p.id}>{p.called_name || p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sd-kind">Kind of day</label>
              <select id="sd-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {DAY_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="sd-title">Name of the day</label>
            <input id="sd-title" className="input" maxLength={120} value={form.title} placeholder="e.g. Ma's birthday" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sd-month">Month</label>
              <select id="sd-month" className="input" value={form.month} onChange={(e) => { const m = Number(e.target.value); setForm({ ...form, month: m, day: Math.min(form.day, new Date(2024, m, 0).getDate()) }) }}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sd-day">Day</label>
              <select id="sd-day" className="input" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
                {Array.from({ length: maxDay }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
          </div>
          <label className="flex min-h-[48px] cursor-pointer items-center gap-3">
            <input type="checkbox" className="h-5 w-5 accent-ember-500" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />
            <span>Gently remind me on the day</span>
          </label>
          <button className="btn-primary w-full sm:w-auto" disabled={!form.title.trim() || !personId || add.isPending}>{add.isPending && <Spinner size={18} />} Save day</button>
        </form>
      )}

      {days.data && days.data.festivals.length > 0 && list.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <h3 className="text-lg">Festivals</h3>
          <p className="text-sm text-cream-200/65">Tap to add one for {chosenName}. Dates are approximate — check your calendar.</p>
          <div className="flex flex-wrap gap-2">
            {days.data.festivals.map((f) => {
              const have = days.data.days.some((d) => d.person_id === personId && d.title === f.title)
              return (
                <Chip key={f.title} active={have} onClick={() => !have && !add.isPending && add.mutate({ person_id: personId, title: f.title, kind: 'festival', month: f.month, day: f.day, notify: true })}>
                  {have ? '✓ ' : '+ '}{f.title} · {f.day} {MONTHS[f.month - 1].slice(0, 3)}
                </Chip>
              )
            })}
          </div>
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ 2FA

function TwoFactorSection({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser)
  const toast = useToast((s) => s.show)
  const [code, setCode] = useState('')
  const setup = useMutation({ mutationFn: () => post<{ otpauth_uri: string; qr_svg: string }>('/api/auth/2fa/setup') })
  const verify = useMutation({
    mutationFn: () => post<{ user: User }>('/api/auth/2fa/verify', { code: code.trim() }),
    onSuccess: (r) => { setUser(r.user); toast('Two-factor sign-in is on.') },
  })
  return (
    <Section title="Admin two-factor" subtitle="Admin tools need an authenticator app code.">
      {user.admin_2fa_waived && <Notice>Two-factor is waived for this shared demo account, so you can open the admin panel without it.</Notice>}
      {!setup.data ? (
        <>
          <button className="btn-primary w-full sm:w-auto" disabled={setup.isPending} onClick={() => setup.mutate()}>{setup.isPending && <Spinner size={18} />} Set up two-factor</button>
          {setup.isError && <Notice tone="error">{errorText(setup.error)}</Notice>}
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-cream-100/85">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
          <div className="mx-auto w-full max-w-[220px] rounded-2xl bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" aria-label="Two-factor QR code" role="img"
            dangerouslySetInnerHTML={{ __html: setup.data.qr_svg }} />
          <details>
            <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-cream-200/75">Can't scan? Show the setup link</summary>
            <code className="block break-all rounded-xl bg-night-950/60 p-3 text-xs text-cream-100">{setup.data.otpauth_uri}</code>
          </details>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) verify.mutate() }}>
            <label htmlFor="totp" className="sr-only">6-digit code</label>
            <input id="totp" className="input sm:max-w-[200px]" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary" disabled={code.length < 6 || verify.isPending}>{verify.isPending && <Spinner size={18} />} Turn on</button>
          </form>
          {verify.isError && <Notice tone="error">{errorText(verify.error)}</Notice>}
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ data

function DataSection({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: () => del<{ deleted: boolean }>('/api/me?confirm=DELETE'),
    onSuccess: () => { setUser(null); nav('/', { replace: true }) },
  })
  return (
    <Section title="Your data" subtitle="Your photos, voices and words are encrypted and never shared publicly.">
      <a className="btn-ghost w-full sm:w-auto" href="/api/me/export" download>Download my data</a>
      <div className="border-t border-white/10 pt-4">
        <p className="mb-3 text-sm text-cream-200/70">Deleting your account permanently erases everyone you've set up, their photos, voices, calls, letters and memories.</p>
        <button className="btn-ghost w-full text-red-200 sm:w-auto" onClick={() => { setTyped(''); remove.reset(); setOpen(true) }}>Delete my account</button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete your account?">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (typed === 'DELETE') remove.mutate() }}>
          <p className="text-cream-100/85">This erases everything, for good. If you'd like a copy first, download your data before continuing.</p>
          {user.is_demo && <Notice>This is the shared demo account, so it can't be deleted.</Notice>}
          <div>
            <label className="label" htmlFor="confirm-delete">Type DELETE to confirm</label>
            <input id="confirm-delete" className="input" autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          {remove.isError && <Notice tone="error">{errorText(remove.error)}</Notice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Keep my account</button>
            <button className="btn-danger" disabled={typed !== 'DELETE' || remove.isPending}>{remove.isPending && <Spinner size={18} />} Delete everything</button>
          </div>
        </form>
      </Modal>
    </Section>
  )
}
