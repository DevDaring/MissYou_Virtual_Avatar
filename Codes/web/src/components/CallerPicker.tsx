import { useState, type FormEvent } from 'react'
import { Modal, Notice, Spinner } from './ui'
import { errorText, patch } from '../lib/api'
import type { Caller, Person } from '../lib/types'
import { useAuth } from '../store/auth'

/** "Who's calling?" — the account owner or a saved family member (e.g. a wife calling her mother-in-law). */
export default function CallerPicker({ person, open, onClose, onPick, onPersonChange, busy }: {
  person: Person; open: boolean; onClose: () => void; onPick: (callerId: string | null) => void
  onPersonChange?: (p: Person) => void; busy?: boolean
}) {
  const user = useAuth((s) => s.user)
  const name = person.called_name || person.name
  const callers = person.persona?.callers || []
  const [adding, setAdding] = useState(callers.length === 0)
  const empty = { name: '', relation: '', nickname: '', calls_them: '', notes: '' }
  const [f, setF] = useState(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(list: Caller[]) {
    setSaving(true); setErr(null)
    try {
      const r = await patch<{ person?: Person }>(`/api/people/${person.id}`, { persona: { callers: list } })
      if (r.person) onPersonChange?.(r.person)
      return r.person
    } catch (e) { setErr(errorText(e)); return undefined } finally { setSaving(false) }
  }
  async function add(e: FormEvent) {
    e.preventDefault()
    const list = editing ? callers.map((c) => (c.id === editing ? { ...c, ...f } : c)) : [...callers, { id: '', ...f }]
    const p = await save(list)
    if (p) { setF(empty); setEditing(null); setAdding(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Who's calling?">
      <div className="space-y-3">
        <button className="flex w-full items-center justify-between gap-3 rounded-2xl bg-ember-500/10 px-4 py-3 text-left ring-1 ring-ember-400/40 hover:bg-ember-500/15" onClick={() => onPick(null)} disabled={busy}>
          <span><span className="block font-semibold text-cream-50">Me{user?.display_name ? ` (${user.display_name})` : ''}</span><span className="text-sm text-cream-200/70">{name} is my {person.relationship || 'loved one'}</span></span>
          <span aria-hidden="true">📞</span>
        </button>
        {callers.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <button className="flex flex-1 items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3 text-left ring-1 ring-white/15 hover:bg-white/10" onClick={() => onPick(c.id)} disabled={busy}>
              <span><span className="block font-semibold text-cream-50">{c.name}</span><span className="text-sm text-cream-200/70">{name} is their {c.relation || 'family'}{c.nickname ? ` · calls them “${c.nickname}”` : ''}</span></span>
              <span aria-hidden="true">📞</span>
            </button>
            <button className="h-12 w-12 shrink-0 rounded-full text-cream-200/60 hover:bg-white/10" aria-label={`Edit ${c.name}`}
              onClick={() => { setF({ name: c.name, relation: c.relation, nickname: c.nickname, calls_them: c.calls_them, notes: c.notes || '' }); setEditing(c.id); setAdding(true) }}>✎</button>
            <button className="h-12 w-12 shrink-0 rounded-full text-cream-200/60 hover:bg-white/10" aria-label={`Remove ${c.name}`} disabled={saving}
              onClick={() => void save(callers.filter((x) => x.id !== c.id))}>✕</button>
          </div>
        ))}
        {busy && <div className="flex justify-center py-2 text-ember-300"><Spinner /></div>}
        {adding ? (
          <form onSubmit={add} className="space-y-3 rounded-2xl bg-night-950/40 p-4 ring-1 ring-white/10">
            <div className="font-semibold">{editing ? `Edit ${f.name || 'caller'}` : `Add someone who'll call ${name}`}</div>
            <div><label className="label" htmlFor="cp-name">Their name</label><input id="cp-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Priya" required /></div>
            <div><label className="label" htmlFor="cp-rel">{name} is their…</label><input id="cp-rel" className="input" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} placeholder="sister, mother-in-law, grandmother, best friend…" required /></div>
            <div><label className="label" htmlFor="cp-nick">What {name} called them</label><input id="cp-nick" className="input" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="বোনটি, বৌমা, Chhoto, Priya…" /></div>
            <div><label className="label" htmlFor="cp-calls">What they call {name} (optional)</label><input id="cp-calls" className="input" value={f.calls_them} onChange={(e) => setF({ ...f, calls_them: e.target.value })} placeholder="Didi, Ma, Thamma…" /></div>
            <div><label className="label" htmlFor="cp-notes">Things they shared or love to talk about (optional)</label>
              <textarea id="cp-notes" className="input min-h-[96px] py-3" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })}
                placeholder="Growing up together in Barasat; mango-stealing summers; their mother's fish curry; teasing each other about who sang better" /></div>
            {err && <Notice tone="error">{err}</Notice>}
            <div className="flex gap-2">
              {callers.length > 0 && <button type="button" className="btn-ghost flex-1" onClick={() => { setAdding(false); setEditing(null); setF(empty) }}>Cancel</button>}
              <button className="btn-primary flex-1" disabled={saving}>{saving ? <Spinner /> : 'Save'}</button>
            </div>
          </form>
        ) : <button className="btn-ghost w-full" onClick={() => setAdding(true)}>+ Someone else</button>}
        <p className="text-xs text-cream-200/60">{name} will talk to them as their {callers[0]?.relation || 'family member'} would expect, using the memories you've shared. Calls use this account's minutes and credits.</p>
      </div>
    </Modal>
  )
}
