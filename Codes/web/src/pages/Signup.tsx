import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { Notice, Spinner } from '../components/ui'
import { errorText, post } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../store/auth'

export default function Signup() {
  const nav = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const [f, setF] = useState({ display_name: '', email: '', username: '', password: '', dob: '', language: 'en', accept_terms: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const r = await post<{ user: User }>('/api/auth/signup', { ...f, username: f.username || undefined, password: f.password || undefined })
      setUser(r.user); nav('/onboarding', { replace: true })
    } catch (e2) {
      const t = errorText(e2)
      if (t === 'under_18') setBlocked(true); else setErr(t)
    } finally { setBusy(false) }
  }

  if (blocked) return (
    <AuthShell title="We're sorry">
      <div className="card space-y-3"><p>Miss You is only for adults aged 18 and over, so we can't create an account for you.</p><p className="text-cream-200/80">If you're missing someone and it feels heavy, please talk to a grown-up you trust, or call <a className="font-bold text-ember-300" href="tel:14416">Tele-MANAS 14416</a> — it's free and kind.</p><Link to="/" className="btn-ghost w-full">Back</Link></div>
    </AuthShell>
  )

  return (
    <AuthShell title="Begin gently" subtitle="A few details, then we'll explain everything before you upload anything.">
      {err && <div className="mb-4"><Notice tone="error">{err}</Notice></div>}
      <form className="card space-y-4" onSubmit={submit}>
        <div><label className="label" htmlFor="dn">Your name</label><input id="dn" className="input" value={f.display_name} onChange={set('display_name')} required autoComplete="name" /></div>
        <div><label className="label" htmlFor="em">Email</label><input id="em" className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="un">Username (optional)</label><input id="un" className="input" value={f.username} onChange={set('username')} autoComplete="username" /></div>
          <div><label className="label" htmlFor="pw">Password (optional)</label><input id="pw" className="input" type="password" minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" placeholder="or sign in by email code" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="dob">Date of birth</label><input id="dob" className="input" type="date" value={f.dob} onChange={set('dob')} required /></div>
          <div><label className="label" htmlFor="lg">Language</label><select id="lg" className="input" value={f.language} onChange={set('language')}><option value="en">English</option><option value="bn">বাংলা</option><option value="hi">हिन्दी</option></select></div>
        </div>
        <label className="flex items-start gap-3 text-sm text-cream-100/90"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={f.accept_terms} onChange={set('accept_terms')} required /> <span>I'm 18 or older and I accept the <Link className="text-ember-300 underline" to="/terms">Terms of Use</Link> and <Link className="text-ember-300 underline" to="/privacy">Privacy Policy</Link> (drafts pending legal review).</span></label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Create my account'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-cream-200/75">Already have an account? <Link className="font-semibold text-ember-300" to="/login">Sign in</Link> · Jury? <Link className="font-semibold text-ember-300" to="/login?jury=1">Use the demo login</Link></p>
    </AuthShell>
  )
}
