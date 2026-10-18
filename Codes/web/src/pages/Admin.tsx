import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, errorText, get, post } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../store/auth'
import { Notice, PageHeader, Spinner, useToast } from '../components/ui'

// ------------------------------------------------------------------ types

interface Spend {
  today_usd: number; month_usd: number; inr_per_usd: number
  caps: { global_daily: number; global_monthly: number; provider_daily: number; user_daily: number }
  by_day: { day: string; usd: number }[]
  by_provider: { provider: string; usd: number; calls: number }[]
  by_feature: { feature: string; capability: string; usd: number; calls: number }[]
  by_user: { user_id: string | null; usd: number; calls: number }[]
  failed_calls: number; unknown_price_calls: number
}
interface Overview { users: number; persons: number; calls: number; open_reports: number; failed_jobs: number; spend: Spend }
interface CapRow { primary: string | null; fallbacks: string[]; missing: string[]; down: string[]; pinned: string | null }
interface Providers { generated_at: string; capabilities: Record<string, CapRow>; providers: Record<string, { status: string; detail: string }>; ignored_banned_env?: number }
interface Latency { stages: Record<string, { n: number; p50: number; p90: number; max: number }>; targets: Record<string, number> }
interface AdminJob { id: string; kind: string; queue: string; status: string; progress: number; message: string; error: string; attempts: number; created_at: string; updated_at: string }
interface Safety {
  counts: { kind: string; category: string | null; count: number }[]
  events: { id: string; kind: string; category: string | null; detector: string; status: string; created_at: string; user_id: string | null }[]
  reports: { id: string; reason: string; details: string; status: string; call_id: string | null; created_at: string; admin_note: string | null }[]
  refused_profiles: { id: string; reason: string | null; owner_id: string; at: string }[]
}
interface AdminUserRow { id: string; email: string | null; username: string | null; display_name: string; role: string; credits: number; suspended: boolean; is_demo: boolean; created_at: string; last_login_at: string | null }
interface Flag { key: string; enabled: boolean; description: string }
interface Email { id: string; to: string; subject: string; kind: string; status: string; created_at: string; body: string }

const TABS = ['Overview', 'Providers', 'Spend', 'Latency', 'Jobs', 'Safety', 'Users', 'Flags', 'Outbox'] as const
type Tab = (typeof TABS)[number]

const usd = (v: number) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : 2)}`
const inr = (v: number, rate: number) => `₹${(v * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—')

// ------------------------------------------------------------------ shared bits

function is2fa(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403 && e.code === 'two_factor_required'
}

function TwoFactorCard() {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const verify = useMutation({
    mutationFn: () => post<{ user: User }>('/api/auth/2fa/verify', { code }),
    onSuccess: (r) => { setUser(r.user); void qc.invalidateQueries({ queryKey: ['admin'] }) },
  })
  return (
    <div className="card space-y-3">
      <h2 className="text-xl">Two-factor sign-in needed</h2>
      {user?.totp_enabled ? (
        <>
          <p className="text-cream-100/85">Enter the 6-digit code from your authenticator app to open admin tools for this session.</p>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (code.length >= 6) verify.mutate() }}>
            <label htmlFor="admin-totp" className="sr-only">6-digit code</label>
            <input id="admin-totp" className="input sm:max-w-[200px]" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            <button className="btn-primary" disabled={code.length < 6 || verify.isPending}>{verify.isPending && <Spinner size={18} />} Verify</button>
          </form>
          {verify.isError && <Notice tone="error">{errorText(verify.error)}</Notice>}
        </>
      ) : (
        <>
          <p className="text-cream-100/85">Admin tools need two-factor sign-in. Please turn it on in Settings first.</p>
          <Link className="btn-primary" to="/settings">Open Settings</Link>
        </>
      )}
    </div>
  )
}

function Q<T>({ q, children }: { q: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined }; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <div className="flex justify-center py-10 text-ember-300"><Spinner size={26} /></div>
  if (q.isError) return is2fa(q.error) ? <TwoFactorCard /> : <Notice tone="error">{errorText(q.error)}</Notice>
  if (!q.data) return null
  return <>{children(q.data)}</>
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'ok' }) {
  return (
    <div className="rounded-2xl bg-night-950/40 p-4 ring-1 ring-white/10">
      <div className="text-xs font-semibold uppercase tracking-wide text-cream-200/60">{label}</div>
      <div className={`mt-1 font-serif text-2xl ${tone === 'warn' ? 'text-ember-300' : 'text-cream-50'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-cream-200/60">{sub}</div>}
    </div>
  )
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-2xl ring-1 ring-white/10">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-white/5 text-xs uppercase tracking-wide text-cream-200/65">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {empty ? <tr><td colSpan={head.length} className="px-3 py-4 text-cream-200/60">Nothing here yet.</td></tr> : children}
        </tbody>
      </table>
    </div>
  )
}

const GOOD = new Set(['ok', 'configured', 'done', 'ready', 'resolved', 'sent', 'active'])
const BAD = new Set(['down', 'failed', 'error', 'open', 'suspended', 'over', 'no provider'])
const MID = new Set(['missing', 'queued', 'running', 'reviewed', 'pending', 'writing'])

function Pill({ s, tone }: { s: string; tone?: 'good' | 'bad' | 'mid' | 'neutral' }) {
  const t = tone || (GOOD.has(s) ? 'good' : BAD.has(s) ? 'bad' : MID.has(s) ? 'mid' : 'neutral')
  const cls = { good: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30', bad: 'bg-red-500/15 text-red-200 ring-red-400/30', mid: 'bg-ember-500/10 text-ember-300 ring-ember-400/30', neutral: 'bg-white/5 text-cream-200 ring-white/15' }[t]
  return <span className={`inline-block max-w-full break-words rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${cls}`}>{s}</span>
}

const H = ({ children }: { children: ReactNode }) => <h2 className="mb-3 mt-6 text-xl first:mt-0">{children}</h2>

// ------------------------------------------------------------------ page

export default function Admin() {
  const user = useAuth((s) => s.user)
  const [tab, setTab] = useState<Tab>('Overview')
  if (!user || user.role !== 'admin') {
    return (
      <div>
        <PageHeader title="Admins only" />
        <div className="card text-cream-100/85">This area is for the people who look after Miss You. <Link className="font-semibold text-ember-300 underline" to="/home">Back home</Link></div>
      </div>
    )
  }
  return (
    <div className="pb-8">
      <PageHeader title="Admin" subtitle={user.admin_2fa_waived ? 'Two-factor is waived for this demo account.' : 'Keep an eye on health, spend and safety.'} />
      <div role="tablist" aria-label="Admin sections" className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {TABS.map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}
            className={`min-h-[48px] shrink-0 rounded-full px-4 text-sm font-semibold ring-1 transition ${tab === t ? 'bg-ember-500/20 text-ember-300 ring-ember-400/50' : 'bg-white/5 text-cream-200/80 ring-white/10 hover:bg-white/10'}`}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Overview' && <OverviewTab />}
        {tab === 'Providers' && <ProvidersTab />}
        {tab === 'Spend' && <SpendTab />}
        {tab === 'Latency' && <LatencyTab />}
        {tab === 'Jobs' && <JobsTab />}
        {tab === 'Safety' && <SafetyTab />}
        {tab === 'Users' && <UsersTab />}
        {tab === 'Flags' && <FlagsTab />}
        {tab === 'Outbox' && <OutboxTab />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ overview

function OverviewTab() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => get<Overview>('/api/admin/overview') })
  return (
    <Q q={q}>{(d) => (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Users" value={d.users} />
          <Stat label="Loved ones" value={d.persons} />
          <Stat label="Calls" value={d.calls} />
          <Stat label="Open reports" value={d.open_reports} tone={d.open_reports ? 'warn' : undefined} />
          <Stat label="Failed jobs" value={d.failed_jobs} tone={d.failed_jobs ? 'warn' : undefined} />
          <Stat label="Failed provider calls" value={d.spend.failed_calls} sub="last 14 days" tone={d.spend.failed_calls ? 'warn' : undefined} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Spend today" value={usd(d.spend.today_usd)} sub={`${inr(d.spend.today_usd, d.spend.inr_per_usd)} · cap ${usd(d.spend.caps.global_daily)}`} />
          <Stat label="Spend this month" value={usd(d.spend.month_usd)} sub={`${inr(d.spend.month_usd, d.spend.inr_per_usd)} · cap ${usd(d.spend.caps.global_monthly)}`} />
        </div>
      </div>
    )}</Q>
  )
}

// ------------------------------------------------------------------ providers

function ProvidersTab() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const q = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => get<Providers>('/api/admin/providers') })
  const refresh = useMutation({
    mutationFn: () => post<Providers>('/api/admin/providers/refresh'),
    onSuccess: (r) => { qc.setQueryData(['admin', 'providers'], r); toast('Health refreshed.') },
    onError: (e) => toast(errorText(e), 'error'),
  })
  const pin = useMutation({
    mutationFn: (b: { capability: string; provider: string | null }) => post<Providers>('/api/admin/providers/primary', b),
    onSuccess: (r) => { qc.setQueryData(['admin', 'providers'], r); toast('Primary updated.') },
    onError: (e) => toast(errorText(e), 'error'),
  })
  return (
    <Q q={q}>{(d) => (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-cream-200/70">Checked {when(d.generated_at)}</p>
          <button className="btn-ghost text-sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending && <Spinner size={16} />} Refresh health</button>
        </div>
        {!!d.ignored_banned_env && <div className="mb-4"><Notice tone="warn">{d.ignored_banned_env} AWS / Google Cloud environment variable(s) are present and ignored by policy.</Notice></div>}
        <H>Capabilities</H>
        <ul className="space-y-3">
          {Object.entries(d.capabilities).map(([cap, r]) => {
            const options = Array.from(new Set([r.primary, ...r.fallbacks, ...r.down, ...r.missing].filter(Boolean) as string[]))
            return (
              <li key={cap} className="rounded-2xl bg-night-950/40 p-4 ring-1 ring-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-cream-50">{cap.replace(/_/g, ' ')}</span>
                  {r.primary ? <Pill s={r.primary} tone="good" /> : <Pill s="no provider" />}
                </div>
                <dl className="mt-2 grid gap-1 text-sm text-cream-200/75 sm:grid-cols-3">
                  <div><dt className="inline text-cream-200/55">Fallbacks: </dt><dd className="inline break-words">{r.fallbacks.join(', ') || '—'}</dd></div>
                  <div><dt className="inline text-cream-200/55">Down: </dt><dd className="inline break-words text-red-200">{r.down.join(', ') || '—'}</dd></div>
                  <div><dt className="inline text-cream-200/55">Missing: </dt><dd className="inline break-words">{r.missing.join(', ') || '—'}</dd></div>
                </dl>
                <div className="mt-3">
                  <label className="label" htmlFor={`pin-${cap}`}>Pinned primary</label>
                  <select id={`pin-${cap}`} className="input" value={r.pinned || ''} disabled={pin.isPending}
                    onChange={(e) => pin.mutate({ capability: cap, provider: e.target.value || null })}>
                    <option value="">Automatic (first healthy)</option>
                    {options.map((o) => <option key={o} value={o}>{o}{r.down.includes(o) ? ' (down)' : r.missing.includes(o) ? ' (missing)' : ''}</option>)}
                  </select>
                </div>
              </li>
            )
          })}
        </ul>
        <H>Provider health</H>
        <Table head={['Provider', 'Status', 'Detail']} empty={!Object.keys(d.providers || {}).length}>
          {Object.entries(d.providers || {}).map(([n, h]) => (
            <tr key={n}><td className="px-3 py-2 font-semibold text-cream-50">{n}</td><td className="px-3 py-2"><Pill s={h.status} /></td><td className="px-3 py-2 text-cream-200/70">{h.detail}</td></tr>
          ))}
        </Table>
      </div>
    )}</Q>
  )
}

// ------------------------------------------------------------------ spend

function SpendBars({ days, data }: { days: number; data: { day: string; usd: number }[] }) {
  const map = new Map(data.map((d) => [d.day, d.usd]))
  const today = new Date()
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)))
    const key = d.toISOString().slice(0, 10)
    return { day: key, usd: map.get(key) ?? 0 }
  })
  const max = Math.max(0.0001, ...series.map((s) => s.usd))
  const W = 340
  const Hh = 150
  const padB = 22
  const padT = 14
  const bw = W / days
  const [hover, setHover] = useState<number | null>(null)
  const total = series.reduce((a, b) => a + b.usd, 0)
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="h-auto w-full max-w-[640px]" role="img" aria-label={`Spend per day for the last ${days} days, total ${usd(total)}. Peak ${usd(max)}.`}>
        <line x1="0" x2={W} y1={Hh - padB} y2={Hh - padB} stroke="#efdfca" strokeOpacity=".2" />
        <text x="0" y="11" fontSize="11" fill="#efdfca" fillOpacity=".6">{usd(max)}</text>
        {series.map((s, i) => {
          const h = (s.usd / max) * (Hh - padB - padT)
          const x = i * bw + 1
          const w = Math.max(2, bw - 2)
          const y = Hh - padB - h
          return (
            <g key={s.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={i * bw} y={padT} width={bw} height={Hh - padB - padT} fill="transparent" />
              {h > 0 && <path d={`M${x} ${Hh - padB} V${y + Math.min(4, h)} Q${x} ${y} ${x + Math.min(4, w / 2)} ${y} H${x + w - Math.min(4, w / 2)} Q${x + w} ${y} ${x + w} ${y + Math.min(4, h)} V${Hh - padB} Z`}
                fill={hover === i ? '#fbd0a6' : '#f0925f'} />}
              <title>{`${s.day}: ${usd(s.usd)}`}</title>
              {(i === 0 || i === days - 1 || i === Math.floor(days / 2)) && (
                <text x={i === 0 ? 0 : i === days - 1 ? W : i * bw + bw / 2} y={Hh - 5} fontSize="11" textAnchor={i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle'} fill="#efdfca" fillOpacity=".6">{s.day.slice(5)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 text-sm text-cream-200/70">
        {hover !== null ? <>{series[hover].day}: <strong className="text-cream-50">{usd(series[hover].usd)}</strong></> : <>Daily spend, last {days} days · total {usd(total)}</>}
      </figcaption>
    </figure>
  )
}

function CapsForm({ caps }: { caps: Spend['caps'] }) {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(caps).map(([k, x]) => [k, String(x)])))
  const save = useMutation({
    mutationFn: () => post('/api/admin/caps', Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, Number(x)]))),
    onSuccess: () => { toast('Caps saved.'); void qc.invalidateQueries({ queryKey: ['admin'] }) },
    onError: (e) => toast(errorText(e), 'error'),
  })
  const labels: Record<string, string> = { global_daily: 'Global daily (USD)', global_monthly: 'Global monthly (USD)', provider_daily: 'Per provider daily (USD)', user_daily: 'Per user daily (USD)' }
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      {Object.keys(labels).map((k) => (
        <div key={k}>
          <label className="label" htmlFor={`cap-${k}`}>{labels[k]}</label>
          <input id={`cap-${k}`} className="input" type="number" min={0} step="0.01" inputMode="decimal" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        </div>
      ))}
      <div className="sm:col-span-2"><button className="btn-primary w-full sm:w-auto" disabled={save.isPending}>{save.isPending && <Spinner size={18} />} Save caps</button></div>
    </form>
  )
}

function SpendTab() {
  const days = 14
  const q = useQuery({ queryKey: ['admin', 'spend', days], queryFn: () => get<Spend>(`/api/admin/spend?days=${days}`) })
  return (
    <Q q={q}>{(d) => (
      <div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Today" value={usd(d.today_usd)} sub={`${inr(d.today_usd, d.inr_per_usd)} of ${usd(d.caps.global_daily)} cap`} tone={d.today_usd >= d.caps.global_daily * 0.8 ? 'warn' : undefined} />
          <Stat label="This month" value={usd(d.month_usd)} sub={`${inr(d.month_usd, d.inr_per_usd)} of ${usd(d.caps.global_monthly)} cap`} tone={d.month_usd >= d.caps.global_monthly * 0.8 ? 'warn' : undefined} />
          <Stat label="Failed provider calls" value={d.failed_calls} tone={d.failed_calls ? 'warn' : undefined} />
          <Stat label="Unknown-price calls" value={d.unknown_price_calls} tone={d.unknown_price_calls ? 'warn' : undefined} sub="cost estimated" />
        </div>
        <H>By day</H>
        <div className="rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10"><SpendBars days={days} data={d.by_day} /></div>
        <H>By provider</H>
        <Table head={['Provider', 'USD', 'INR', 'Calls']} empty={!d.by_provider.length}>
          {d.by_provider.map((r) => <tr key={r.provider}><td className="px-3 py-2 text-cream-50">{r.provider}</td><td className="px-3 py-2">{usd(r.usd)}</td><td className="px-3 py-2">{inr(r.usd, d.inr_per_usd)}</td><td className="px-3 py-2">{r.calls}</td></tr>)}
        </Table>
        <H>By feature</H>
        <Table head={['Feature', 'Capability', 'USD', 'Calls']} empty={!d.by_feature.length}>
          {d.by_feature.map((r) => <tr key={`${r.feature}-${r.capability}`}><td className="px-3 py-2 text-cream-50">{r.feature}</td><td className="px-3 py-2">{r.capability}</td><td className="px-3 py-2">{usd(r.usd)}</td><td className="px-3 py-2">{r.calls}</td></tr>)}
        </Table>
        <H>By user</H>
        <Table head={['User', 'USD', 'Calls']} empty={!d.by_user.length}>
          {d.by_user.map((r) => <tr key={r.user_id || 'system'}><td className="px-3 py-2 font-mono text-xs text-cream-50">{r.user_id ? shortId(r.user_id) : 'system'}</td><td className="px-3 py-2">{usd(r.usd)}</td><td className="px-3 py-2">{r.calls}</td></tr>)}
        </Table>
        <H>Budget caps</H>
        <CapsForm caps={d.caps} />
      </div>
    )}</Q>
  )
}

// ------------------------------------------------------------------ latency

function LatencyTab() {
  const q = useQuery({ queryKey: ['admin', 'latency'], queryFn: () => get<Latency>('/api/admin/latency') })
  return (
    <Q q={q}>{(d) => {
      const rows = Object.entries(d.stages)
      return (
        <div className="space-y-4">
          <p className="text-sm text-cream-200/70">Last 7 days of assistant turns. Target: first audio under {(d.targets.first_audio_ms ?? 4000) / 1000}s.</p>
          <Table head={['Stage', 'n', 'p50', 'p90', 'max', 'Target']} empty={!rows.length}>
            {rows.map(([s, v]) => {
              const target = d.targets[s]
              const over = target !== undefined && v.p90 > target
              return (
                <tr key={s}>
                  <td className="px-3 py-2 text-cream-50">{s.replace(/_ms$/, '').replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2">{v.n}</td>
                  <td className="px-3 py-2">{v.p50} ms</td>
                  <td className={`px-3 py-2 ${over ? 'font-semibold text-ember-300' : ''}`}>{v.p90} ms</td>
                  <td className="px-3 py-2">{v.max} ms</td>
                  <td className="px-3 py-2">{target !== undefined ? <>{target} ms {over ? <Pill s="over" /> : <Pill s="ok" />}</> : '—'}</td>
                </tr>
              )
            })}
          </Table>
        </div>
      )
    }}</Q>
  )
}

// ------------------------------------------------------------------ jobs

function JobsTab() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [status, setStatus] = useState('')
  const q = useQuery({ queryKey: ['admin', 'jobs', status], queryFn: () => get<{ counts: Record<string, number>; jobs: AdminJob[] }>(`/api/admin/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`) })
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'cancel' }) => post(`/api/admin/jobs/${id}/${action}`),
    onSuccess: (_r, v) => { toast(v.action === 'retry' ? 'Job queued again.' : 'Job cancelled.'); void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] }) },
    onError: (e) => toast(errorText(e), 'error'),
  })
  return (
    <Q q={q}>{(d) => (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {['', ...Object.keys(d.counts)].map((s) => (
            <button key={s || 'all'} aria-pressed={status === s} onClick={() => setStatus(s)}
              className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ring-1 ${status === s ? 'bg-ember-500/20 text-ember-300 ring-ember-400/60' : 'bg-white/5 text-cream-100 ring-white/15'}`}>
              {s || 'All'}{s ? ` · ${d.counts[s]}` : ` · ${Object.values(d.counts).reduce((a, b) => a + b, 0)}`}
            </button>
          ))}
        </div>
        {d.jobs.length === 0 ? <p className="text-cream-200/70">No jobs{status ? ` with status “${status}”` : ''}.</p> : (
          <ul className="space-y-2">
            {d.jobs.map((j) => (
              <li key={j.id} className="rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-cream-50">{j.kind}</span>
                  <span className="flex items-center gap-2"><Pill s={j.status} /><span className="text-xs text-cream-200/60">{j.progress}%</span></span>
                </div>
                <div className="mt-1 text-xs text-cream-200/60">{j.queue} · {when(j.created_at)} · attempts {j.attempts} · <span className="font-mono">{shortId(j.id)}</span></div>
                {j.message && <div className="mt-1 text-sm text-cream-100/80">{j.message}</div>}
                {j.error && <div className="mt-1 break-words font-mono text-xs text-red-200/90">{j.error}</div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {(j.status === 'failed' || j.status === 'cancelled') && (
                    <button className="btn-ghost min-h-[44px] text-sm" disabled={act.isPending || j.attempts >= 2} onClick={() => act.mutate({ id: j.id, action: 'retry' })}
                      title={j.attempts >= 2 ? 'Already retried twice' : undefined}>Retry</button>
                  )}
                  {(j.status === 'queued' || j.status === 'running') && (
                    <button className="btn-ghost min-h-[44px] text-sm text-red-200" disabled={act.isPending} onClick={() => act.mutate({ id: j.id, action: 'cancel' })}>Cancel</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )}</Q>
  )
}

// ------------------------------------------------------------------ safety

function ResolveRow({ path, status, label }: { path: string; status: string; label: ReactNode }) {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [st, setSt] = useState(status)
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: () => post(path, { status: st, note }),
    onSuccess: () => { toast('Updated.'); void qc.invalidateQueries({ queryKey: ['admin', 'safety'] }) },
    onError: (e) => toast(errorText(e), 'error'),
  })
  const id = path.replace(/\W+/g, '-')
  return (
    <li className="space-y-2 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
      {label}
      <form className="grid gap-2 sm:grid-cols-[160px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <label className="sr-only" htmlFor={`${id}-st`}>Status</label>
        <select id={`${id}-st`} className="input" value={st} onChange={(e) => setSt(e.target.value)}>
          {['open', 'reviewed', 'resolved', 'dismissed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="sr-only" htmlFor={`${id}-note`}>Note</label>
        <input id={`${id}-note`} className="input" maxLength={500} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-ghost text-sm" disabled={save.isPending}>Save</button>
      </form>
    </li>
  )
}

function SafetyTab() {
  const q = useQuery({ queryKey: ['admin', 'safety'], queryFn: () => get<Safety>('/api/admin/safety') })
  return (
    <Q q={q}>{(d) => (
      <div>
        <p className="mb-4 text-sm text-cream-200/70">Counts and categories only — what people said is never shown here.</p>
        <H>Last 30 days</H>
        <Table head={['Kind', 'Category', 'Count']} empty={!d.counts.length}>
          {d.counts.map((c) => <tr key={`${c.kind}-${c.category}`}><td className="px-3 py-2 text-cream-50">{c.kind}</td><td className="px-3 py-2">{c.category || '—'}</td><td className="px-3 py-2">{c.count}</td></tr>)}
        </Table>
        <H>Events</H>
        {d.events.length === 0 ? <p className="text-cream-200/70">No safety events.</p> : (
          <ul className="space-y-2">
            {d.events.map((e) => (
              <ResolveRow key={e.id} path={`/api/admin/safety/${e.id}`} status={e.status}
                label={<div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-cream-50">{e.kind}</span>{e.category && <span className="text-cream-200/75">{e.category}</span>}<Pill s={e.status} /><span className="text-xs text-cream-200/55">{e.detector} · {when(e.created_at)} · user {shortId(e.user_id)}</span></div>} />
            ))}
          </ul>
        )}
        <H>User reports</H>
        {d.reports.length === 0 ? <p className="text-cream-200/70">No reports.</p> : (
          <ul className="space-y-2">
            {d.reports.map((r) => (
              <ResolveRow key={r.id} path={`/api/admin/reports/${r.id}`} status={r.status}
                label={<div className="space-y-1 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-cream-50">{r.reason}</span><Pill s={r.status} /><span className="text-xs text-cream-200/55">{when(r.created_at)} · call {shortId(r.call_id)}</span></div>{r.details && <p className="text-cream-100/80">{r.details}</p>}{r.admin_note && <p className="text-xs text-cream-200/60">Note: {r.admin_note}</p>}</div>} />
            ))}
          </ul>
        )}
        <H>Refused profiles</H>
        <Table head={['Profile', 'Reason', 'Owner', 'When']} empty={!d.refused_profiles.length}>
          {d.refused_profiles.map((p) => <tr key={p.id}><td className="px-3 py-2 font-mono text-xs">{shortId(p.id)}</td><td className="px-3 py-2 text-cream-50">{p.reason || '—'}</td><td className="px-3 py-2 font-mono text-xs">{shortId(p.owner_id)}</td><td className="px-3 py-2">{when(p.at)}</td></tr>)}
        </Table>
      </div>
    )}</Q>
  )
}

// ------------------------------------------------------------------ users

function UserCard({ u }: { u: AdminUserRow }) {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const me = useAuth((s) => s.user)
  const refresh = useAuth((s) => s.refresh)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('admin_adjustment')
  const act = useMutation({
    mutationFn: (b: { credits_delta?: number; suspended?: boolean; reason: string }) => post<{ ok: boolean; credits: number }>(`/api/admin/users/${u.id}`, b),
    onSuccess: () => {
      toast('Updated.')
      setDelta('')
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      if (me?.id === u.id) void refresh()
    },
    onError: (e) => toast(errorText(e), 'error'),
  })
  const n = Number(delta)
  return (
    <li className="space-y-3 rounded-2xl bg-night-950/40 p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-cream-50">{u.display_name || '—'} {u.is_demo && <span className="text-xs text-dusk-300">(demo)</span>}</div>
          <div className="truncate text-xs text-cream-200/60">{u.username || u.email || shortId(u.id)} · {u.role} · last in {when(u.last_login_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          {u.suspended && <Pill s="suspended" />}
          <span className="font-semibold text-ember-300">✦ {u.credits}</span>
        </div>
      </div>
      <form className="grid gap-2 sm:grid-cols-[120px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (n) act.mutate({ credits_delta: Math.trunc(n), reason: reason.trim() || 'admin_adjustment' }) }}>
        <label className="sr-only" htmlFor={`d-${u.id}`}>Credits change</label>
        <input id={`d-${u.id}`} className="input" type="number" step={1} inputMode="numeric" placeholder="+100 / −50" value={delta} onChange={(e) => setDelta(e.target.value)} />
        <label className="sr-only" htmlFor={`r-${u.id}`}>Reason</label>
        <input id={`r-${u.id}`} className="input" maxLength={60} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn-ghost text-sm" disabled={!n || act.isPending}>Adjust credits</button>
      </form>
      {!u.is_demo && u.id !== me?.id && (
        <button className={`btn-ghost text-sm ${u.suspended ? '' : 'text-red-200'}`} disabled={act.isPending}
          onClick={() => act.mutate({ suspended: !u.suspended, reason: u.suspended ? 'unsuspend' : 'suspend' })}>
          {u.suspended ? 'Lift suspension' : 'Suspend'}
        </button>
      )}
    </li>
  )
}

function UsersTab() {
  const [input, setInput] = useState('')
  const [term, setTerm] = useState('')
  const q = useQuery({ queryKey: ['admin', 'users', term], queryFn: () => get<{ users: AdminUserRow[] }>(`/api/admin/users?q=${encodeURIComponent(term)}`) })
  return (
    <div className="space-y-4">
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(input.trim()) }}>
        <label htmlFor="user-q" className="sr-only">Search users</label>
        <input id="user-q" className="input" type="search" placeholder="Name, username or email" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn-ghost shrink-0">Search</button>
      </form>
      <Q q={q}>{(d) => d.users.length === 0 ? <p className="text-cream-200/70">No users found.</p> : (
        <ul className="space-y-2">{d.users.map((u) => <UserCard key={u.id} u={u} />)}</ul>
      )}</Q>
    </div>
  )
}

// ------------------------------------------------------------------ flags

function FlagsTab() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const q = useQuery({ queryKey: ['admin', 'flags'], queryFn: () => get<{ flags: Flag[] }>('/api/admin/flags') })
  const set = useMutation({
    mutationFn: (f: { key: string; enabled: boolean }) => post(`/api/admin/flags/${encodeURIComponent(f.key)}`, { enabled: f.enabled }),
    onSuccess: (_r, f) => { toast(`${f.key.replace(/_/g, ' ')} ${f.enabled ? 'on' : 'off'}.`); void qc.invalidateQueries({ queryKey: ['admin', 'flags'] }) },
    onError: (e) => toast(errorText(e), 'error'),
  })
  return (
    <Q q={q}>{(d) => (
      <ul className="divide-y divide-white/5 rounded-2xl bg-night-950/40 ring-1 ring-white/10">
        {d.flags.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <label htmlFor={`flag-${f.key}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="block font-semibold text-cream-50">{f.key.replace(/_/g, ' ')}</span>
              <span className="block text-sm text-cream-200/65">{f.description}</span>
            </label>
            <button id={`flag-${f.key}`} role="switch" aria-checked={f.enabled} disabled={set.isPending} onClick={() => set.mutate({ key: f.key, enabled: !f.enabled })}
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 ring-1 transition before:absolute before:-inset-2 before:content-[''] ${f.enabled ? 'bg-ember-500 ring-ember-400' : 'bg-white/10 ring-white/20'}`}>
              <span className={`h-6 w-6 rounded-full bg-cream-50 shadow transition-transform ${f.enabled ? 'translate-x-6' : ''}`} />
            </button>
          </li>
        ))}
      </ul>
    )}</Q>
  )
}

// ------------------------------------------------------------------ outbox

function OutboxTab() {
  const q = useQuery({ queryKey: ['admin', 'outbox'], queryFn: () => get<{ emails: Email[] }>('/api/admin/outbox') })
  return (
    <Q q={q}>{(d) => d.emails.length === 0 ? <p className="text-cream-200/70">No emails in the outbox.</p> : (
      <ul className="space-y-2">
        {d.emails.map((m) => (
          <li key={m.id} className="rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
            <details>
              <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><span className="block truncate font-semibold text-cream-50">{m.subject}</span><span className="block truncate text-xs text-cream-200/60">{m.to} · {m.kind} · {when(m.created_at)}</span></span>
                <Pill s={m.status} />
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-cream-100/80">{m.body}</pre>
            </details>
          </li>
        ))}
      </ul>
    )}</Q>
  )
}
