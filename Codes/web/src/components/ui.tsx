import { useEffect, type ReactNode } from 'react'
import { create } from 'zustand'
import type { SupportResources } from '../lib/types'

export function AIBadge({ label = 'AI recreation', className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`ai-badge ${className}`} title="Everything you see and hear from them here is AI-generated">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="currentColor" /></svg>
      {label}
    </span>
  )
}

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" role="status" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" fill="none" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1.5 flex justify-between text-sm text-cream-200/80"><span>{label}</span><span>{Math.round(value)}%</span></div>}
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-ember-500 to-rose-400 transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl">{title}</h2>
          <button className="-m-2 rounded-full p-3 text-cream-200/70 hover:bg-white/10" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl leading-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-cream-200/75">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Empty({ title, children, icon = '✦' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="card flex flex-col items-center py-10 text-center">
      <div className="mb-3 text-3xl text-ember-400" aria-hidden="true">{icon}</div>
      <h3 className="text-xl">{title}</h3>
      {children && <div className="mt-2 max-w-md text-cream-200/75">{children}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const cls = { info: 'bg-dusk-500/15 ring-dusk-400/30 text-dusk-300', warn: 'bg-ember-500/10 ring-ember-400/30 text-ember-300', error: 'bg-red-500/10 ring-red-400/30 text-red-200', ok: 'bg-emerald-500/10 ring-emerald-400/30 text-emerald-200' }[tone]
  return <div className={`rounded-2xl px-4 py-3 text-sm ring-1 ${cls}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

interface ToastState { msg: string | null; tone: 'ok' | 'error'; show: (m: string, tone?: 'ok' | 'error') => void }
export const useToast = create<ToastState>((set) => ({
  msg: null, tone: 'ok',
  show: (msg, tone = 'ok') => { set({ msg, tone }); window.setTimeout(() => set({ msg: null }), 3800) },
}))
export function Toaster() {
  const { msg, tone } = useToast()
  if (!msg) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 sm:bottom-8" aria-live="polite">
      <div className={`rounded-full px-5 py-3 text-sm font-semibold shadow-xl ring-1 ${tone === 'ok' ? 'bg-night-700 text-cream-50 ring-white/15' : 'bg-red-900/90 text-red-50 ring-red-400/40'}`}>{msg}</div>
    </div>
  )
}

export function SupportList({ res }: { res: SupportResources | null | undefined }) {
  if (!res) return null
  return (
    <div className="space-y-3">
      <p className="text-cream-100/85">{res.intro}</p>
      {res.lines.map((l) => (
        <div key={l.name} className="rounded-2xl bg-night-950/50 p-4 ring-1 ring-white/10">
          <div className="font-semibold text-cream-50">{l.name}</div>
          <div className="text-sm text-cream-200/70">{l.hours}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {l.phone && <a className="btn-primary min-h-[44px] px-4 text-sm" href={`tel:${l.phone.replace(/[^+\d]/g, '')}`}>Call {l.phone}</a>}
            {l.alt && <a className="btn-ghost min-h-[44px] px-4 text-sm" href={`tel:${l.alt.replace(/[^+\d]/g, '')}`}>{l.alt}</a>}
            {l.url && <a className="btn-ghost min-h-[44px] px-4 text-sm" href={l.url} target="_blank" rel="noreferrer">Website</a>}
          </div>
        </div>
      ))}
      {res.emergency && <p className="text-sm text-cream-200/80">In immediate danger? Call <a className="font-bold text-ember-300 underline" href={`tel:${res.emergency.phone}`}>{res.emergency.phone}</a>.</p>}
    </div>
  )
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ring-1 transition ${active ? 'bg-ember-500/20 text-ember-300 ring-ember-400/60' : 'bg-white/5 text-cream-100 ring-white/15 hover:bg-white/10'}`}>
      {children}
    </button>
  )
}
