import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

const focusRing =
  'rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-300 focus-visible:ring-offset-2 focus-visible:ring-offset-night-900'

/* ------------------------------------------------------------------ header */

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
        <Link to="/" className={`inline-flex min-h-[48px] items-center ${focusRing}`} aria-label="Miss You, home">
          <Logo size={36} withWordmark />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          <a
            href="#how"
            className={`hidden min-h-[48px] items-center px-3 text-sm font-semibold text-cream-200/80 hover:text-cream-50 md:inline-flex ${focusRing}`}
          >
            How it works
          </a>
          <a
            href="#safety"
            className={`hidden min-h-[48px] items-center px-3 text-sm font-semibold text-cream-200/80 hover:text-cream-50 md:inline-flex ${focusRing}`}
          >
            Safety
          </a>
          <a
            href="#jury"
            className={`hidden min-h-[48px] items-center px-3 text-sm font-semibold text-ember-300 hover:text-ember-300/90 sm:inline-flex ${focusRing}`}
          >
            Jury access
          </a>
          <Link to="/login" className="btn-ghost min-h-[44px] px-4 text-sm sm:min-h-[48px]">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------ how it works */

function StepIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-ember-400/20 to-rose-400/10 text-ember-300 ring-1 ring-ember-300/25"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  )
}

const PLACES = ['Garden lawn', 'Balcony at sunset', 'Riverside ghat', 'Quiet living room']

const STEPS: { title: string; body: ReactNode; icon: ReactNode }[] = [
  {
    title: 'Share a few memories',
    body: 'Upload photos, short videos and voice notes from your phone. They stay private to you and are used only to make this recreation.',
    icon: (
      <>
        <rect x="3.5" y="5" width="13" height="11" rx="2" />
        <path d="M3.5 13l3.5-3.5 3 3 2-2 4.5 4.5" />
        <path d="M19.5 9v8.5a2 2 0 0 1-2 2H8" />
      </>
    ),
  },
  {
    title: 'We find their face and voice, you confirm',
    body: 'We gently pick out who is who in group photos and which voice is theirs. Nothing is used until you say yes.',
    icon: (
      <>
        <circle cx="12" cy="9" r="3.5" />
        <path d="M5.5 19c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5" />
        <path d="M3 6V4.5A1.5 1.5 0 0 1 4.5 3H6M18 3h1.5A1.5 1.5 0 0 1 21 4.5V6M21 18v1.5a1.5 1.5 0 0 1-1.5 1.5H18M6 21H4.5A1.5 1.5 0 0 1 3 19.5V18" />
      </>
    ),
  },
  {
    title: 'Choose a place',
    body: (
      <>
        Somewhere that feels like them.
        <span className="mt-3 flex flex-wrap gap-1.5">
          {PLACES.map((p) => (
            <span key={p} className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-cream-100/85 ring-1 ring-white/10">
              {p}
            </span>
          ))}
        </span>
      </>
    ),
    icon: (
      <>
        <path d="M3 18h18" />
        <path d="M6 18c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M12 3v3M4.6 6.6l2 2M19.4 6.6l-2 2" />
      </>
    ),
  },
  {
    title: 'A call that feels like their front camera',
    body: 'A short, portrait video call, as if they were holding their phone. Labelled as an AI recreation the whole time, and you can end it whenever you like.',
    icon: (
      <>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
        <path d="M12 15.6c-1.9-1.3-3-2.4-3-3.7a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.3-1.1 2.4-3 3.7z" />
        <path d="M10.5 5h3" />
      </>
    ),
  },
]

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-8 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="How it works" id="how-title" title="Four quiet steps, at your own pace." />
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card relative flex flex-col gap-4 p-6">
              <div className="flex items-center justify-between">
                <StepIcon>{s.icon}</StepIcon>
                <span className="font-serif text-3xl font-light text-cream-200/25" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-xl font-medium leading-snug text-cream-50">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              <div className="text-[0.95rem] leading-relaxed text-cream-200/75">{s.body}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ safety */

const SAFETY: { title: string; body: ReactNode; icon: ReactNode }[] = [
  {
    title: 'Always labelled AI',
    body: 'An “AI recreation” badge stays on screen for the whole call. No exceptions.',
    icon: <path d="M12 3l1.9 5 5.1.4-3.9 3.3 1.3 5.1L12 14l-4.4 2.8 1.3-5.1L5 8.4l5.1-.4z" />,
  },
  {
    title: 'Crisis support pauses the call',
    body: (
      <>
        If words of distress come up, the call pauses and offers real help. In India, call{' '}
        <a href="tel:14416" className={`font-bold text-ember-300 underline decoration-ember-300/40 underline-offset-2 ${focusRing}`}>
          Tele-MANAS 14416
        </a>{' '}
        (free, 24×7).
      </>
    ),
    icon: (
      <>
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
        <path d="M10 10.5v3M14 10.5v3" />
      </>
    ),
  },
  {
    title: '18+ only, consent required',
    body: 'You confirm you are an adult and have the right to use these memories, with family consent where it is needed.',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8.5 12.5l2.3 2.3 4.7-5" />
      </>
    ),
  },
  {
    title: 'No public sharing',
    body: 'Recreations are private to your account. No share links, no feeds, no strangers.',
    icon: (
      <>
        <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
        <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      </>
    ),
  },
  {
    title: 'Delete everything, anytime',
    body: 'One step removes every photo, video, voice note and the recreation itself.',
    icon: (
      <>
        <path d="M4.5 7h15M9.5 7V4.5h5V7" />
        <path d="M6.5 7l1 12.5h9l1-12.5" />
      </>
    ),
  },
  {
    title: 'Never claims to be alive',
    body: 'It will never say it is really them, and never suggest contact from beyond. It is a memory, gently given a voice.',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8v4.5M12 15.8v.2" />
      </>
    ),
  },
]

export function Safety() {
  return (
    <section id="safety" aria-labelledby="safety-title" className="relative scroll-mt-8 py-20 sm:py-24">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-full"
        style={{ background: 'radial-gradient(60% 50% at 50% 40%, rgba(143,122,214,0.10), transparent 70%)' }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Safety, always" id="safety-title" title="Made with care, held to firm lines." />
        <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {SAFETY.map((s) => (
            <li key={s.title} className="flex gap-4">
              <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-dusk-500/15 text-dusk-300 ring-1 ring-dusk-400/30" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {s.icon}
                </svg>
              </span>
              <div>
                <h3 className="font-sans text-base font-bold text-cream-50">{s.title}</h3>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-cream-200/75">{s.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- languages */

const LANGS = [
  { name: 'English', lang: 'en', line: 'Hear them say your name again.' },
  { name: 'বাংলা', lang: 'bn', line: 'আবার শুনুন, তাঁর কণ্ঠে আপনার নাম।' },
  { name: 'हिन्दी', lang: 'hi', line: 'फिर से सुनिए, उनकी आवाज़ में अपना नाम।' },
]

export function Languages() {
  return (
    <section aria-labelledby="lang-title" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Languages" id="lang-title" title="In the language you shared with them." />
        <ul className="mt-10 grid gap-4 sm:grid-cols-3">
          {LANGS.map((l) => (
            <li
              key={l.lang}
              lang={l.lang}
              className="rounded-3xl bg-gradient-to-br from-night-800/90 to-night-700/50 p-6 ring-1 ring-white/10"
            >
              <div className={`text-2xl font-semibold text-ember-300 ${l.lang === 'en' ? 'font-serif font-medium' : 'font-sans'}`}>{l.name}</div>
              <p className={`mt-3 text-lg leading-relaxed text-cream-100 ${l.lang === 'en' ? 'font-serif italic' : 'font-sans'}`}>
                &ldquo;{l.line}&rdquo;
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-cream-200/60">The app, the captions and the call itself can all be in English, Bengali or Hindi.</p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- closing cta */

export function ClosingCta() {
  return (
    <section aria-labelledby="ready-title" className="px-4 pb-20 pt-6 sm:px-6">
      <div className="relative isolate mx-auto max-w-3xl overflow-hidden rounded-[32px] px-6 py-12 text-center ring-1 ring-white/10 sm:px-12">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 90% at 50% 120%, rgba(240,146,95,0.35), transparent 70%), linear-gradient(180deg, #1e1838, #14102a)',
          }}
          aria-hidden="true"
        />
        <Logo size={56} className="justify-center" />
        <h2 id="ready-title" className="mt-4 text-3xl font-[380] text-cream-50 sm:text-4xl">
          Whenever you&rsquo;re ready.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-cream-200/75">
          There is no rush. Begin gently, take breaks, and come back when you want to.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/signup" className="btn-primary px-8">
            Begin gently
          </Link>
          <Link to="/login" className="btn-ghost px-8">
            Sign in
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ footer */

const FOOTER_LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/faq', label: 'FAQ' },
  { to: '/support', label: 'Support' },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-night-950/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo size={30} withWordmark />
          <p className="mt-3 max-w-sm text-sm text-cream-200/60">
            In distress? In India, call{' '}
            <a href="tel:14416" className={`font-semibold text-ember-300 ${focusRing}`}>
              Tele-MANAS 14416
            </a>
            , free and 24×7.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-1 gap-y-1">
            {FOOTER_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={`inline-flex min-h-[48px] items-center px-3 text-sm font-semibold text-cream-200/80 hover:text-cream-50 ${focusRing}`}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-6">
        <p className="text-xs text-cream-200/60">© 2026 Miss You · an AI recreation, made with care.</p>
      </div>
    </footer>
  )
}

/* ----------------------------------------------------------------- helpers */

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-ember-300/90">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-balance text-3xl font-[380] leading-tight text-cream-50 sm:text-[2.6rem]">
        {title}
      </h2>
    </div>
  )
}
