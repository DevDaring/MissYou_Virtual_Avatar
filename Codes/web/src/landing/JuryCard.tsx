import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const JURY_USER = 'TestUser'
const JURY_PASS = 'TestUser11'

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function CopyField({ label, value, onCopied }: { label: string; value: string; onCopied: (msg: string) => void }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onClick = async () => {
    const ok = await copyText(value)
    setState(ok ? 'copied' : 'failed')
    onCopied(ok ? `${label} copied to clipboard` : `Could not copy. ${label} is ${value}`)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-night-950/55 py-1.5 pl-4 pr-1.5 ring-1 ring-white/10">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-cream-200/60">{label}</div>
        <div className="truncate font-mono text-[15px] font-semibold text-cream-50" translate="no">
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ember-300 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-300"
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        {state === 'copied' ? (
          <>
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M4 10.5l3.5 3.5L16 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Copied</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <rect x="7" y="7" width="9" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M13 4.5V4a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 4v8a1.5 1.5 0 0 0 1.5 1.5H6" fill="none" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            <span>{state === 'failed' ? 'Retry' : 'Copy'}</span>
          </>
        )}
      </button>
    </div>
  )
}

export function JuryCard({ className = '' }: { className?: string }) {
  const [announce, setAnnounce] = useState('')
  return (
    <section
      id="jury"
      aria-labelledby="jury-title"
      className={`relative overflow-hidden rounded-[28px] bg-night-800/75 p-5 ring-1 ring-ember-300/25 backdrop-blur-md sm:p-6 ${className}`}
      style={{ boxShadow: '0 30px 80px -40px rgba(240,146,95,0.55), inset 0 1px 0 rgba(255,255,255,0.06)' }}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(247,176,124,0.22), transparent)' }}
        aria-hidden="true"
      />
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ember-400/15 text-ember-300 ring-1 ring-ember-300/30" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]">
                <circle cx="8.5" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12.5 12H21M18 12v3M21 12v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <h2 id="jury-title" className="font-serif text-xl font-medium text-cream-50">
              Jury &amp; admin access
            </h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-cream-200/75">
            The same login opens the admin panel. A demo loved one (&ldquo;Ma&rdquo;) is pre-created so you can start a call immediately.
          </p>
        </div>
        <CopyField label="Username" value={JURY_USER} onCopied={setAnnounce} />
        <CopyField label="Password" value={JURY_PASS} onCopied={setAnnounce} />
        <Link to="/login?jury=1" className="btn-primary w-full whitespace-nowrap px-6 lg:w-auto">
          Sign in as jury
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
            <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </section>
  )
}

export default JuryCard
