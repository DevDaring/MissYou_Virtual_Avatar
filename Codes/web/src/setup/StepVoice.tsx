import { useCallback, useEffect, useState } from 'react'
import { Chip, Notice, Progress, Spinner } from '../components/ui'
import { errorText, get, post } from '../lib/api'
import type { Job, Person, Voice } from '../lib/types'
import { useJob } from './useJob'

interface Clip { id: string; url: string; duration: number; transcript: string; confirmed: boolean }
interface Preset { id: string; label: string; gender: string; engine: string }

export default function StepVoice({ person, onNext, onBack }: { person: Person; onNext: () => void; onBack: () => void }) {
  const [speakers, setSpeakers] = useState<{ label: number; clips: Clip[] }[] | null>(null)
  const [confirmed, setConfirmed] = useState<string[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [selected, setSelected] = useState<string | null>(person.voice_profile_id)
  const [engines, setEngines] = useState<{ engine: string; available: boolean; supports_language: boolean }[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [designOk, setDesignOk] = useState(false)
  const [gender, setGender] = useState(person.gender?.startsWith('m') ? 'm' : person.gender?.startsWith('f') ? 'f' : '')
  const [age, setAge] = useState(person.age && person.age > 55 ? 'elder' : person.age && person.age > 30 ? 'middle' : '')
  const [audition, setAudition] = useState<Record<string, string>>({})
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [analysing, setAnalysing] = useState(false)

  const loadVoices = useCallback(async () => {
    const r = await get<{ voices: Voice[]; selected: string | null; clone_engines: typeof engines }>(`/api/people/${person.id}/voices`)
    setVoices(r.voices); setSelected(r.selected); setEngines(r.clone_engines)
  }, [person.id])
  const loadClips = useCallback(async () => {
    const r = await get<{ speakers: { label: number; clips: Clip[] }[] }>(`/api/people/${person.id}/clips`)
    setSpeakers(r.speakers); setConfirmed(r.speakers.flatMap((s) => s.clips.filter((c) => c.confirmed).map((c) => c.id)))
  }, [person.id])
  const build = useJob(async (j) => { if (j.status === 'done') await loadVoices() })
  const analysis = useJob(async () => { setAnalysing(false); await loadClips() })

  useEffect(() => {
    void loadClips(); void loadVoices()
    get<{ jobs: Job[] }>(`/api/jobs?person_id=${person.id}`).then((r) => {
      const a = r.jobs.find((j) => j.kind === 'analyze_voices' && (j.status === 'queued' || j.status === 'running'))
      if (a) { setAnalysing(true); analysis.track(a.id) }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id])
  useEffect(() => {
    get<{ presets: Preset[]; design_available: boolean }>(`/api/voices/presets?language=${person.call_language}&gender=${gender}&age=${age}`).then((r) => { setPresets(r.presets); setDesignOk(r.design_available) }).catch(() => {})
  }, [person.call_language, gender, age])

  async function buildVoice(engine?: string) {
    setErr(null)
    try {
      await post(`/api/people/${person.id}/clips/confirm`, { clip_ids: confirmed })
      const r = await post<{ job_id: string }>(`/api/people/${person.id}/voice/build`, { engine: engine || null })
      build.track(r.job_id)
    } catch (e) { setErr(errorText(e)) }
  }
  async function select(v: Voice) { await post(`/api/people/${person.id}/voices/${v.id}/select`); setSelected(v.id) }
  async function rate(v: Voice, n: number) { await post(`/api/people/${person.id}/voices/${v.id}/rate`, { rating: n }); setVoices((vs) => vs.map((x) => (x.id === v.id ? { ...x, rating: n } : x))) }
  async function listen(p: Preset) {
    setBusy(p.id)
    try { const r = await post<{ url: string }>(`/api/people/${person.id}/voices/audition`, { preset_id: p.id }); setAudition((a) => ({ ...a, [p.id]: r.url })); new Audio(r.url).play().catch(() => {}) } catch (e) { setErr(errorText(e)) } finally { setBusy(null) }
  }
  async function choosePreset(p: Preset) {
    setBusy(p.id)
    try { const r = await post<{ voice: Voice }>(`/api/people/${person.id}/voices/preset`, { preset_id: p.id }); await loadVoices(); setSelected(r.voice.id) } catch (e) { setErr(errorText(e)) } finally { setBusy(null) }
  }
  async function design() {
    setBusy('design')
    try { const r = await post<{ voice: Voice }>(`/api/people/${person.id}/voices/design`, { description: desc, gender: gender || 'f' }); await loadVoices(); if (r.voice.preview_url) new Audio(r.voice.preview_url).play().catch(() => {}) } catch (e) { setErr(errorText(e)) } finally { setBusy(null) }
  }

  const hasClips = !!speakers?.some((s) => s.clips.length)
  const usedEngines = new Set(voices.filter((v) => v.kind === 'clone').map((v) => v.engine))
  const otherEngines = engines.filter((e) => e.available && e.supports_language && !usedEngines.has(e.engine))
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-2xl">Their voice</h2>
        <p className="mt-1 text-cream-200/75">We never match a voice to a face on our own — please listen and tell us which clips are really {person.called_name || person.name}.</p>
      </div>

      {analysing && <div className="card"><Progress value={analysis.job?.progress || 5} label={analysis.job?.message || 'Listening for voices in your videos…'} /></div>}

      {hasClips && (
        <section className="card space-y-4" aria-labelledby="clips-h">
          <h3 id="clips-h" className="text-xl">Is this their voice?</h3>
          {speakers!.map((s) => (
            <div key={s.label} className="rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
              <div className="mb-2 flex items-center justify-between"><span className="font-semibold">Voice {s.label + 1}</span>
                <button className="text-sm font-semibold text-ember-300" onClick={() => { const ids = s.clips.map((c) => c.id); const all = ids.every((i) => confirmed.includes(i)); setConfirmed((cf) => (all ? cf.filter((x) => !ids.includes(x)) : [...new Set([...cf, ...ids])])) }}>Select all</button></div>
              <div className="space-y-2">
                {s.clips.map((c) => (
                  <label key={c.id} className="flex items-center gap-3">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-ember-500" checked={confirmed.includes(c.id)} onChange={(e) => setConfirmed((cf) => (e.target.checked ? [...cf, c.id] : cf.filter((x) => x !== c.id)))} aria-label={`This clip is their voice: ${c.transcript || 'clip'}`} />
                    <audio src={c.url} controls preload="none" className="h-10 w-40 shrink-0 sm:w-56" />
                    <span className="line-clamp-2 text-sm text-cream-200/80">{c.transcript ? `“${c.transcript}”` : `${c.duration}s`}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {build.job && <div className="space-y-2"><Progress value={build.job.progress} label={build.job.message} />{build.job.status === 'failed' && <Notice tone="error">{build.job.message}</Notice>}</div>}
          <button className="btn-primary" disabled={!confirmed.length || build.running} onClick={() => buildVoice()}>{build.running ? <><Spinner /> Learning their voice…</> : 'Build their voice · 20 credits'}</button>
        </section>
      )}

      {voices.length > 0 && (
        <section className="card space-y-3" aria-labelledby="v-h">
          <h3 id="v-h" className="text-xl">Listen and choose</h3>
          {voices.map((v) => (
            <div key={v.id} className={`rounded-2xl p-3 ring-1 ${selected === v.id ? 'bg-ember-500/10 ring-ember-400/60' : 'bg-night-950/40 ring-white/10'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-semibold">{v.label}</div><div className="text-xs text-cream-200/60">{v.kind} · {v.engine}</div></div>
                <button className={selected === v.id ? 'btn-primary min-h-[44px] text-sm' : 'btn-ghost min-h-[44px] text-sm'} onClick={() => select(v)}>{selected === v.id ? '✓ Selected' : 'Use this voice'}</button>
              </div>
              {v.preview_url && <audio src={v.preview_url} controls preload="none" className="mt-2 w-full" />}
              <div className="mt-2 flex items-center gap-1" role="group" aria-label="Rate this voice">
                {[1, 2, 3, 4, 5].map((n) => <button key={n} className={`h-10 w-10 rounded-full text-lg ${v.rating && v.rating >= n ? 'text-ember-400' : 'text-cream-200/30'}`} onClick={() => rate(v, n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>)}
              </div>
            </div>
          ))}
          {hasClips && otherEngines.length > 0 && <div className="flex flex-wrap gap-2">{otherEngines.map((e) => <button key={e.engine} className="btn-ghost min-h-[44px] text-sm" disabled={build.running} onClick={() => buildVoice(e.engine)}>Try another engine: {({ fish: 'Fish Audio', voicebox: 'Voicebox (local)', sarvam_clone: 'Sarvam' } as Record<string, string>)[e.engine] || e.engine}</button>)}</div>}
        </section>
      )}

      <section className="card space-y-3" aria-labelledby="p-h">
        <h3 id="p-h" className="text-xl">{hasClips ? 'Or choose a gentle preset voice' : 'No voice recordings? Choose a voice that feels close'}</h3>
        <div className="flex flex-wrap gap-2">
          {[['', 'Any'], ['f', 'Female'], ['m', 'Male']].map(([v, l]) => <Chip key={v} active={gender === v} onClick={() => setGender(v)}>{l}</Chip>)}
          <span className="mx-1 w-px bg-white/10" />
          {[['', 'Any age'], ['young', 'Younger'], ['middle', 'Middle-aged'], ['elder', 'Older']].map(([v, l]) => <Chip key={v} active={age === v} onClick={() => setAge(v)}>{l}</Chip>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.slice(0, 5).map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
              <span className="text-sm font-semibold">{p.label}</span>
              <div className="flex gap-1">
                <button className="btn-ghost min-h-[44px] px-3 text-sm" onClick={() => (audition[p.id] ? new Audio(audition[p.id]).play() : listen(p))} disabled={busy === p.id}>{busy === p.id ? <Spinner size={16} /> : '▶ Listen'}</button>
                <button className="btn-ghost min-h-[44px] px-3 text-sm" onClick={() => choosePreset(p)} disabled={busy === p.id}>Use</button>
              </div>
            </div>
          ))}
        </div>
        {designOk && (
          <div className="rounded-2xl bg-night-950/40 p-3 ring-1 ring-white/10">
            <label className="label" htmlFor="desc">Or describe their voice</label>
            <div className="flex flex-col gap-2 sm:flex-row"><input id="desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Soft, slightly husky, slow, with a smile in it" /><button className="btn-ghost shrink-0" disabled={desc.length < 5 || busy === 'design'} onClick={design}>{busy === 'design' ? <Spinner /> : 'Create'}</button></div>
          </div>
        )}
      </section>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex gap-3"><button className="btn-ghost" onClick={onBack}>Back</button><button className="btn-primary flex-1 sm:flex-none" disabled={!selected} onClick={onNext}>Continue</button></div>
    </div>
  )
}
