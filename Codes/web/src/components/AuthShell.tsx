import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'
import { AIBadge } from './ui'

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(143,122,214,0.25),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(240,146,95,0.14),transparent_60%)]" aria-hidden="true" />
      <div className="mx-auto flex max-w-md flex-col">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/" aria-label="Miss You home"><Logo size={34} withWordmark /></Link>
          <AIBadge />
        </div>
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-cream-200/75">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
