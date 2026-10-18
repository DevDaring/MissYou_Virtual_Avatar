import { useRef, useState } from 'react'
import { Modal, Notice, Progress, Spinner } from './ui'
import { errorText, get, post, uploadFile } from '../lib/api'
import type { Person, Scene } from '../lib/types'
import { useJob } from '../setup/useJob'

interface Cluster { id: string; size: number; best: string | null }
type Step = 'pick' | 'processing' | 'choose' | 'scene' | 'refused'

/** Change their picture: upload new photos → pick their face (safety checks run) → recreate the scene. */
export default function ChangePhoto({ person, scenes, open, onClose, onDone }: {
  person: Person; scenes: Scene[]; open: boolean; onClose: () => void; onDone: () => void
}) {
  const name = person.called_name || person.name
  const [step, setStep] = useState<Step>('pick')
  const [files, setFiles] = useState<File[]>([])
  const [removeOld, setRemoveOld] = useState(true)
  const [progress, setProgress] = useState<number | null>(null)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const latest = scenes.find((s) => s.status === 'ready') || scenes[0]
  const { job, track } = useJob(async (j) => {
    if (j.status !== 'done') { setErr(j.message || 'Processing failed.'); setStep('pick'); return }
    const r = await get<{ clusters: Cluster[] }>(`/api/people/${person.id}/clusters`)
    setClusters(r.clusters); setSelected(r.clusters[0]?.id || null)
    if (!r.clusters.length) { setErr("We couldn't find a clear face. Try a well-lit photo where their face is visible."); setStep('pick') }
    else setStep('choose')
  })

  function reset() { setStep('pick'); setFiles([]); setProgress(null); setClusters([]); setSelected(null); setErr(null); setMessage('') }
  function close() { reset(); onClose() }

  async function upload() {
    setErr(null); setBusy(true)
    try {
      const ids: string[] = []
      for (let i = 0; i < files.length; i++) {
        const r = await uploadFile(person.id, files[i], (p) => setProgress(Math.round((i * 100 + p) / files.length)))
        if (r.media.kind !== 'photo') throw new Error(`${files[i].name} isn't a photo.`)
        ids.push(r.media.id)
      }
      const r = await post<{ job_id: string }>(`/api/people/${person.id}/photos/replace`, { keep_media_ids: ids, remove_old: removeOld })
      setStep('processing'); track(r.job_id)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false); setProgress(null) }
  }

  async function choose() {
    if (!selected) return
    setBusy(true); setErr(null)
    try {
      const r = await post<{ refused: boolean; message?: string }>(`/api/people/${person.id}/choose`, { cluster_id: selected })
      if (r.refused) { setMessage(r.message || "This photo can't be used."); setStep('refused') }
      else setStep('scene')
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }

  async function recreate() {
    if (!latest) { onDone(); close(); return }
    setBusy(true); setErr(null)
    try { await post(`/api/scenes/${latest.id}/regenerate`); onDone(); close() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title={`Change ${name}'s photo`} wide>
      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-cream-200/80">Choose one or more clear photos of {name} — front-facing, well lit. Their voice, words and memories stay as they are. Location data is removed from every file.</p>
          <button type="button" onClick={() => input.current?.click()} className="flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-white/15 bg-night-950/40 p-5 text-center hover:border-ember-400/60">
            <span className="text-3xl" aria-hidden="true">＋</span>
            <span className="font-semibold">{files.length ? `${files.length} photo${files.length > 1 ? 's' : ''} selected` : 'Tap to choose photos'}</span>
          </button>
          <input ref={input} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          {files.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">{files.map((f) => <img key={f.name} src={URL.createObjectURL(f)} alt={f.name} className="h-20 w-20 shrink-0 rounded-xl object-cover" />)}</div>
          )}
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={removeOld} onChange={(e) => setRemoveOld(e.target.checked)} /><span>Remove the old photos (videos and their voice are kept)</span></label>
          {progress != null && <Progress value={progress} label="Uploading…" />}
          {err && <Notice tone="error">{err}</Notice>}
          <button className="btn-primary w-full" disabled={!files.length || busy} onClick={upload}>{busy ? <Spinner /> : 'Use these photos'}</button>
        </div>
      )}
      {step === 'processing' && <div className="space-y-3 py-4"><Progress value={job?.progress || 5} label={job?.message || 'Finding their face…'} /></div>}
      {step === 'choose' && (
        <div className="space-y-4">
          <p className="text-cream-200/80">{clusters.length > 1 ? `We found ${clusters.length} people. Which one is ${name}?` : `Is this ${name}?`}</p>
          <div className="grid grid-cols-3 gap-3">
            {clusters.map((c, i) => (
              <button key={c.id} onClick={() => setSelected(c.id)} aria-pressed={selected === c.id} className={`overflow-hidden rounded-2xl ring-2 ${selected === c.id ? 'ring-ember-400' : 'ring-white/10'}`}>
                {c.best && <img src={c.best} alt={`Person ${i + 1}`} className="aspect-square w-full object-cover" />}
                <div className="px-2 py-1.5 text-xs">Person {i + 1} · {c.size}</div>
              </button>
            ))}
          </div>
          {err && <Notice tone="error">{err}</Notice>}
          <button className="btn-primary w-full" disabled={!selected || busy} onClick={choose}>{busy ? <><Spinner /> Checking gently…</> : 'This is them'}</button>
        </div>
      )}
      {step === 'refused' && (
        <div className="space-y-4"><Notice tone="warn">{message}</Notice><button className="btn-ghost w-full" onClick={reset}>Choose a different photo</button></div>
      )}
      {step === 'scene' && (
        <div className="space-y-4">
          <Notice tone="ok">Done — {name}'s new photo is saved.</Notice>
          {latest ? (<>
            <p className="text-cream-200/80">Their current scene ({latest.location_label}) still shows the old picture. Recreate it with the new photo? It takes about a minute, and calls pause until it's ready.</p>
            {err && <Notice tone="error">{err}</Notice>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button className="btn-primary flex-1" disabled={busy} onClick={recreate}>{busy ? <Spinner /> : 'Recreate the scene · 60 credits'}</button>
              <button className="btn-ghost flex-1" onClick={() => { onDone(); close() }}>Later</button>
            </div>
          </>) : <button className="btn-primary w-full" onClick={() => { onDone(); close() }}>Done</button>}
        </div>
      )}
    </Modal>
  )
}
