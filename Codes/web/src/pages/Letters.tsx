import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, errorText, get, post } from '../lib/api'
import type { Person, SupportResources } from '../lib/types'
import { useAuth } from '../store/auth'
import { AIBadge, Empty, Modal, Notice, PageHeader, Spinner, SupportList, useToast } from '../components/ui'

interface Letter {
  id: string; person_id: string; person_name: string | null; text: string; status: 'queued' | 'writing' | 'ready' | 'failed' | string
  reply_text: string | null; reply_audio_url: string | null; reply_video_url: string | null; read: boolean
  created_at: string; delivered_at: string | null
}
type SendResp = { letter: Letter } | { crisis: true; resources: SupportResources }

const MAX = 4000

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Waiting to be read', cls: 'bg-white/5 text-cream-200 ring-white/15' },
  writing: { label: 'A reply is being written', cls: 'bg-dusk-500/20 text-dusk-300 ring-dusk-400/40' },
  ready: { label: 'Reply arrived', cls: 'bg-ember-500/15 text-ember-300 ring-ember-400/40' },
  failed: { label: "Couldn't be answered", cls: 'bg-red-500/10 text-red-200 ring-red-400/30' },
}

export default function Letters() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const { user, refresh } = useAuth()
  const [personId, setPersonId] = useState('')
  const [text, setText] = useState('')
  const [crisis, setCrisis] = useState<SupportResources | null>(null)
  const [confirm, setConfirm] = useState<Letter | null>(null)

  const people = useQuery({ queryKey: ['people'], queryFn: () => get<{ people: Person[] }>('/api/people') })
  const pricing = useQuery({ queryKey: ['pricing'], queryFn: () => get<{ costs: Record<string, number> }>('/api/pricing/actions'), staleTime: 300_000 })
  const letters = useQuery({
    queryKey: ['letters'],
    queryFn: () => get<{ letters: Letter[] }>('/api/letters'),
    refetchInterval: (query) => (query.state.data?.letters.some((l) => l.status === 'queued' || l.status === 'writing') ? 5000 : false),
  })

  const usable = (people.data?.people ?? []).filter((p) => p.status !== 'refused' && p.status !== 'archived')
  useEffect(() => {
    if (!personId && usable.length) setPersonId(usable[0].id)
  }, [personId, usable])

  const cost = pricing.data?.costs.letter
  const balance = user?.credits ?? 0
  const short = cost !== undefined && balance < cost

  const send = useMutation({
    mutationFn: () => post<SendResp>('/api/letters', { person_id: personId, text: text.trim() }),
    onSuccess: (r) => {
      if ('crisis' in r && r.crisis) {
        setCrisis(r.resources)
        return
      }
      setText('')
      setCrisis(null)
      toast('Your letter is on its way.')
      void qc.invalidateQueries({ queryKey: ['letters'] })
      void refresh()
    },
    onError: (e) => toast(errorText(e), 'error'),
  })

  const markRead = useMutation({
    mutationFn: (id: string) => post(`/api/letters/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['letters'] }),
    onError: (e) => toast(errorText(e), 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/letters/${id}`),
    onSuccess: () => {
      setConfirm(null)
      toast('Letter deleted.')
      void qc.invalidateQueries({ queryKey: ['letters'] })
    },
    onError: (e) => toast(errorText(e), 'error'),
  })

  const list = letters.data?.letters ?? []
  const chosen = usable.find((p) => p.id === personId)
  const canSend = !!personId && text.trim().length >= 3 && !send.isPending && !short

  return (
    <div className="pb-6">
      <PageHeader title="Letters" subtitle="Write to them whenever you like. A gentle reply, in their recreated voice, will arrive in a little while." />

      {crisis && (
        <section className="card mb-6 space-y-4 ring-ember-400/30" aria-labelledby="crisis-title">
          <h2 id="crisis-title" className="text-xl">We've paused this letter</h2>
          <p className="text-cream-100/85">
            What you wrote sounds really heavy, and you matter. Your letter hasn't been sent. Please consider talking to someone right now — a real person who can listen.
          </p>
          <SupportList res={crisis} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn-ghost" onClick={() => setCrisis(null)}>I'm okay, go back to my letter</button>
            <Link className="btn-ghost" to="/support">More support</Link>
          </div>
        </section>
      )}

      {people.isSuccess && usable.length === 0 ? (
        <Empty title="No one to write to yet" icon="✉">
          Once you've set up someone you miss, you can write them letters here. <Link to="/people/new" className="font-semibold text-ember-300 underline">Set someone up</Link>
        </Empty>
      ) : (
        <form className="card mb-8 space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSend) send.mutate() }}>
          <div>
            <label className="label" htmlFor="letter-to">To</label>
            <select id="letter-to" className="input" value={personId} onChange={(e) => setPersonId(e.target.value)} disabled={people.isLoading}>
              {usable.map((p) => <option key={p.id} value={p.id}>{p.called_name ? `${p.called_name} (${p.name})` : p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="letter-text">Your letter</label>
            <textarea id="letter-text" className="input min-h-[180px] py-3 leading-relaxed" maxLength={MAX} value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={chosen ? `Dear ${chosen.called_name || chosen.name},` : 'Dear…'} aria-describedby="letter-help" />
            <div id="letter-help" className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-cream-200/60">
              <span>The reply is written by AI from your memories — it isn't really them.</span>
              <span>{text.length}/{MAX}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-cream-200/75">
              {cost !== undefined ? <>Sending costs <strong className="text-ember-300">{cost} credits</strong> · you have {balance}.</> : 'Checking the cost…'}
              {short && <> <Link to="/settings#credits" className="font-semibold text-ember-300 underline">Add credits</Link></>}
            </p>
            <button type="submit" className="btn-primary" disabled={!canSend}>
              {send.isPending && <Spinner size={18} />} Send letter
            </button>
          </div>
        </form>
      )}

      <section aria-labelledby="sent">
        <h2 id="sent" className="mb-3 text-2xl">Your letters</h2>
        {letters.isLoading && <div className="flex justify-center py-8 text-ember-300"><Spinner size={24} /></div>}
        {letters.isError && <Notice tone="error">{errorText(letters.error)}</Notice>}
        {letters.isSuccess && list.length === 0 && <p className="text-cream-200/70">Letters you send will appear here, with their replies.</p>}
        <ul className="space-y-4">
          {list.map((l) => {
            const st = STATUS[l.status] || { label: l.status, cls: 'bg-white/5 text-cream-200 ring-white/15' }
            const name = l.person_name || 'them'
            return (
              <li key={l.id} className={`card space-y-3 ${l.status === 'ready' && !l.read ? 'ring-ember-400/40' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-serif text-lg text-cream-50">To {name}</div>
                    <div className="text-xs text-cream-200/60">{fmtDate(l.created_at)}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${st.cls}`}>
                    {(l.status === 'queued' || l.status === 'writing') && <Spinner size={12} />}
                    {st.label}
                  </span>
                </div>
                <details className="group">
                  <summary className="min-h-[44px] cursor-pointer list-none py-2 text-sm font-semibold text-cream-200/75 hover:text-cream-50">
                    <span className="group-open:hidden">Show what you wrote</span><span className="hidden group-open:inline">Hide what you wrote</span>
                  </summary>
                  <p className="whitespace-pre-wrap rounded-2xl bg-night-950/40 p-3 text-sm text-cream-100/85">{l.text}</p>
                </details>

                {l.status === 'ready' && (
                  <div className="space-y-3 rounded-2xl bg-night-950/40 p-4 ring-1 ring-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-cream-50">Reply from {name}</span>
                      <AIBadge />
                      {!l.read && <span className="rounded-full bg-ember-500/20 px-2 py-0.5 text-xs font-bold text-ember-300">New</span>}
                    </div>
                    {l.reply_video_url ? (
                      <video controls playsInline preload="metadata" src={l.reply_video_url} className="w-full rounded-2xl bg-black"
                        aria-label={`AI-made reply from ${name}`} onPlay={() => !l.read && markRead.mutate(l.id)} />
                    ) : l.reply_audio_url ? (
                      <audio controls preload="none" src={l.reply_audio_url} className="w-full" aria-label={`AI voice reply from ${name}`}
                        onPlay={() => !l.read && markRead.mutate(l.id)} />
                    ) : null}
                    {l.reply_text && <p className="whitespace-pre-wrap font-serif leading-relaxed text-cream-100/90">{l.reply_text}</p>}
                    <p className="text-xs text-cream-200/60">Written and voiced by AI from your memories. It isn't really {name}.</p>
                  </div>
                )}
                {l.status === 'failed' && (
                  <Notice tone="warn">We're sorry — a reply couldn't be written this time. You may want to try sending it again later.</Notice>
                )}

                <div className="flex flex-wrap gap-2">
                  {l.status === 'ready' && !l.read && (
                    <button className="btn-ghost text-sm" disabled={markRead.isPending} onClick={() => markRead.mutate(l.id)}>Mark as read</button>
                  )}
                  <button className="btn-ghost text-sm text-red-200" onClick={() => setConfirm(l)} aria-label={`Delete letter to ${name}`}>Delete</button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete this letter?">
        <p className="text-cream-100/85">Your letter and its reply will be removed. This can't be undone.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setConfirm(null)}>Keep it</button>
          <button className="btn-danger" disabled={remove.isPending} onClick={() => confirm && remove.mutate(confirm.id)}>
            {remove.isPending && <Spinner size={18} />} Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}
