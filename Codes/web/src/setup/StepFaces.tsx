import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Notice, Spinner } from '../components/ui'
import { errorText, get, post } from '../lib/api'
import type { Person } from '../lib/types'

interface Cluster { id: string; size: number; best: string | null; faces: { id: string; thumb: string; quality: number }[] }

export default function StepFaces({ person, onNext, onBack }: { person: Person; onNext: () => void; onBack: () => void }) {
  const [clusters, setClusters] = useState<Cluster[] | null>(null)
  const [selected, setSelected] = useState<string | null>(person.chosen_cluster_id)
  const [mode, setMode] = useState<'pick' | 'merge' | 'split'>('pick')
  const [mergeSel, setMergeSel] = useState<string[]>([])
  const [splitFrom, setSplitFrom] = useState<Cluster | null>(null)
  const [splitSel, setSplitSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(person.status === 'refused' ? (person.refused_reason || 'refused') : null)

  const load = useCallback(() => get<{ clusters: Cluster[] }>(`/api/people/${person.id}/clusters`).then((r) => setClusters(r.clusters)), [person.id])
  useEffect(() => { void load() }, [load])

  async function choose() {
    if (!selected) return
    setBusy(true); setErr(null)
    try {
      const r = await post<{ refused: boolean; message?: string }>(`/api/people/${person.id}/choose`, { cluster_id: selected })
      if (r.refused) setRefused(r.message || 'refused'); else onNext()
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  async function merge() {
    setBusy(true)
    try { await post(`/api/people/${person.id}/clusters/merge`, { cluster_ids: mergeSel }); setMergeSel([]); setMode('pick'); await load() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  async function split() {
    if (!splitFrom) return
    setBusy(true)
    try { await post(`/api/people/${person.id}/clusters/${splitFrom.id}/split`, { face_ids: splitSel }); setSplitSel([]); setSplitFrom(null); setMode('pick'); await load() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }

  if (refused) return (
    <div className="card space-y-4">
      <h2 className="text-2xl">We can't create this profile</h2>
      <p className="leading-relaxed text-cream-100/90">{refused.length > 20 ? refused : 'This profile was declined by our safety checks.'}</p>
      <p className="text-sm text-cream-200/70">If you think this is a mistake, you can go back and choose a different person, or add clearer photos.</p>
      <div className="flex gap-3"><button className="btn-ghost" onClick={() => setRefused(null)}>Choose someone else</button><Link className="btn-ghost" to="/support">Support</Link></div>
    </div>
  )

  if (!clusters) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={30} /></div>
  if (!clusters.length) return <div className="card space-y-3"><p>We couldn't find a clear face. Please add a well-lit photo where their face is visible.</p><button className="btn-ghost" onClick={onBack}>Add more memories</button></div>

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-2xl">We found {clusters.length === 1 ? 'one person' : `${clusters.length} people`}.</h2>
        <p className="mt-1 text-cream-200/75">Who would you like to talk to? If we grouped someone wrongly, you can merge or split groups.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={mode === 'pick' ? 'btn-primary min-h-[44px] text-sm' : 'btn-ghost min-h-[44px] text-sm'} onClick={() => setMode('pick')}>Choose</button>
          <button className={mode === 'merge' ? 'btn-primary min-h-[44px] text-sm' : 'btn-ghost min-h-[44px] text-sm'} onClick={() => setMode('merge')} disabled={clusters.length < 2}>Merge groups</button>
          <button className={mode === 'split' ? 'btn-primary min-h-[44px] text-sm' : 'btn-ghost min-h-[44px] text-sm'} onClick={() => setMode('split')}>Split a group</button>
        </div>
      </div>
      {mode === 'split' && splitFrom ? (
        <div className="card">
          <p className="mb-3">Tap the faces that are <b>not</b> the same person as the rest, then split.</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {splitFrom.faces.map((f) => (
              <button key={f.id} onClick={() => setSplitSel((s) => (s.includes(f.id) ? s.filter((x) => x !== f.id) : [...s, f.id]))} className={`overflow-hidden rounded-2xl ring-2 ${splitSel.includes(f.id) ? 'ring-ember-400' : 'ring-transparent'}`} aria-pressed={splitSel.includes(f.id)}>
                <img src={f.thumb} alt="Face" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2"><button className="btn-ghost" onClick={() => setSplitFrom(null)}>Cancel</button><button className="btn-primary" disabled={!splitSel.length || busy} onClick={split}>Split {splitSel.length} out</button></div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {clusters.map((c, i) => {
            const on = mode === 'pick' ? selected === c.id : mode === 'merge' ? mergeSel.includes(c.id) : false
            return (
              <button key={c.id} className={`card overflow-hidden p-0 text-left ring-2 transition ${on ? 'ring-ember-400 shadow-glow' : 'ring-white/10'}`} aria-pressed={on}
                onClick={() => mode === 'pick' ? setSelected(c.id) : mode === 'merge' ? setMergeSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id])) : (setSplitFrom(c), setSplitSel([]))}>
                {c.best && <img src={c.best} alt={`Person ${i + 1}`} className="aspect-square w-full object-cover" />}
                <div className="flex items-center justify-between px-4 py-3"><span className="font-semibold">Person {i + 1}</span><span className="text-xs text-cream-200/70">{c.size} photo{c.size > 1 ? 's' : ''}</span></div>
                {c.faces.length > 1 && <div className="flex gap-1 px-4 pb-3">{c.faces.slice(1, 6).map((f) => <img key={f.id} src={f.thumb} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-white/20" />)}</div>}
              </button>
            )
          })}
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}
      {mode === 'merge' && <button className="btn-primary" disabled={mergeSel.length < 2 || busy} onClick={merge}>Merge {mergeSel.length} groups</button>}
      {mode === 'pick' && <div className="flex gap-3"><button className="btn-ghost" onClick={onBack}>Back</button><button className="btn-primary flex-1 sm:flex-none" disabled={!selected || busy} onClick={choose}>{busy ? <><Spinner /> Checking gently…</> : 'This is them'}</button></div>}
      <p className="text-xs text-cream-200/60">To keep everyone safe we check that the person is an adult and isn't a well-known public figure.</p>
    </div>
  )
}
