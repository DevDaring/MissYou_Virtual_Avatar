import { useId } from 'react'

/**
 * Miss You mark: two tapered crescents that form a heart but never quite
 * touch (two people reaching for each other), cradling a small diya flame,
 * the light we keep for someone we miss. Drawn on a 64x64 grid.
 */
export const LOGO_VIEWBOX = 64
export const HEART_LEFT_PATH =
  'M30.6 50.5C18.5 42.5 8.5 34.2 8.5 23.8C8.5 16.2 14.2 10.5 21.6 10.5C25.9 10.5 29.2 12.7 30.9 16.4C28.4 15.2 25.9 15.2 23.8 15.4C18.2 15.8 14.6 19.6 14.6 25C14.6 32.4 21.2 40.4 30.6 50.5Z'
export const HEART_RIGHT_PATH =
  'M33.4 50.5C45.5 42.5 55.5 34.2 55.5 23.8C55.5 16.2 49.8 10.5 42.4 10.5C38.1 10.5 34.8 12.7 33.1 16.4C35.6 15.2 38.1 15.2 40.2 15.4C45.8 15.8 49.4 19.6 49.4 25C49.4 32.4 42.8 40.4 33.4 50.5Z'
export const FLAME_PATH =
  'M33.6 20.4C32.5 24.8 36.9 27.6 36.9 32.9C36.9 36 34.7 38.2 32 38.2C29.3 38.2 27.1 36 27.1 32.9C27.1 28.6 30.6 26.6 32.3 23.8C32.8 22.8 33.3 21.7 33.6 20.4Z'
export const FLAME_CORE_PATH =
  'M32.5 28.6C32.6 31 34.5 32.4 34.5 34.8C34.5 36.3 33.4 37.3 32 37.3C30.6 37.3 29.5 36.3 29.5 34.8C29.5 32.6 31.8 31.2 32.5 28.6Z'

type LogoProps = { size?: number; withWordmark?: boolean; className?: string }

export function Logo({ size = 40, withWordmark = false, className }: LogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const g = `my-g-${uid}`
  const f = `my-f-${uid}`
  const h = `my-h-${uid}`
  const animated = size >= 32

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={withWordmark ? true : undefined}
      role={withWordmark ? undefined : 'img'}
      aria-label={withWordmark ? undefined : 'Miss You'}
      className={`shrink-0 overflow-visible ${animated ? 'my-logo-animated' : ''}`}
    >
      {animated && (
        <style>{`
          @keyframes my-logo-breathe { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
          @keyframes my-logo-flicker { 0%,100% { transform: scale(1) rotate(0deg); } 30% { transform: scale(1.03,.98) rotate(-1.5deg); } 65% { transform: scale(.98,1.04) rotate(1deg); } }
          .my-logo-animated .my-halo { transform-origin: 32px 32.5px; animation: my-logo-breathe 4.8s ease-in-out infinite; }
          .my-logo-animated .my-flame { transform-origin: 32px 38px; animation: my-logo-flicker 3.2s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .my-logo-animated .my-halo, .my-logo-animated .my-flame { animation: none; } }
        `}</style>
      )}
      <defs>
        <linearGradient id={g} x1="10" y1="12" x2="54" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fbd0a6" />
          <stop offset="0.45" stopColor="#f0925f" />
          <stop offset="1" stopColor="#f19bb0" />
        </linearGradient>
        <linearGradient id={f} x1="32" y1="20" x2="32" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0925f" />
          <stop offset="0.5" stopColor="#f7b07c" />
          <stop offset="1" stopColor="#fbd0a6" />
        </linearGradient>
        <radialGradient id={h} cx="32" cy="32.5" r="13" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7b07c" stopOpacity="0.6" />
          <stop offset="1" stopColor="#f7b07c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="my-halo" cx="32" cy="32.5" r="13" fill={`url(#${h})`} />
      <path d={HEART_LEFT_PATH} fill={`url(#${g})`} />
      <path d={HEART_RIGHT_PATH} fill={`url(#${g})`} />
      <g className="my-flame">
        <path d={FLAME_PATH} fill={`url(#${f})`} />
        <path d={FLAME_CORE_PATH} fill="#fff9f1" />
      </g>
    </svg>
  )

  if (!withWordmark) return <span className={`inline-flex ${className ?? ''}`}>{mark}</span>

  return (
    <span className={`inline-flex items-center gap-[0.35em] ${className ?? ''}`} style={{ fontSize: size * 0.62 }}>
      {mark}
      <span className="font-serif font-medium leading-none tracking-[-0.01em] text-cream-50" style={{ fontVariationSettings: '"opsz" 96' }}>
        Miss <span className="italic text-ember-300">You</span>
      </span>
    </span>
  )
}

export default Logo
