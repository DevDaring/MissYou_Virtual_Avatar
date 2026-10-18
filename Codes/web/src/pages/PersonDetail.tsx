import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import CallerPicker from '../components/CallerPicker'
import ChangePhoto from '../components/ChangePhoto'
import EditDetails from '../components/EditDetails'
import PersonaForm from '../components/PersonaForm'
import SceneBuilder from '../components/SceneBuilder'
import { AIBadge, Modal, Notice, Spinner, useToast } from '../components/ui'
import { api, del, errorText, get, post } from '../lib/api'
import { callErrorText, startCall } from '../lib/calls'
import type { Person, Scene } from '../lib/types'

type Tab = 'places' | 'persona' | 'interview' | 'closure' | 'family' | 'privacy'

export default function PersonDetail() {
  const { personId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast((s) => s.show)
  const [tab, setTab] = useState<Tab>('places')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const pq = useQuery({ queryKey: ['person', personId], queryFn: () => get<{ person: Person }>(`/api/people/${personId}`).then((r) => r.person) })
  const sq = useQuery({ queryKey: ['scenes', personId], queryFn: () => get<{ scenes: Scene[] }>(`/api/people/${personId}/scenes`).then((r) => r.scenes),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'queued' || s.status === 'generating') ? 6000 : false) })
  const p = pq.data
  const ready = (sq.data || []).filter((s) => s.status === 'ready')
  const [sceneId, setSceneId] = useState<string | null>(null)
  const chosen = ready.find((s) => s.id === sceneId) || ready[0]

  async function call(kind = 'call', callerId: string | null = null) {
    if (!p) return
    setBusy(kind); setErr(null)
    try { const c = await startCall(p.id, { scene_id: kind === 'interview' ? undefined : chosen?.id, kind, ...(callerId ? { caller_id: callerId } : {}) }); nav(`/call/${c.id}`) } catch (e) { setErr(callErrorText(e)); setPickOpen(false) } finally { setBusy(null) }
  }

  if (pq.isLoading || !p) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={30} /></div>
  const name = p.called_name || p.name
  const archived = p.status === 'archived'
  const TABS: [Tab, string][] = [['places', 'Places'], ['persona', 'How they talked'], ['interview', 'Memory interview'], ['closure', 'Closure journey'], ...(p.is_owner ? [['family', 'Family'] as [Tab, string]] : []), ['privacy', 'Privacy']]
  return (
    <div>
      <section className="card relative mb-5 overflow-hidden p-0">
        <div className="grid sm:grid-cols-[260px_1fr]">
          <div className="relative aspect-[3/4] max-h-[360px] bg-night-800 sm:aspect-auto">
            {chosen?.idle_url ? <video src={chosen.idle_url} poster={chosen.still_url || undefined} autoPlay loop muted playsInline className="h-full w-full object-cover" />
              : p.cover_url ? <img src={p.cover_url} alt={`${name} (AI recreation)`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-6xl text-ember-400/50">♡</div>}
            <AIBadge className="absolute left-3 top-3" />
          </div>
          <div className="flex flex-col justify-between gap-4 p-5">
            <div>
              <h1 className="text-4xl">{name}</h1>
              <p className="text-cream-200/70">{[p.name !== name ? p.name : '', p.relationship, p.life_status === 'far' ? 'far away' : ''].filter(Boolean).join(' · ')}</p>
              {p.voice && <p className="mt-2 text-sm text-cream-200/60">Voice: {p.voice.label}</p>}
              {p.is_owner && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-ghost min-h-[44px] px-4 text-sm" onClick={() => setPhotoOpen(true)}>📷 Change photo</button>
                  <button className="btn-ghost min-h-[44px] px-4 text-sm" onClick={() => setEditOpen(true)}>✏️ Edit name &amp; details</button>
                </div>
              )}
            </div>
            {archived ? (
              <div className="space-y-2"><Notice>{name} is archived. Calls are paused; everything is kept safely.</Notice><button className="btn-ghost" onClick={async () => { await post(`/api/people/${p.id}/archive?archived=false`); void pq.refetch() }}>Restore</button></div>
            ) : ready.length ? (
              <div className="space-y-3">
                {ready.length > 1 && <label className="block"><span className="label">Place</span><select className="input" value={chosen?.id} onChange={(e) => setSceneId(e.target.value)}>{ready.map((s) => <option key={s.id} value={s.id}>{s.location_label} · {s.time_of_day.replace('_', ' ')}</option>)}</select></label>}
                <button className="btn-primary w-full text-lg" onClick={() => ((p.persona?.callers?.length ?? 0) > 0 ? setPickOpen(true) : call('call'))} disabled={!!busy}>{busy === 'call' ? <Spinner /> : <>📞 Call {name}</>}</button>
                {p.is_owner && <button className="w-full text-center text-sm font-semibold text-ember-300 underline-offset-4 hover:underline" onClick={() => setPickOpen(true)}>👥 Someone else is calling?</button>}
              </div>
            ) : sq.data && sq.data.some((s) => s.status === 'queued' || s.status === 'generating') ? <Notice>A place is being prepared for your first call…</Notice>
              : <button className="btn-primary" onClick={() => { setTab('places'); setBuilding(true) }}>Choose a place for your first call</button>}
            {p.setup_step !== 'done' && p.is_owner && <Link className="text-sm font-semibold text-ember-300" to={`/people/${p.id}/setup`}>Continue setup →</Link>}
            {err && <Notice tone="error">{err}</Notice>}
          </div>
        </div>
      </section>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-semibold ${tab === k ? 'bg-white/10 text-cream-50 ring-1 ring-white/20' : 'text-cream-200/70'}`}>{l}</button>)}
      </div>

      {pickOpen && <CallerPicker person={p} open={pickOpen} busy={busy === 'call'} onClose={() => setPickOpen(false)}
        onPick={(id) => void call('call', id)} onPersonChange={(np) => qc.setQueryData<Person>(['person', personId], { ...p, ...np })} />}
      {p.is_owner && editOpen && <EditDetails person={p} open={editOpen} onClose={() => setEditOpen(false)}
        onSaved={(np) => { qc.setQueryData<Person>(['person', personId], { ...p, ...np }); void qc.invalidateQueries({ queryKey: ['people'] }) }} />}
      {p.is_owner && <ChangePhoto person={p} scenes={sq.data || []} open={photoOpen} onClose={() => setPhotoOpen(false)}
        onDone={() => { void pq.refetch(); void sq.refetch(); void qc.invalidateQueries({ queryKey: ['people'] }) }} />}
      {tab === 'places' && (
        <div className="space-y-4">
          {!!sq.data?.length && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {sq.data.map((s) => (
                <div key={s.id} className="card overflow-hidden p-0">
                  {s.still_url ? <img src={s.still_url} alt={`${s.location_label} (AI-generated)`} className="aspect-[9/16] w-full object-cover" /> : <div className="flex aspect-[9/16] items-center justify-center text-sm text-cream-200/60">{s.status === 'failed' ? 'Failed' : <Spinner />}</div>}
                  <div className="flex items-center justify-between px-3 py-2 text-sm"><span>{s.location_label}</span>{p.is_owner && <button className="p-2 text-cream-200/50" aria-label="Delete place" onClick={async () => { await del(`/api/scenes/${s.id}`); void sq.refetch() }}>✕</button>}</div>
                </div>
              ))}
            </div>
          )}
          {p.is_owner && (building || !sq.data?.length ? <SceneBuilder person={p} onReady={() => void sq.refetch()} /> : <button className="btn-ghost" onClick={() => setBuilding(true)}>+ Another place</button>)}
        </div>
      )}
      {tab === 'persona' && <PersonaForm person={p} onSaved={(np) => qc.setQueryData<Person>(['person', personId], { ...p, ...np })} />}
      {tab === 'interview' && (
        <div className="card space-y-3">
          <h2 className="text-2xl">Memory interview</h2>
          <p className="text-cream-200/80">A calm guide (not {name}'s voice) asks you small questions — "What did she cook on Sundays?" — and quietly saves your answers as memories, so future calls feel more like them. 2 credits a minute.</p>
          <button className="btn-primary" onClick={() => call('interview')} disabled={!!busy || archived}>{busy === 'interview' ? <Spinner /> : 'Start an interview'}</button>
        </div>
      )}
      {tab === 'closure' && <Closure p={p} onCall={call} busy={busy} refresh={() => void pq.refetch()} />}
      {tab === 'family' && <Family p={p} />}
      {tab === 'privacy' && <Privacy p={p} onDeleted={() => { toast('Deleted.'); void qc.invalidateQueries({ queryKey: ['people'] }); nav('/home') }} refresh={() => void pq.refetch()} />}
    </div>
  )
}

function Closure({ p, onCall, busy, refresh }: { p: Person; onCall: (k: string) => void; busy: string | null; refresh: () => void }) {
  const c = p.closure || {}
  const name = p.called_name || p.name
  const done = c.sessions_done || 0
  const total = c.total || 5
  return (
    <div className="card space-y-4">
      <h2 className="text-2xl">A closure journey</h2>
      <p className="text-cream-200/80">An optional, gentle series of {total} calls designed with grief-informed care: space to say what was left unsaid, and, at the end, a last call where you can say goodbye and receive one. Afterwards you can archive {name} (everything kept, calls paused) or delete everything.</p>
      {!c.active && !c.completed && <button className="btn-primary" onClick={async () => { await post(`/api/people/${p.id}/closure?action=start`); refresh() }}>Begin the journey</button>}
      {c.active && !c.completed && (
        <>
          <div className="flex gap-2" aria-label={`${done} of ${total} sessions done`}>{Array.from({ length: total }).map((_, i) => <div key={i} className={`h-2 flex-1 rounded-full ${i < done ? 'bg-ember-400' : 'bg-white/10'}`} />)}</div>
          {done < total - 1 ? <button className="btn-primary" onClick={() => onCall('closure')} disabled={!!busy}>Session {done + 1} of {total}</button>
            : <button className="btn-primary" onClick={() => onCall('last_call')} disabled={!!busy}>The last call</button>}
          <button className="btn-ghost" onClick={async () => { await post(`/api/people/${p.id}/closure?action=stop`); refresh() }}>Pause the journey</button>
        </>
      )}
      {c.completed && (
        <div className="space-y-3"><Notice tone="ok">You completed the journey. That took courage.</Notice>
          <div className="flex flex-wrap gap-2"><button className="btn-ghost" onClick={async () => { await post(`/api/people/${p.id}/archive?archived=true`); refresh() }}>Archive {name}</button><Link className="btn-ghost" to="/support">Find support</Link></div></div>
      )}
    </div>
  )
}

function Family({ p }: { p: Person }) {
  const fq = useQuery({ queryKey: ['family', p.id], queryFn: () => get<{ members: { id: string; status: string; email: string; name: string | null; invite_code: string | null }[]; requests: { id: string; patch: Record<string, unknown> }[] }>(`/api/people/${p.id}/family`) })
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="text-2xl">Share with family</h2>
        <p className="text-cream-200/80">Invite someone close. They'll have their own calls and private transcripts. Changes they suggest to the persona need your approval. There is no public sharing.</p>
        <div className="flex flex-col gap-2 sm:flex-row"><input className="input" placeholder="Their email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn-primary shrink-0" onClick={async () => { try { const r = await post<{ link: string }>(`/api/people/${p.id}/family`, { email }); setLink(r.link); void fq.refetch() } catch (e) { setErr(errorText(e)) } }}>Create invite</button></div>
        {link && <Notice tone="ok">Send this private link: <span className="break-all font-mono">{link}</span> <button className="ml-2 underline" onClick={() => navigator.clipboard.writeText(link)}>Copy</button></Notice>}
        {err && <Notice tone="error">{err}</Notice>}
      </div>
      {!!fq.data?.members.length && <div className="card space-y-2">{fq.data.members.map((m) => <div key={m.id} className="flex items-center justify-between gap-2 rounded-2xl bg-night-950/40 px-4 py-3"><span>{m.name || m.email || 'Invite'} · <span className="text-sm text-cream-200/60">{m.status}</span></span>{m.status !== 'revoked' && <button className="text-sm text-red-300" onClick={async () => { await del(`/api/people/${p.id}/family/${m.id}`); void fq.refetch() }}>Revoke</button>}</div>)}</div>}
      {!!fq.data?.requests.length && (
        <div className="card space-y-2"><h3 className="text-xl">Suggested changes</h3>{fq.data.requests.map((r) => (
          <div key={r.id} className="rounded-2xl bg-night-950/40 p-3"><pre className="whitespace-pre-wrap text-sm text-cream-200/80">{JSON.stringify(r.patch, null, 1)}</pre>
            <div className="mt-2 flex gap-2"><button className="btn-primary min-h-[44px] text-sm" onClick={async () => { await post(`/api/people/${p.id}/requests/${r.id}`, { approve: true }); void fq.refetch() }}>Approve</button><button className="btn-ghost min-h-[44px] text-sm" onClick={async () => { await post(`/api/people/${p.id}/requests/${r.id}`, { approve: false }); void fq.refetch() }}>Decline</button></div></div>))}</div>
      )}
    </div>
  )
}

function Privacy({ p, onDeleted, refresh }: { p: Person; onDeleted: () => void; refresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const name = p.name || 'DELETE'
  if (!p.is_owner) return <div className="card">Only the person who created this profile can change privacy settings.</div>
  return (
    <div className="card space-y-4">
      <h2 className="text-2xl">Privacy</h2>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={!p.keep_raw_uploads} onChange={async (e) => { await api(`/api/people/${p.id}`, { method: 'PATCH', body: { keep_raw_uploads: !e.target.checked } }); refresh() }} /><span>Keep only what's needed for calls (raw uploads can be removed after processing).</span></label>
      <p className="text-sm text-cream-200/70">All uploads and generated media are encrypted at rest and shown only through short-lived private links. You can download everything from Settings.</p>
      <button className="btn-danger" onClick={() => setOpen(true)}>Delete {p.called_name || p.name} and all their data</button>
      <Modal open={open} onClose={() => { setOpen(false); if (report) onDeleted() }} title={report ? 'Deleted' : 'Delete everything?'} wide>
        {report ? (
          <div className="space-y-3"><Notice tone="ok">Everything for {p.name} has been deleted. Here's exactly what was removed and where:</Notice><pre className="max-h-80 overflow-auto rounded-2xl bg-night-950/60 p-3 text-xs">{JSON.stringify(report, null, 2)}</pre><button className="btn-primary w-full" onClick={onDeleted}>Close</button></div>
        ) : (
          <div className="space-y-3">
            <p>This permanently deletes their photos, videos, voice, scenes, calls, memories and letters, here and at providers where possible. This can't be undone.</p>
            <label className="label" htmlFor="cf">Type <b>{name}</b> to confirm</label>
            <input id="cf" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {err && <Notice tone="error">{err}</Notice>}
            <button className="btn-danger w-full" disabled={confirm.trim().toLowerCase() !== name.toLowerCase()} onClick={async () => { try { const r = await del<{ report: Record<string, unknown> }>(`/api/people/${p.id}?confirm=${encodeURIComponent(confirm)}`); setReport(r.report) } catch (e) { setErr(errorText(e)) } }}>Delete permanently</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
