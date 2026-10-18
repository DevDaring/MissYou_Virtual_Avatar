import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Notice, Spinner, SupportList } from '../components/ui'
import { get, post } from '../lib/api'
import type { CallInfo, SupportResources } from '../lib/types'
import { useAuth } from '../store/auth'

const PROMPTS = ['What would you like to remember from this call?', 'Was there something you were glad you said?', 'How are you feeling right now — honestly?']

export default function AfterCall() {
  const { callId } = useParams()
  const user = useAuth((s) => s.user)
  const refresh = useAuth((s) => s.refresh)
  const [call, setCall] = useState<CallInfo | null>(null)
  const [support, setSupport] = useState<SupportResources | null>(null)
  const [text, setText] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const prompt = PROMPTS[(callId || '').charCodeAt(0) % PROMPTS.length]
  useEffect(() => {
    get<{ call: CallInfo }>(`/api/calls/${callId}`).then((r) => setCall(r.call)).catch(() => {})
    get<SupportResources>('/api/support').then(setSupport).catch(() => {})
    void refresh()
  }, [callId, refresh])
  if (!call) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={30} /></div>
  const name = call.person?.called_name || call.person?.name
  const askMood = (user?.prefs as Record<string, unknown>)?.mood_checkin !== false
  return (
    <div className="mx-auto max-w-xl space-y-5 py-4">
      <div className="text-center">
        <div className="mx-auto mb-4 h-24 w-24 overflow-hidden rounded-full opacity-90 ring-2 ring-ember-300/40">{call.scene?.still_url && <img src={call.scene.still_url} alt="" className="h-full w-full object-cover" />}</div>
        <h1 className="text-3xl">Take a breath.</h1>
        <p className="mt-2 text-cream-200/75">You spent {Math.max(1, Math.round(call.duration_s / 60))} minute{call.duration_s >= 120 ? 's' : ''} with {name}{call.scene ? ` at the ${call.scene.location_label.toLowerCase()}` : ''}. It's okay to feel whatever you feel.</p>
        {call.credits_charged > 0 && <p className="mt-1 text-xs text-cream-200/50">{call.credits_charged} credits used</p>}
      </div>
      {saved ? <Notice tone="ok">Kept, privately. Thank you for taking a moment.</Notice> : (
        <div className="card space-y-4">
          <label className="block"><span className="label">{prompt} (optional, private)</span><textarea className="input min-h-[110px] py-3" value={text} onChange={(e) => setText(e.target.value)} /></label>
          {askMood && (
            <fieldset><legend className="label">How do you feel now? (only you see this)</legend>
              <div className="flex gap-2">{['😔', '😕', '😐', '🙂', '😊'].map((e, i) => <button key={i} type="button" onClick={() => setMood(i + 1)} aria-pressed={mood === i + 1} aria-label={`Mood ${i + 1} of 5`} className={`h-12 flex-1 rounded-2xl text-2xl ring-1 ${mood === i + 1 ? 'bg-ember-500/20 ring-ember-400' : 'bg-white/5 ring-white/10'}`}>{e}</button>)}</div>
            </fieldset>
          )}
          <button className="btn-primary w-full" disabled={!text.trim() && !mood} onClick={async () => { await post(`/api/calls/${callId}/reflection`, { reflection: text, mood_after: mood }); setSaved(true) }}>Keep this</button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to={`/history/${callId}`} className="btn-ghost">Save a moment to your memory box</Link>
        <Link to="/home" className="btn-ghost">Back home</Link>
      </div>
      <details className="card">
        <summary className="cursor-pointer text-lg font-semibold">If today feels heavy</summary>
        <div className="mt-4"><SupportList res={support} /></div>
        <p className="mt-4 text-sm text-cream-200/70">Talking to someone who's here — a friend, family, a counsellor — can help in ways this can't.</p>
      </details>
    </div>
  )
}
