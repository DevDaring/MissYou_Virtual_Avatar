import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CallerPicker from '../components/CallerPicker'
import { AIBadge, Empty, Notice, PageHeader, Spinner } from '../components/ui'
import { get } from '../lib/api'
import { callErrorText, startCall } from '../lib/calls'
import type { Person } from '../lib/types'
import { useAuth } from '../store/auth'

const STEP_LABEL: Record<string, string> = { upload: 'Add memories', faces: 'Choose their face', anchors: 'Pick best photos', voice: 'Their voice', persona: 'How they talked', scene: 'Choose a place', done: 'Ready' }

export default function Home() {
  const user = useAuth((s) => s.user)
  const nav = useNavigate()
  const people = useQuery({ queryKey: ['people'], queryFn: () => get<{ people: Person[] }>('/api/people') })
  const home = useQuery({ queryKey: ['home'], queryFn: () => get<{ reminders: { person_id: string; message: string }[]; unread_letters: number; minutes_today: number }>('/api/home') })
  const [calling, setCalling] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picking, setPicking] = useState<Person | null>(null)

  async function call(p: Person, callerId: string | null = null) {
    if (callerId === null && (p.persona?.callers?.length ?? 0) > 0 && picking?.id !== p.id) { setPicking(p); return }
    setCalling(p.id); setErr(null)
    try { const c = await startCall(p.id, callerId ? { caller_id: callerId } : {}); nav(`/call/${c.id}`) } catch (e) { setErr(callErrorText(e)); setPicking(null) } finally { setCalling(null) }
  }

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div>
      <PageHeader title={`${greet}${user?.display_name ? `, ${user.display_name}` : ''}`} subtitle="Whenever you're ready. There's no rush." action={<Link to="/people/new" className="btn-primary">+ Someone you miss</Link>} />
      <div className="mb-5 space-y-3">
        {home.data?.reminders.map((r) => <Notice key={r.person_id}><span className="mr-2">🪔</span>{r.message} <Link className="ml-1 font-bold underline" to={`/people/${r.person_id}`}>Open</Link></Notice>)}
        {!!home.data?.unread_letters && <Notice tone="warn">✉️ {home.data.unread_letters} letter{home.data.unread_letters > 1 ? 's have' : ' has'} been answered. <Link className="font-bold underline" to="/letters">Listen</Link></Notice>}
        {err && <Notice tone="error">{err}</Notice>}
      </div>
      {people.isLoading ? <div className="flex justify-center py-16 text-ember-300"><Spinner size={30} /></div> : !people.data?.people.length ? (
        <Empty title="Who do you miss?" icon="♡">
          Add photos or a video of them, and optionally some old voice notes. We'll help you find their face and voice, and you'll confirm every step.
          <div className="mt-5"><Link className="btn-primary" to="/people/new">Begin</Link></div>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {people.data.people.map((p) => {
            const ready = p.status === 'ready' || p.setup_step === 'done'
            return (
              <article key={p.id} className="card group relative overflow-hidden p-0">
                <Link to={ready ? `/people/${p.id}` : `/people/${p.id}/setup`} className="block">
                  <div className="relative aspect-[4/3] bg-gradient-to-br from-night-700 to-night-800">
                    {p.cover_url ? <img src={p.cover_url} alt={`${p.called_name || p.name} (AI recreation)`} className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center text-5xl text-ember-400/60" aria-hidden="true">♡</div>}
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-night-900 to-transparent" />
                    <AIBadge className="absolute left-3 top-3" />
                    {p.shared && <span className="absolute right-3 top-3 rounded-full bg-night-900/70 px-2.5 py-0.5 text-xs font-bold">Shared with you</span>}
                  </div>
                </Link>
                <div className="p-5 pt-3">
                  <h2 className="text-2xl">{p.called_name || p.name || 'Unnamed'}</h2>
                  <p className="text-sm text-cream-200/70">{[p.name !== p.called_name ? p.name : '', p.relationship].filter(Boolean).join(' · ') || ' '}</p>
                  <div className="mt-4 flex gap-2">
                    {p.status === 'refused' ? <span className="text-sm text-cream-200/70">This profile can't be used.</span>
                      : p.status === 'archived' ? <Link to={`/people/${p.id}`} className="btn-ghost flex-1">Archived</Link>
                      : ready ? (<>
                        <button className="btn-primary flex-1" onClick={() => call(p)} disabled={calling === p.id}>{calling === p.id ? <Spinner /> : <>📞 Call {p.called_name || p.name}</>}</button>
                        <Link to={`/people/${p.id}`} className="btn-ghost px-4" aria-label="Open details">•••</Link>
                      </>) : <Link to={`/people/${p.id}/setup`} className="btn-ghost flex-1">Continue: {STEP_LABEL[p.setup_step] || 'setup'}</Link>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {picking && <CallerPicker person={picking} open={!!picking} busy={calling === picking.id} onClose={() => setPicking(null)}
        onPick={(id) => void call(picking, id)} onPersonChange={() => void people.refetch()} />}
      {!!home.data && <p className="mt-8 text-center text-sm text-cream-200/60">Today: {home.data.minutes_today} min of calls · Remember to be gentle with yourself.</p>}
    </div>
  )
}
