import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, errorText, get } from '../lib/api'
import { AIBadge, Empty, Modal, Notice, PageHeader, Spinner, useToast } from '../components/ui'

interface Memory { id: string; person_id: string; person_name: string; text: string; audio_url: string | null; created_at: string; call_id: string | null; video_url?: string | null; video_status?: string }

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function Memories() {
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [confirm, setConfirm] = useState<Memory | null>(null)
  const q = useQuery({ queryKey: ['memories'], queryFn: () => get<{ memories: Memory[] }>('/api/memories'),
    refetchInterval: (query) => (query.state.data?.memories.some((m) => m.video_status === 'making') ? 8000 : false) })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/memories/${id}`),
    onSuccess: () => {
      setConfirm(null)
      toast('Removed from your memory box.')
      void qc.invalidateQueries({ queryKey: ['memories'] })
    },
    onError: (e) => toast(errorText(e), 'error'),
  })

  const items = q.data?.memories ?? []

  return (
    <div>
      <PageHeader title="Memory box" subtitle={<span className="inline-flex flex-wrap items-center gap-2">Lines you chose to keep. Voices here are AI recreations. <AIBadge /></span>} />

      {q.isLoading && <div className="flex justify-center py-12 text-ember-300"><Spinner size={28} /></div>}
      {q.isError && <Notice tone="error">{errorText(q.error)}</Notice>}

      {q.isSuccess && items.length === 0 && (
        <Empty title="Your memory box is empty" icon="♡">
          After a call, open it from <Link className="font-semibold text-ember-300 underline" to="/history">Calls</Link> and tap “Save to memory box” beside a line you'd like to keep.
        </Empty>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((m) => (
          <li key={m.id} className="card flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-serif text-lg text-cream-50">{m.person_name || 'Someone you miss'}</div>
                <div className="text-xs text-cream-200/60">{fmtDate(m.created_at)}</div>
              </div>
              <AIBadge />
            </div>
            {m.text && <blockquote className="border-l-2 border-ember-400/50 pl-3 font-serif text-cream-100/90">“{m.text}”</blockquote>}
            {m.video_url ? <video controls playsInline preload="metadata" src={m.video_url} className="mx-auto max-h-[420px] w-full rounded-2xl bg-black object-contain" aria-label={`Lip-synced AI keepsake of ${m.person_name}`} />
              : m.audio_url && <audio controls preload="none" src={m.audio_url} className="w-full" aria-label={`Play AI voice of ${m.person_name}`} />}
            {m.video_status === 'making' && <p className="text-sm text-dusk-300">Making a lip-synced keepsake clip — this takes a minute or two.</p>}
            <div className="mt-auto flex flex-wrap gap-2">
              {m.audio_url && (
                <a className="btn-ghost text-sm" href={`/api/memories/${m.id}/download`} download="memory-ai-recreation.mp4">
                  Download (labelled AI)
                </a>
              )}
              {m.call_id && <Link className="btn-ghost text-sm" to={`/history/${m.call_id}`}>Open call</Link>}
              <button className="btn-ghost text-sm text-red-200" onClick={() => setConfirm(m)} aria-label={`Remove this memory of ${m.person_name}`}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      {items.some((m) => m.audio_url) && (
        <p className="mt-4 text-sm text-cream-200/60">Downloads are short videos with a visible “AI recreation” label, so they're never mistaken for a real recording.</p>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remove this memory?">
        <p className="text-cream-100/85">It will be taken out of your memory box. The call itself stays in your history.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setConfirm(null)}>Keep it</button>
          <button className="btn-danger" disabled={remove.isPending} onClick={() => confirm && remove.mutate(confirm.id)}>
            {remove.isPending && <Spinner size={18} />} Remove
          </button>
        </div>
      </Modal>
    </div>
  )
}
