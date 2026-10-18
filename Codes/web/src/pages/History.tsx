import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, errorText, get } from '../lib/api'
import type { CallInfo } from '../lib/types'
import { AIBadge, Empty, Modal, Notice, PageHeader, Spinner, useToast } from '../components/ui'

const KIND_LABEL: Record<string, string> = {
  call: 'Call',
  interview: 'Memory interview',
  closure: 'Closure session',
  last_call: 'Last call',
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] || kind
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtDuration(s: number | null | undefined): string {
  const total = Math.max(0, Math.round(s || 0))
  if (total < 60) return `${total} sec`
  const m = Math.floor(total / 60)
  const r = total % 60
  return r ? `${m} min ${r} sec` : `${m} min`
}

export default function History() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [confirm, setConfirm] = useState<CallInfo | null>(null)
  const q = useQuery({ queryKey: ['calls'], queryFn: () => get<{ calls: CallInfo[] }>('/api/calls') })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/calls/${id}`),
    onSuccess: () => {
      setConfirm(null)
      toast('That call has been deleted.')
      void qc.invalidateQueries({ queryKey: ['calls'] })
    },
    onError: (e) => toast(errorText(e), 'error'),
  })

  const calls = q.data?.calls ?? []

  return (
    <div>
      <PageHeader title="Past calls" subtitle={<span className="inline-flex flex-wrap items-center gap-2">Every call here was with an AI recreation. <AIBadge /></span>} />

      {q.isLoading && <div className="flex justify-center py-12 text-ember-300"><Spinner size={28} /></div>}
      {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}

      {q.isSuccess && calls.length === 0 && (
        <Empty title="No calls yet" icon="☾">
          When you have a call, it will rest here so you can return to it. <Link className="font-semibold text-ember-300 underline" to="/home">Go home</Link>
        </Empty>
      )}

      <ul className="space-y-3">
        {calls.map((c) => (
          <li key={c.id} className="card flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
            <Link to={`/history/${c.id}`} className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-300 sm:gap-4">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-dusk-500/40 to-ember-500/30 ring-1 ring-white/10">
                {c.thumb ? (
                  <img src={c.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl text-cream-50/70" aria-hidden="true">✦</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-serif text-lg text-cream-50">{c.person?.called_name || c.person?.name || 'Someone you miss'}</span>
                  {c.kind !== 'call' && <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-cream-200/80 ring-1 ring-white/10">{kindLabel(c.kind)}</span>}
                </div>
                <div className="truncate text-sm text-cream-200/75">{c.place || kindLabel(c.kind)}</div>
                <div className="text-xs text-cream-200/60">{fmtDate(c.started_at)} · {fmtDuration(c.duration_s)}</div>
              </div>
            </Link>
            <button
              type="button"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-cream-200/60 hover:bg-white/10 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-300"
              aria-label={`Delete call with ${c.person?.name || 'them'} on ${fmtDate(c.started_at)}`}
              onClick={() => setConfirm(c)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></svg>
            </button>
          </li>
        ))}
      </ul>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete this call?">
        <p className="text-cream-100/85">
          This removes the call, any saved words and the voice clips from it. It can't be undone.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setConfirm(null)}>Keep it</button>
          <button className="btn-danger" disabled={remove.isPending} onClick={() => confirm && remove.mutate(confirm.id)}>
            {remove.isPending ? <Spinner size={18} /> : null} Delete call
          </button>
        </div>
      </Modal>
    </div>
  )
}
