import { useState, type FormEvent } from 'react'
import { Notice, Spinner } from '../components/ui'
import { errorText, patch, post } from '../lib/api'
import type { Person } from '../lib/types'

export default function StepDetails({ person, onSaved }: { person: Person | null; onSaved: (p: Person) => void }) {
  const [f, setF] = useState({
    name: person?.name || '', called_name: person?.called_name || '', relationship: person?.relationship || '',
    life_status: person?.life_status || 'passed', call_language: person?.call_language || 'en', gender: person?.gender || '',
    age: person?.age ? String(person.age) : '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    const body = { ...f, age: f.age ? Number(f.age) : null }
    try {
      const r = person ? await patch<{ person: Person }>(`/api/people/${person.id}`, body) : await post<{ person: Person }>('/api/people', body)
      onSaved(r.person)
    } catch (e2) { setErr(errorText(e2)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="text-2xl">Who would you like to talk to?</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="n">Their name</label><input id="n" className="input" value={f.name} onChange={set('name')} placeholder="e.g. Anjali Sen" required /></div>
        <div><label className="label" htmlFor="c">What you called them</label><input id="c" className="input" value={f.called_name} onChange={set('called_name')} placeholder="Ma, Dadu, Didi…" /></div>
        <div><label className="label" htmlFor="r">They are my…</label><input id="r" className="input" value={f.relationship} onChange={set('relationship')} placeholder="mother, grandfather, partner…" /></div>
        <div><label className="label" htmlFor="l">Call language</label><select id="l" className="input" value={f.call_language} onChange={set('call_language')}><option value="en">English</option><option value="bn">বাংলা (Bengali)</option><option value="hi">हिन्दी (Hindi)</option></select></div>
        <div><label className="label" htmlFor="g">Gender (optional)</label><select id="g" className="input" value={f.gender} onChange={set('gender')}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
        <div><label className="label" htmlFor="a">Age, or age when last seen (optional)</label><input id="a" className="input" inputMode="numeric" value={f.age} onChange={set('age')} /></div>
      </div>
      <fieldset>
        <legend className="label">They have…</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['passed', 'Passed away'], ['far', 'Living, but far away']] as const).map(([v, l]) => (
            <label key={v} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl px-4 ring-1 ${f.life_status === v ? 'bg-ember-500/15 ring-ember-400/60' : 'bg-white/5 ring-white/15'}`}>
              <input type="radio" name="ls" value={v} checked={f.life_status === v} onChange={set('life_status')} className="accent-ember-500" />{l}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-cream-200/60">This changes how the conversation is framed. It never pretends someone who passed is alive.</p>
      </fieldset>
      {err && <Notice tone="error">{err}</Notice>}
      <button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? <Spinner /> : 'Continue'}</button>
    </form>
  )
}
