import type { CSSProperties, ReactNode } from 'react'

/**
 * Translucent "memory" polaroids drifting at different depths.
 * Abstract illustrations only, never real faces. Decorative.
 */

function SunsetRiver() {
  return (
    <svg viewBox="0 0 100 90" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="mc-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3068" />
          <stop offset="0.55" stopColor="#f19bb0" />
          <stop offset="0.75" stopColor="#f7b07c" />
        </linearGradient>
      </defs>
      <rect width="100" height="90" fill="url(#mc-a)" />
      <circle cx="58" cy="56" r="12" fill="#fbd0a6" opacity="0.9" />
      <rect y="60" width="100" height="30" fill="#2a2250" />
      <path d="M40 66 h36 M46 72 h24 M52 78 h12" stroke="#fbd0a6" strokeWidth="1.6" opacity="0.6" />
    </svg>
  )
}

function TeaWindow() {
  return (
    <svg viewBox="0 0 100 90" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="90" fill="#2a2250" />
      <rect x="14" y="10" width="72" height="46" rx="3" fill="#8f7ad6" opacity="0.55" />
      <path d="M50 10 v46 M14 33 h72" stroke="#2a2250" strokeWidth="2.5" />
      <circle cx="70" cy="22" r="5" fill="#fff3e0" opacity="0.85" />
      <rect x="0" y="62" width="100" height="28" fill="#1e1838" />
      <path d="M36 62 h22 v10 a11 11 0 0 1 -22 0z" fill="#f7b07c" />
      <path d="M58 65 a5 5 0 0 1 0 9" stroke="#f7b07c" strokeWidth="2.2" fill="none" />
      <path d="M42 56 q-3 -5 0 -9 M50 55 q-3 -5 0 -9" stroke="#fbefe0" strokeWidth="1.4" fill="none" opacity="0.6" />
    </svg>
  )
}

function Marigolds() {
  const dots: [number, number, number, string][] = [
    [26, 30, 11, '#f0925f'],
    [56, 22, 9, '#f7b07c'],
    [74, 46, 12, '#e0794f'],
    [38, 58, 10, '#f7b07c'],
    [64, 72, 8, '#f19bb0'],
    [16, 74, 7, '#f0925f'],
  ]
  return (
    <svg viewBox="0 0 100 90" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="90" fill="#1e1838" />
      {dots.map(([x, y, r, c]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r} fill={c} opacity="0.9" />
          <circle cx={x} cy={y} r={r * 0.55} fill="#fbd0a6" opacity="0.55" />
        </g>
      ))}
    </svg>
  )
}

function GardenSwing() {
  return (
    <svg viewBox="0 0 100 90" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="mc-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b3a2ee" />
          <stop offset="1" stopColor="#fbd0a6" />
        </linearGradient>
      </defs>
      <rect width="100" height="90" fill="url(#mc-g)" opacity="0.8" />
      <path d="M0 68 C30 58 70 62 100 54 V90 H0Z" fill="#3a3068" />
      <path d="M58 0 C56 30 60 50 64 66" stroke="#2a2250" strokeWidth="4" fill="none" />
      <path d="M30 18 C50 6 80 8 96 20 C80 26 50 28 30 18Z" fill="#3a3068" opacity="0.85" />
      <path d="M40 22 v30 M52 24 v28" stroke="#2a2250" strokeWidth="1.2" />
      <rect x="37" y="52" width="18" height="3" rx="1.5" fill="#2a2250" />
    </svg>
  )
}

type CardSpec = {
  scene: ReactNode
  caption: string
  className: string
  style: CSSProperties
}

const CARDS: CardSpec[] = [
  {
    scene: <SunsetRiver />,
    caption: 'Puri, 2009',
    className: 'left-[3%] top-[118px] w-[78px] sm:left-[6%] sm:top-[130px] sm:w-[104px] md:hidden xl:block xl:left-[1.2%] xl:top-[15%] xl:w-[118px]',
    style: { '--rot': '-9deg', '--dur': '13s', '--delay': '-2s', opacity: 0.5 } as CSSProperties,
  },
  {
    scene: <TeaWindow />,
    caption: 'Sunday tea',
    className: 'right-[3%] top-[196px] w-[74px] sm:right-[6%] sm:top-[210px] sm:w-[100px] md:right-[3%] md:top-[120px] lg:right-[2.5%] lg:top-[13%] lg:w-[124px]',
    style: { '--rot': '7deg', '--dur': '15s', '--delay': '-6s', opacity: 0.45 } as CSSProperties,
  },
  {
    scene: <Marigolds />,
    caption: 'Pujo',
    className: 'hidden lg:block lg:left-[47%] lg:top-[12%] lg:w-[92px]',
    style: { '--rot': '-4deg', '--dur': '17s', '--delay': '-9s', opacity: 0.32 } as CSSProperties,
  },
  {
    scene: <GardenSwing />,
    caption: "Ma's garden",
    className: 'hidden md:block md:right-[8%] md:top-[60%] md:w-[110px] lg:right-[3%] lg:top-[56%] lg:w-[118px]',
    style: { '--rot': '-6deg', '--dur': '14s', '--delay': '-4s', opacity: 0.4 } as CSSProperties,
  },
]

export function MemoryCards() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {CARDS.map((c) => (
        <figure key={c.caption} className={`memory-card absolute ${c.className}`} style={c.style}>
          <div className="rounded-[10px] bg-cream-50/[0.13] p-[6%] pb-[4%] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/15 backdrop-blur-[2px]">
            <div className="aspect-[10/9] overflow-hidden rounded-[6px]">{c.scene}</div>
            <figcaption className="mt-[6%] truncate text-center font-serif text-[10px] italic text-cream-100/80 sm:text-[11px]">
              {c.caption}
            </figcaption>
          </div>
        </figure>
      ))}
    </div>
  )
}

export default MemoryCards
