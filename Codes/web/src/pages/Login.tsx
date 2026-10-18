import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { Notice, Spinner } from '../components/ui'
import { errorText, post } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../store/auth'

const JURY = { login: 'TestUser', password: 'TestUser11' }

export default function Login() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { user, setUser } = useAuth()
  const jury = params.get('jury') === '1'
  const [mode, setMode] = useState<'password' | 'otp'>('password')
  const [login, setLogin] = useState(jury ? JURY.login : '')
  const [password, setPassword] = useState(jury ? JURY.password : '')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [otpSent, setOtpSent] = useState<string | null>(null)
  const [needsProfile, setNeedsProfile] = useState(false)
  const [dob, setDob] = useState('')
  const [name, setName] = useState('')
  const [totp, setTotp] = useState('')
  const [showTotp, setShowTotp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const next = params.get('next') || '/home'

  useEffect(() => { if (user) nav(next, { replace: true }) }, [user, nav, next])

  const done = (u: User) => { setUser(u); nav(u.onboarded ? next : '/onboarding', { replace: true }) }

  async function submitPassword(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try { done((await post<{ user: User }>('/api/auth/login', { login, password, totp: totp || undefined })).user) } catch (e2) { setErr(errorText(e2)) } finally { setBusy(false) }
  }
  async function requestOtp(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const r = await post<{ sent: boolean; dev_code?: string }>('/api/auth/otp/request', { email })
      setOtpSent(r.sent ? 'We emailed you a 6-digit code.' : r.dev_code ? `Email isn't configured on this server yet — for testing, your code is ${r.dev_code}.` : 'Code created.')
    } catch (e2) { setErr(errorText(e2)) } finally { setBusy(false) }
  }
  async function verifyOtp(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const r = await post<{ user?: User; needs_profile?: boolean }>('/api/auth/otp/verify', { email, code, dob: dob || undefined, display_name: name || undefined })
      if (r.needs_profile) { setNeedsProfile(true); await post('/api/auth/otp/request', { email }).then((x) => { const d = (x as { dev_code?: string }).dev_code; setCode(''); setOtpSent(d ? `One more step. New test code: ${d}` : 'One more step — we sent a fresh code.') }) }
      else if (r.user) done(r.user)
    } catch (e2) { setErr(errorText(e2) === 'under_18' ? 'Miss You is only for adults (18+).' : errorText(e2)) } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Take your time. There's no rush here.">
      <div className="card mb-5 border border-ember-400/30 bg-gradient-to-br from-ember-500/10 to-rose-400/5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-ember-300">Jury &amp; admin access</div>
            <div className="mt-1 font-mono text-sm text-cream-50">User: <b>TestUser</b> · Password: <b>TestUser11</b></div>
          </div>
          <button type="button" className="btn-ghost min-h-[44px] shrink-0 px-4 text-sm" onClick={() => { setMode('password'); setLogin(JURY.login); setPassword(JURY.password) }}>Fill in</button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-full bg-white/5 p-1" role="tablist">
        {(['password', 'otp'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`min-h-[44px] rounded-full text-sm font-semibold ${mode === m ? 'bg-night-700 text-cream-50' : 'text-cream-200/70'}`} onClick={() => { setMode(m); setErr(null) }}>
            {m === 'password' ? 'Username & password' : 'Email code'}
          </button>
        ))}
      </div>
      {err && <div className="mb-4"><Notice tone="error">{err}</Notice></div>}
      {mode === 'password' ? (
        <form className="card space-y-4" onSubmit={submitPassword}>
          <div><label className="label" htmlFor="login">Username or email</label><input id="login" className="input" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required /></div>
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {showTotp ? <div><label className="label" htmlFor="totp">Authenticator code</label><input id="totp" className="input tracking-[0.4em]" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} /></div>
            : <button type="button" className="text-sm text-cream-200/60 underline-offset-4 hover:underline" onClick={() => setShowTotp(true)}>Admin with two-factor? Add your code</button>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
        </form>
      ) : (
        <form className="card space-y-4" onSubmit={otpSent ? verifyOtp : requestOtp}>
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!otpSent} /></div>
          {otpSent && <Notice>{otpSent}</Notice>}
          {otpSent && <div><label className="label" htmlFor="code">6-digit code</label><input id="code" className="input tracking-[0.5em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></div>}
          {needsProfile && (<>
            <div><label className="label" htmlFor="nm">Your name</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="label" htmlFor="dob">Date of birth (you must be 18+)</label><input id="dob" className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required /></div>
          </>)}
          <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : otpSent ? 'Continue' : 'Send me a code'}</button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-cream-200/75">New here? <Link className="font-semibold text-ember-300 underline-offset-4 hover:underline" to="/signup">Create an account</Link></p>
    </AuthShell>
  )
}
