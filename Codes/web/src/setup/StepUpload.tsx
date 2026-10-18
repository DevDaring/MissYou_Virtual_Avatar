import { useEffect, useRef, useState } from 'react'
import { Notice, Progress, Spinner } from '../components/ui'
import { del, errorText, get, post, uploadFile, type MediaItem } from '../lib/api'
import type { Person } from '../lib/types'
import { useJob } from './useJob'

interface Pending { name: string; progress: number; error?: string }

export default function StepUpload({ person, onNext }: { person: Person; onNext: () => void }) {
  const [consented, setConsented] = useState(!!person.consented)
  const [statements, setStatements] = useState<string[]>([])
  const [checks, setChecks] = useState<Record<number, boolean>>({})
  const [media, setMedia] = useState<MediaItem[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [kit, setKit] = useState<{ available: boolean; note: string } | null>(null)
  const [kitBusy, setKitBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { job, track, running } = useJob((j) => { if (j.status === 'done') onNext() })

  useEffect(() => {
    get<{ statements: string[] }>('/api/consent/media').then((r) => setStatements(r.statements)).catch(() => {})
    get<{ media: MediaItem[] }>(`/api/people/${person.id}/media`).then((r) => setMedia(r.media)).catch(() => {})
    get<{ available: boolean; note: string }>('/api/sample-kit').then(setKit).catch(() => {})
  }, [person.id])

  async function useKit() {
    setKitBusy(true); setErr(null)
    try { const r = await post<{ media: MediaItem[] }>(`/api/people/${person.id}/sample-kit`); setMedia((m) => [...m, ...r.media]) } catch (e) { setErr(errorText(e)) } finally { setKitBusy(false) }
  }

  async function consent() {
    try { await post(`/api/people/${person.id}/consent`, { statements }); setConsented(true) } catch (e) { setErr(errorText(e)) }
  }

  async function addFiles(files: FileList | null) {
    if (!files) return
    const list = Array.from(files)
    setPending((p) => [...p, ...list.map((f) => ({ name: f.name, progress: 0 }))])
    for (const f of list) {
      try {
        const r = await uploadFile(person.id, f, (pr) => setPending((p) => p.map((x) => (x.name === f.name ? { ...x, progress: pr } : x))))
        setMedia((m) => [...m, r.media])
        setPending((p) => p.filter((x) => x.name !== f.name))
      } catch (e) {
        setPending((p) => p.map((x) => (x.name === f.name ? { ...x, error: errorText(e) } : x)))
      }
    }
  }

  async function process() {
    setErr(null)
    try { const r = await post<{ job_id: string }>(`/api/people/${person.id}/process`); track(r.job_id) } catch (e) { setErr(errorText(e)) }
  }

  if (!consented) return (
    <div className="card space-y-4">
      <h2 className="text-2xl">Before you upload</h2>
      <p className="text-cream-200/80">Please confirm each of these. We keep a dated record of your confirmation.</p>
      {statements.map((s, k) => (
        <label key={k} className="flex items-start gap-3 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-ember-500" checked={!!checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} /><span>{s}</span></label>
      ))}
      {err && <Notice tone="error">{err}</Notice>}
      <button className="btn-primary" disabled={!statements.every((_, k) => checks[k])} onClick={consent}>I confirm</button>
    </div>
  )

  const visual = media.filter((m) => m.kind === 'photo' || m.kind === 'video').length
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-2xl">Add your memories of {person.called_name || person.name}</h2>
        <p className="mt-1 text-cream-200/75">Photos (JPG, PNG, HEIC, WebP) and videos (MP4, MOV, WebM). At least one photo or video is needed. Old voice notes (MP3, WAV, M4A, OGG) help us learn their voice. Location data is removed from every file.</p>
        <button type="button" onClick={() => input.current?.click()} className="mt-4 flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-white/15 bg-night-950/40 p-6 text-center hover:border-ember-400/60"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files) }}>
          <span className="text-3xl" aria-hidden="true">＋</span>
          <span className="font-semibold">Tap to choose files, or drop them here</span>
          <span className="text-xs text-cream-200/60">Large videos upload in pieces and resume if the network drops.</span>
        </button>
        <input ref={input} type="file" multiple hidden accept="image/*,video/*,audio/*,.heic,.heif,.m4a,.ogg,.opus" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
        {pending.length > 0 && <div className="mt-4 space-y-3">{pending.map((p) => <div key={p.name}>{p.error ? <Notice tone="error">{p.name}: {p.error}</Notice> : <Progress value={p.progress} label={p.name} />}</div>)}</div>}
      </div>
      {kit?.available && !media.some((m) => m.name === 'family_birthday_video.mp4') && (
        <div className="card flex flex-col gap-3 border border-dusk-400/30 bg-dusk-500/10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-cream-50">No memories to hand? Try with our sample family</div>
            <p className="text-sm text-cream-200/75">A birthday video and photos of a fictional family of three. {kit.note}</p>
          </div>
          <button className="btn-ghost shrink-0" onClick={useKit} disabled={kitBusy}>{kitBusy ? <Spinner /> : 'Use sample memories'}</button>
        </div>
      )}
      {media.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-lg">{media.length} file{media.length > 1 ? 's' : ''}</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {media.map((m) => (
              <div key={m.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-night-950/60 ring-1 ring-white/10">
                {m.kind === 'photo' || m.kind === 'place_photo' ? <img src={m.url} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                  : m.kind === 'video' ? <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" />
                  : <div className="flex h-full flex-col items-center justify-center p-2 text-center text-xs"><span className="text-2xl" aria-hidden="true">🎙️</span>{m.name}</div>}
                <span className="absolute bottom-1 left-1 rounded-full bg-night-900/80 px-2 text-[10px] font-bold uppercase">{m.kind}</span>
                <button className="absolute right-1 top-1 h-9 w-9 rounded-full bg-night-900/80 text-sm opacity-90" aria-label={`Remove ${m.name}`} onClick={async () => { await del(`/api/people/${person.id}/media/${m.id}`); setMedia((x) => x.filter((y) => y.id !== m.id)) }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}
      {job && <div className="card space-y-3"><Progress value={job.progress} label={job.message || 'Working…'} />{job.status === 'failed' && <Notice tone="error">{job.message}</Notice>}{job.status === 'done' && <Notice tone="ok">{job.message}</Notice>}</div>}
      <button className="btn-primary w-full sm:w-auto" disabled={!visual || running || pending.some((p) => !p.error)} onClick={process}>{running ? <><Spinner /> Finding faces…</> : 'Find the people in these memories'}</button>
    </div>
  )
}
