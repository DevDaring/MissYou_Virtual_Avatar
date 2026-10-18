import { useState, type FormEvent } from 'react'
import { Modal, Notice, Spinner } from './ui'
import { errorText, patch } from '../lib/api'
import type { Person } from '../lib/types'

/** Edit a loved one's name and basic details. */
export default function EditDetails({ person, open, onClose, onSaved }: {
  person: Person; open: boolean; onClose: () => void; onSaved: (p: Person) => void
}) {
  const [f, setF] = useState({
    name: person.name || '', called_name: person.called_name || '', relationship: person.relationship || '',
    age: person.age ? String(person.age) : '', gender: person.gender || '', life_status: person.life_status,
    call_language: person.call_language,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const r = await patch<{ person?: Person; pending_approval?: boolean }>(`/api/people/${person.id}`, { ...f, age: f.age ? Number(f.age) : null })
      if (r.person) onSaved(r.person)
      onClose()
    } catch (e2) { setErr(errorText(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit name & details" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ed-name">Their name</label><input id="ed-name" className="input" value={f.name} onChange={set('name')} required /></div>
          <div><label className="label" htmlFor="ed-called">What you called them</label><input id="ed-called" className="input" value={f.called_name} onChange={set('called_name')} placeholder="Ma, Dadu, Didi…" /></div>
          <div><label className="label" htmlFor="ed-rel">They are my…</label><input id="ed-rel" className="input" value={f.relationship} onChange={set('relationship')} /></div>
          <div><label className="label" htmlFor="ed-age">Age, or age when last seen</label><input id="ed-age" className="input" inputMode="numeric" value={f.age} onChange={set('age')} /></div>
          <div><label className="label" htmlFor="ed-gender">Gender</label><select id="ed-gender" className="input" value={f.gender} onChange={set('gender')}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
          <div><label className="label" htmlFor="ed-lang">Call language</label><select id="ed-lang" className="input" value={f.call_language} onChange={set('call_language')}><option value="en">English</option><option value="bn">বাংলা (Bengali)</option><option value="hi">हिन्दी (Hindi)</option></select></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['passed', 'Passed away'], ['far', 'Living, but far away']] as const).map(([v, l]) => (
            <label key={v} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl px-4 ring-1 ${f.life_status === v ? 'bg-ember-500/15 ring-ember-400/60' : 'bg-white/5 ring-white/15'}`}>
              <input type="radio" name="ed-ls" value={v} checked={f.life_status === v} onChange={set('life_status')} className="accent-ember-500" />{l}
            </label>
          ))}
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Save'}</button>
      </form>
    </Modal>
  )
}
