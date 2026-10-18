import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, errorText, get, post } from '../lib/api'
import type { CallInfo } from '../lib/types'
import { AIBadge, Modal, Notice, PageHeader, Spinner, useToast } from '../components/ui'

interface Turn { id: string; role: string; text: string | null; audio_url: string | null; created_at: string }
interface CallResp { call: CallInfo & { scene_id?: string | null }; turns: Turn[] }

const KIND_LABEL: Record<string, string> = { call: 'Call', interview: 'Memory interview', closure: 'Closure session', last_call: 'Last call' }

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtDuration(s: number | null | undefined): string {
  const total = Math.max(0, Math.round(s || 0))
  if (total < 60) return `${total} sec`
  const m = Math.floor(total / 60)
  const r = total % 60
  return r ? `${m} min ${r} sec` : `${m} min`
}

export default function CallDetail() {
  const { callId = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState(false)

  const q = useQuery({ queryKey: ['call', callId], queryFn: () => get<CallResp>(`/api/calls/${callId}`), enabled: !!callId })

  const save = useMutation({
    mutationFn: (turn: Turn) => post<{ id: string }>('/api/memories', { person_id: q.data?.call.person_id, call_id: callId, turn_id: turn.id }),
    onSuccess: (_r, turn) => {
      setSaved((s) => ({ ...s, [turn.id]: true }))
      toast('Saved to your memory box.')
      void qc.invalidateQueries({ queryKey: ['memories'] })
    },
    onError: (e) => toast(errorText(e), 'error'),
  })

  const remove = useMutation({
    mutationFn: () => del(`/api/calls/${callId}`),
    onSuccess: () => {
      toast('That call has been deleted.')
      void qc.invalidateQueries({ queryKey: ['calls'] })
      nav('/history', { replace: true })
    },
    onError: (e) => toast(errorText(e), 'error'),
  })

  if (q.isLoading) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={28} /></div>
  if (q.isError || !q.data) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{q.error ? errorText(q.error) : 'We could not find this call.'}</Notice>
        <Link to="/history" className="btn-ghost">Back to past calls</Link>
      </div>
    )
  }

  const { call, turns } = q.data
  const name = call.person?.called_name || call.person?.name || 'them'
  const still = call.scene?.still_url
  const hasWords = turns.some((t) => t.text)
  const assistantAudio = turns.filter((t) => t.role === 'assistant' && t.audio_url)

  return (
    <div className="pb-6">
      <Link to="/history" className="mb-3 inline-flex min-h-[48px] items-center gap-1 text-sm font-semibold text-cream-200/75 hover:text-cream-50">
        <span aria-hidden="true">←</span> Past calls
      </Link>
      <PageHeader
        title={`With ${name}`}
        subtitle={<>{call.scene?.location_label || KIND_LABEL[call.kind] || 'Call'} · {fmtDate(call.started_at)} · {fmtDuration(call.duration_s)}</>}
      />

      <div className="card mb-5 overflow-hidden p-0">
        <div className="relative aspect-[16/9] w-full bg-gradient-to-br from-dusk-500/40 via-night-700 to-ember-500/30">
          {still && <img src={still} alt={`AI-made scene of ${name} at ${call.scene?.location_label || 'a familiar place'}`} className="h-full w-full object-cover" />}
          <AIBadge className="absolute left-3 top-3" />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 p-4 text-sm text-cream-200/75">
          <span>{KIND_LABEL[call.kind] || call.kind}</span>
          {call.credits_charged > 0 && <span>{call.credits_charged} credits</span>}
          <span>{call.store_transcript ? 'Words saved' : 'Words not saved'}</span>
        </div>
      </div>

      <section aria-labelledby="words" className="mb-6">
        <h2 id="words" className="mb-3 text-2xl">What was said</h2>
        {!hasWords ? (
          <div className="card space-y-3">
            <p className="text-cream-100/85">
              The words from this call weren't kept{call.store_transcript ? '' : ', as you chose'}. That's alright — what you felt is still yours.
            </p>
            <p className="text-sm text-cream-200/70">You can choose to keep words from future calls in <Link className="font-semibold text-ember-300 underline" to="/settings">Settings</Link>.</p>
            {assistantAudio.length > 0 && (
              <div className="space-y-3 pt-2">
                <p className="text-sm text-cream-200/80">Their voice clips from this call:</p>
                {assistantAudio.map((t, i) => (
                  <div key={t.id} className="flex flex-col gap-2 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
                    <div className="flex items-center justify-between gap-2"><span className="text-sm text-cream-200/75">Clip {i + 1}</span><AIBadge label="AI voice" /></div>
                    <audio controls preload="none" src={t.audio_url ?? undefined} className="w-full" aria-label={`AI voice clip ${i + 1}`} />
                    <SaveBtn saved={!!saved[t.id]} pending={save.isPending && save.variables?.id === t.id} onClick={() => save.mutate(t)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ol className="space-y-3">
            {turns.filter((t) => t.text || t.audio_url).map((t) => {
              const mine = t.role === 'user'
              return (
                <li key={t.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] rounded-3xl px-4 py-3 ring-1 ${mine ? 'rounded-br-lg bg-ember-500/15 ring-ember-400/25' : 'rounded-bl-lg bg-night-800/80 ring-white/10'}`}>
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cream-200/70">
                      {mine ? 'You' : <>{name} <AIBadge label="AI" /></>}
                    </div>
                    {t.text ? <p className="whitespace-pre-wrap text-cream-50">{t.text}</p> : <p className="text-sm italic text-cream-200/60">(words not kept)</p>}
                    {!mine && t.audio_url && <audio controls preload="none" src={t.audio_url} className="mt-2 w-full min-w-[220px]" aria-label={`Play ${name}'s AI voice for this line`} />}
                    {!mine && (
                      <div className="mt-2">
                        <SaveBtn saved={!!saved[t.id]} pending={save.isPending && save.variables?.id === t.id} onClick={() => save.mutate(t)} />
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {call.reflection && (
        <section aria-labelledby="reflection" className="card mb-6">
          <h2 id="reflection" className="mb-2 text-xl">Your reflection</h2>
          <p className="whitespace-pre-wrap text-cream-100/90">{call.reflection}</p>
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to={`/people/${call.person_id}`} className="btn-ghost">Back to {name}</Link>
        <button className="btn-ghost text-red-200" onClick={() => setConfirm(true)}>Delete this call</button>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete this call?">
        <p className="text-cream-100/85">This removes the call, its words and voice clips. It can't be undone.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setConfirm(false)}>Keep it</button>
          <button className="btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending && <Spinner size={18} />} Delete call
          </button>
        </div>
      </Modal>
    </div>
  )
}

function SaveBtn({ saved, pending, onClick }: { saved: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={saved || pending} onClick={onClick}
      className="inline-flex min-h-[48px] items-center gap-2 rounded-full px-3 text-sm font-semibold text-ember-300 ring-1 ring-ember-400/30 hover:bg-ember-500/10 disabled:opacity-70">
      {pending ? <Spinner size={16} /> : <span aria-hidden="true">{saved ? '✓' : '♡'}</span>}
      {saved ? 'In your memory box' : 'Save to memory box'}
    </button>
  )
}
