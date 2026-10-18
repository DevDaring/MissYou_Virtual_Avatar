import { useEffect, useState } from 'react'
import { Modal, Notice, Spinner } from '../components/ui'
import { errorText, get, post } from '../lib/api'
import type { Person } from '../lib/types'

interface Face { id: string; thumb: string; crop: string; quality: number; is_anchor: boolean; restored: string | null; use_restored: boolean }

export default function StepAnchors({ person, onNext, onBack }: { person: Person; onNext: () => void; onBack: () => void }) {
  const [faces, setFaces] = useState<Face[] | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [restoring, setRestoring] = useState<Face | null>(null)
  const [ba, setBa] = useState<{ before: string; after: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    get<{ faces: Face[] }>(`/api/people/${person.id}/anchors`).then((r) => { setFaces(r.faces); setSel(r.faces.filter((f) => f.is_anchor).map((f) => f.id)) })
  }, [person.id])

  async function save() {
    setBusy(true); setErr(null)
    try { await post(`/api/people/${person.id}/anchors`, { face_ids: sel }); onNext() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  async function restore(f: Face) {
    setRestoring(f); setBa(null)
    try { setBa(await post(`/api/people/${person.id}/faces/${f.id}/restore`)) } catch (e) { setErr(errorText(e)); setRestoring(null) }
  }
  async function keep(use: boolean) {
    if (!restoring) return
    await post(`/api/people/${person.id}/faces/${restoring.id}/use_restored`, { use })
    setFaces((fs) => fs?.map((x) => (x.id === restoring.id ? { ...x, use_restored: use, restored: ba?.after || x.restored } : x)) || null)
    setRestoring(null)
  }

  if (!faces) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={30} /></div>
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-2xl">Their clearest photos</h2>
        <p className="mt-1 text-cream-200/75">We picked the sharpest, most front-facing, best-lit faces. These guide how {person.called_name || person.name} will look. Choose 1–5. Old or blurry? Try a gentle restore.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {faces.map((f) => {
          const on = sel.includes(f.id)
          return (
            <div key={f.id} className={`card overflow-hidden p-0 ring-2 ${on ? 'ring-ember-400' : 'ring-white/10'}`}>
              <button className="block w-full" aria-pressed={on} onClick={() => setSel((s) => (on ? s.filter((x) => x !== f.id) : s.length < 5 ? [...s, f.id] : s))}>
                <img src={f.use_restored && f.restored ? f.restored : f.crop} alt="Face" className="aspect-square w-full object-cover" />
              </button>
              <div className="flex items-center justify-between gap-1 px-3 py-2 text-xs">
                <span className={on ? 'font-bold text-ember-300' : 'text-cream-200/60'}>{on ? '✓ Using' : `Quality ${Math.round(f.quality * 100)}`}</span>
                <button className="rounded-full px-2 py-2 font-semibold text-dusk-300 hover:bg-white/10" onClick={() => restore(f)}>Restore</button>
              </div>
            </div>
          )
        })}
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex gap-3"><button className="btn-ghost" onClick={onBack}>Back</button><button className="btn-primary flex-1 sm:flex-none" disabled={!sel.length || busy} onClick={save}>{busy ? <Spinner /> : 'Use these photos'}</button></div>
      <Modal open={!!restoring} onClose={() => setRestoring(null)} title="Gentle restoration" wide>
        {!ba ? <div className="flex justify-center py-10 text-ember-300"><Spinner size={28} /></div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <figure><img src={ba.before} alt="Before" className="w-full rounded-2xl" /><figcaption className="mt-1 text-center text-sm text-cream-200/70">Before</figcaption></figure>
              <figure><img src={ba.after} alt="After restoration" className="w-full rounded-2xl" /><figcaption className="mt-1 text-center text-sm text-cream-200/70">After</figcaption></figure>
            </div>
            <Notice>{ba.note}</Notice>
            <div className="flex gap-3"><button className="btn-ghost flex-1" onClick={() => keep(false)}>Keep the original</button><button className="btn-primary flex-1" onClick={() => keep(true)}>Use restored</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
