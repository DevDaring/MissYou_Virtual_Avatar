import { useEffect, useState } from 'react'
import { Notice, Spinner, useToast } from './ui'
import { del, errorText, get, patch, post } from '../lib/api'
import type { Person, Persona } from '../lib/types'

const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : (v as string) || '')
const asList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

const FIELDS: { key: keyof Persona; label: string; ph: string; list?: boolean; long?: boolean }[] = [
  { key: 'greeting', label: 'How did they greet you?', ph: 'Ki re, kemon achish? / Beta, khana khaya?' },
  { key: 'nicknames', label: 'What did they call you?', ph: 'Shona, Babu, Guddu', list: true },
  { key: 'phrases', label: 'Favourite phrases or sayings', ph: 'Thakur bhalo korbe, Sab theek ho jayega', list: true },
  { key: 'speech_style', label: 'How did they talk?', ph: 'Slow and soft, teasing, asked lots of questions…', long: true },
  { key: 'humour', label: 'Their sense of humour', ph: 'Gentle teasing about my messy room' },
  { key: 'goodbye', label: 'How did they end calls?', ph: 'Bhalo theko, time-e kheye nish' },
  { key: 'topics_loved', label: 'Things they loved talking about', ph: 'Cricket, her garden, old Hindi songs', list: true },
  { key: 'topics_avoid', label: 'Topics to avoid', ph: 'The hospital, money worries', list: true },
  { key: 'languages', label: 'Languages they spoke', ph: 'Bengali, English, a little Hindi', list: true },
  { key: 'code_mix', label: 'Did they mix languages?', ph: 'Bengali with English words' },
]

export default function PersonaForm({ person, onSaved }: { person: Person; onSaved?: (p: Person) => void }) {
  const toast = useToast((s) => s.show)
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((x) => [x.key, asText(person.persona?.[x.key])])))
  const [heaven, setHeaven] = useState(!!person.persona?.heaven_framing)
  const [useTx, setUseTx] = useState(person.persona?.use_transcripts !== false)
  const [notes, setNotes] = useState<{ id: string; text: string; source: string }[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { get<{ notes: typeof notes }>(`/api/people/${person.id}/notes`).then((r) => setNotes(r.notes)).catch(() => {}) }, [person.id])

  async function save() {
    setBusy(true); setErr(null)
    const persona: Record<string, unknown> = { heaven_framing: heaven, use_transcripts: useTx }
    for (const x of FIELDS) persona[x.key] = x.list ? asList(f[x.key]) : f[x.key]
    try {
      const r = await patch<{ person?: Person; pending_approval?: boolean }>(`/api/people/${person.id}`, { persona })
      if (r.pending_approval) toast('Sent to the creator for approval.')
      else if (r.person) { toast('Saved.'); onSaved?.(r.person) }
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  async function addNote() {
    if (!note.trim()) return
    const r = await post<{ id?: string; pending_approval?: boolean }>(`/api/people/${person.id}/notes`, { text: note })
    if (r.id) setNotes((n) => [{ id: r.id!, text: note, source: 'user' }, ...n]); else toast('Sent to the creator for approval.')
    setNote('')
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div><h2 className="text-2xl">How did {person.called_name || person.name} talk?</h2><p className="mt-1 text-cream-200/75">Everything here is optional and you can change it any time. Separate several items with commas.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((x) => (
            <div key={x.key} className={x.long ? 'sm:col-span-2' : ''}>
              <label className="label" htmlFor={`pf-${x.key}`}>{x.label}</label>
              {x.long ? <textarea id={`pf-${x.key}`} className="input min-h-[90px] py-3" value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.ph} />
                : <input id={`pf-${x.key}`} className="input" value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.ph} />}
            </div>
          ))}
        </div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={useTx} onChange={(e) => setUseTx(e.target.checked)} /><span>Use the words from my uploaded videos and voice notes as examples of how they spoke.</span></label>
        {person.life_status === 'passed' && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={heaven} onChange={(e) => setHeaven(e.target.checked)} /><span>Allow gentle, respectful spiritual language ("you carry me with you"). By default it never speaks about heaven or the afterlife, and it never claims real contact.</span></label>}
        {err && <Notice tone="error">{err}</Notice>}
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button>
      </div>
      <div className="card space-y-3">
        <h3 className="text-xl">Memories to remember</h3>
        <p className="text-sm text-cream-200/70">Short notes the recreation may gently refer to. It will never invent memories you didn't share.</p>
        <div className="flex flex-col gap-2 sm:flex-row"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="She made payesh on every birthday" onKeyDown={(e) => e.key === 'Enter' && addNote()} /><button className="btn-ghost shrink-0" onClick={addNote}>Add</button></div>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 rounded-2xl bg-night-950/40 px-4 py-3 ring-1 ring-white/10">
              <span>{n.text}{n.source === 'interview' && <span className="ml-2 text-xs text-dusk-300">from interview</span>}</span>
              <button className="-m-2 p-2 text-cream-200/50 hover:text-cream-50" aria-label="Delete memory" onClick={async () => { await del(`/api/people/${person.id}/notes/${n.id}`); setNotes((x) => x.filter((y) => y.id !== n.id)) }}>✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
