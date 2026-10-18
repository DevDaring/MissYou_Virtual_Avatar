import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { Logo } from './Logo'
import { AIBadge, Toaster } from './ui'
import { t } from '../lib/i18n'

const NAV = [
  { to: '/home', key: 'home' as const, icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { to: '/history', key: 'history' as const, icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z' },
  { to: '/memories', key: 'memories' as const, icon: 'M4 8h16v12H4zM2 4h20v4H2zM10 12h4' },
  { to: '/letters', key: 'letters' as const, icon: 'M3 6h18v12H3zM3 6l9 7 9-7' },
  { to: '/settings', key: 'settings' as const, icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const lang = user?.language
  return (
    <div className="relative min-h-screen pb-24 sm:pb-10">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(143,122,214,0.18),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(240,146,95,0.10),transparent_55%)]" aria-hidden="true" />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-night-900/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Link to="/home" className="flex items-center gap-2" aria-label="Miss You home"><Logo size={30} withWordmark /></Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `rounded-full px-3.5 py-2 text-sm font-semibold ${isActive ? 'bg-white/10 text-cream-50' : 'text-cream-200/75 hover:text-cream-50'}`}>{t(lang, n.key)}</NavLink>
            ))}
            {user?.role === 'admin' && <NavLink to="/admin" className={({ isActive }) => `rounded-full px-3.5 py-2 text-sm font-semibold ${isActive ? 'bg-white/10 text-cream-50' : 'text-dusk-300 hover:text-cream-50'}`}>Admin</NavLink>}
          </nav>
          <div className="flex items-center gap-2">
            <AIBadge className="hidden md:inline-flex" />
            {user?.role === 'admin' && <Link to="/admin" className="rounded-full bg-dusk-500/20 px-3 py-1.5 text-xs font-bold text-dusk-300 ring-1 ring-dusk-400/40 sm:hidden">Admin</Link>}
            <Link to="/settings#credits" className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-ember-300 ring-1 ring-white/10" title="Credits">✦ {user?.credits ?? 0}</Link>
            <button className="hidden rounded-full px-3 py-2 text-sm text-cream-200/70 hover:text-cream-50 sm:block" onClick={async () => { await logout(); nav('/') }}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6"><Outlet /></main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold ${isActive ? 'text-ember-300' : 'text-cream-200/60'}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.icon} /></svg>
              {t(lang, n.key)}
            </NavLink>
          ))}
        </div>
      </nav>
      <Toaster />
    </div>
  )
}
