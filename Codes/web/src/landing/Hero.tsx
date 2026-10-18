import { useRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { HeartfieldCanvas } from './HeartfieldCanvas'
import { HorizonSilhouette } from './HorizonSilhouette'
import { MemoryCards } from './MemoryCards'
import { JuryCard } from './JuryCard'

const rise = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

export function Hero() {
  const anchorRef = useRef<HTMLDivElement>(null)

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* sky, aurora, stars + fireflies, polaroids, horizon */}
      <div className="landing-sky absolute inset-0 -z-10" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="aurora aurora-c" />
      </div>
      <HeartfieldCanvas anchorRef={anchorRef} className="pointer-events-none absolute inset-0 -z-10" />
      <MemoryCards />
      <HorizonSilhouette className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[150px] w-full sm:h-[190px] lg:aspect-[1440/260] lg:h-auto lg:max-h-[300px]" />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-16 bg-gradient-to-b from-transparent to-night-900"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-[150px] pt-[84px] sm:px-6 sm:pb-[200px] lg:pb-[170px] lg:pt-[96px]">
        <div className="grid items-center gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
          <div className="flex justify-center lg:order-2">
            {/* The heart forms here on the canvas; this box only reserves space. */}
            <div
              ref={anchorRef}
              className="h-[184px] w-[184px] sm:h-[240px] sm:w-[240px] lg:h-[340px] lg:w-[340px]"
              aria-hidden="true"
            />
          </div>

          <div className="text-center lg:order-1 lg:text-left">
            <p className="hero-rise" style={rise(200)}>
              <span className="ai-badge">
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                  <path d="M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7 4.3 13.1l1.1-4.3L2 6l4.4-.3z" fill="currentColor" />
                </svg>
                AI recreation · always labelled
              </span>
            </p>
            <h1
              id="hero-title"
              className="hero-rise mx-auto mt-4 max-w-[13ch] text-balance font-serif text-[2.6rem] font-[380] leading-[1.04] tracking-[-0.02em] text-cream-50 sm:text-6xl lg:mx-0 lg:text-[4.6rem]"
              style={{ ...rise(350), fontVariationSettings: '"opsz" 72' }}
            >
              Hear them say your name{' '}
              <em className="bg-gradient-to-r from-ember-300 via-ember-400 to-rose-400 bg-clip-text font-normal italic text-transparent">
                again.
              </em>
            </h1>
            <p
              className="hero-rise mx-auto mt-5 max-w-[34rem] text-pretty text-[1.05rem] leading-relaxed text-cream-200/85 sm:text-lg lg:mx-0"
              style={rise(550)}
            >
              A short, gentle video call with an AI recreation of someone you miss, made only from your own photos,
              videos and voice notes. It is not them, and it never pretends to be. Just a quiet moment to say what
              you still want to say.
            </p>
            <div
              className="hero-rise mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-start"
              style={rise(750)}
            >
              <Link to="/signup" className="btn-primary px-8 text-[1.05rem]">
                Begin gently
              </Link>
              <Link to="/login" className="btn-ghost px-8 text-[1.05rem]">
                Sign in
              </Link>
            </div>
            <p className="hero-rise mt-5 text-sm text-cream-200/60" style={rise(900)}>
              English · <span lang="bn">বাংলা</span> · <span lang="hi">हिन्दी</span>
              <span aria-hidden="true"> · </span>
              <span className="whitespace-nowrap">18+ · private to you</span>
            </p>
          </div>
        </div>

        <div className="hero-rise mt-10 lg:mt-12" style={rise(1100)}>
          <JuryCard />
        </div>
      </div>
    </section>
  )
}

export default Hero
