import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { Notice, Spinner } from '../components/ui'
import { errorText, get, post } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../store/auth'

const SLIDES = [
  { t: 'What this is', b: 'Miss You lets you have a short, gentle video call with an AI recreation of someone you miss — made only from the photos, videos and voice notes you choose to share.' },
  { t: 'What it is not', b: "It is not them, and it can't truly be them. It will never claim to be alive or to speak from anywhere beyond. Every screen is labelled AI, and if you ask, it will tell you honestly." },
  { t: 'Meant to comfort', b: "It's here to comfort, not to replace grief, family, friends or professional support. Calls are short, there's a daily limit, and if you're ever in distress the call pauses and shows people you can talk to right now." },
]

export default function Onboarding() {
  const nav = useNavigate()
  const { user, setUser } = useAuth()
  const [i, setI] = useState(0)
  const [statements, setStatements] = useState<string[]>([])
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (user?.onboarded) nav('/home', { replace: true }) }, [user, nav])
  useEffect(() => { get<{ statements: string[] }>('/api/onboarding').then((r) => setStatements(r.statements)).catch(() => {}) }, [])
  const all = statements.length > 0 && statements.every((_, k) => checked[k])

  async function finish() {
    setBusy(true); setErr(null)
    try { const r = await post<{ user: User }>('/api/onboarding', { understood: statements }); setUser(r.user); nav('/home', { replace: true }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <AuthShell title={i < SLIDES.length ? SLIDES[i].t : 'Before we begin'} subtitle={`Step ${Math.min(i + 1, 4)} of 4`}>
      {i < SLIDES.length ? (
        <div className="card">
          <p className="text-lg leading-relaxed text-cream-100/90">{SLIDES[i].b}</p>
          <div className="mt-6 flex gap-3">
            {i > 0 && <button className="btn-ghost flex-1" onClick={() => setI(i - 1)}>Back</button>}
            <button className="btn-primary flex-1" onClick={() => setI(i + 1)}>Continue</button>
          </div>
        </div>
      ) : (
        <div className="card space-y-4">
          <p className="text-cream-200/80">Please confirm you understand:</p>
          {statements.map((s, k) => (
            <label key={k} className="flex items-start gap-3 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-ember-500" checked={!!checked[k]} onChange={(e) => setChecked({ ...checked, [k]: e.target.checked })} /><span>{s}</span></label>
          ))}
          {err && <Notice tone="error">{err}</Notice>}
          <div className="flex gap-3"><button className="btn-ghost flex-1" onClick={() => setI(i - 1)}>Back</button><button className="btn-primary flex-1" disabled={!all || busy} onClick={finish}>{busy ? <Spinner /> : "I understand"}</button></div>
          <p className="text-xs text-cream-200/60">We store this confirmation with the time, so you always have a record of what you agreed to.</p>
        </div>
      )}
    </AuthShell>
  )
}
