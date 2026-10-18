import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AIBadge, Chip, Notice, Progress, Spinner } from './ui'
import { errorText, get, post, uploadFile } from '../lib/api'
import type { Person, Scene } from '../lib/types'
import { useJob } from '../setup/useJob'

interface Loc { key: string; label: string; emoji: string; gradient: [string, string]; description: string }
interface LocData { locations: Loc[]; activities: { key: string; label: string }[]; times: { key: string; label: string }[]; weather: { key: string; label: string }[]; outfits: string[]; cost_credits: number }

export default function SceneBuilder({ person, onReady }: { person: Person; onReady?: (s: Scene) => void }) {
  const locs = useQuery({ queryKey: ['locations'], queryFn: () => get<LocData>('/api/locations') })
  const [loc, setLoc] = useState('garden_lawn')
  const [activity, setActivity] = useState('sitting')
  const [time, setTime] = useState('golden_hour')
  const [weather, setWeather] = useState('clear')
  const [outfit, setOutfit] = useState('')
  const [place, setPlace] = useState<{ id: string; url: string } | null>(null)
  const [upl, setUpl] = useState<number | null>(null)
  const [scene, setScene] = useState<Scene | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { job, track, running } = useJob(async (j) => {
    const sid = (j.result?.scene_id as string) || scene?.id
    if (sid) { const r = await get<{ scene: Scene }>(`/api/scenes/${sid}`); setScene(r.scene); if (r.scene.status === 'ready') onReady?.(r.scene) }
  })
  useEffect(() => {
    if (!scene || scene.status === 'ready' || scene.status === 'failed' || running) return
    const t = window.setInterval(async () => { const r = await get<{ scene: Scene }>(`/api/scenes/${scene.id}`); setScene(r.scene); if (r.scene.status === 'ready') { onReady?.(r.scene); window.clearInterval(t) } }, 5000)
    return () => window.clearInterval(t)
  }, [scene, running, onReady])

  async function generate(regen = false) {
    setErr(null)
    try {
      const r = regen && scene ? await post<{ scene: Scene; job_id?: string }>(`/api/scenes/${scene.id}/regenerate`)
        : await post<{ scene: Scene; job_id?: string; cached?: boolean }>(`/api/people/${person.id}/scenes`, { location_key: loc, activity, time_of_day: time, weather, outfit, place_media_id: place?.id })
      setScene(r.scene)
      if (r.job_id) track(r.job_id)
      else if (r.scene.status === 'ready') onReady?.(r.scene)
    } catch (e) { setErr(errorText(e)) }
  }
  async function uploadPlace(f: File) {
    setUpl(0)
    try { const r = await uploadFile(person.id, f, setUpl, 'place_photo'); setPlace({ id: r.media.id, url: r.media.url }) } catch (e) { setErr(errorText(e)) } finally { setUpl(null) }
  }

  if (!locs.data) return <div className="flex justify-center py-10 text-ember-300"><Spinner size={28} /></div>
  const d = locs.data
  if (scene && (scene.status !== 'failed')) {
    const generating = scene.status !== 'ready'
    return (
      <div className="card space-y-4">
        <div className="flex items-center justify-between"><h3 className="text-xl">{scene.location_label}</h3><AIBadge /></div>
        {generating ? (
          <div className="space-y-4 py-4">
            <div className="mx-auto aspect-[9/16] w-48 animate-pulse rounded-3xl bg-gradient-to-b from-night-700 to-night-800" />
            <Progress value={job?.progress ?? scene.progress} label={job?.message || 'Preparing the scene…'} />
            <p className="text-center text-sm text-cream-200/70">This can take a couple of minutes. You can leave this page — we'll keep working.</p>
          </div>
        ) : (
          <>
            <div className="mx-auto w-full max-w-xs overflow-hidden rounded-[2rem] ring-1 ring-white/15">
              {scene.idle_url ? <video src={scene.idle_url} poster={scene.still_url || undefined} autoPlay loop muted playsInline className="aspect-[9/16] w-full object-cover" /> : scene.still_url && <img src={scene.still_url} alt="Scene preview (AI-generated)" className="aspect-[9/16] w-full object-cover" />}
            </div>
            {scene.notes?.map((n, i) => <Notice key={i} tone="warn">{n}</Notice>)}
            {scene.identity_score != null && <p className="text-center text-xs text-cream-200/60">Likeness check passed ({Math.round(scene.identity_score * 100)}% match to their photos).</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setScene(null)}>Another place</button>
              <button className="btn-ghost" onClick={() => generate(true)}>Regenerate · {d.cost_credits} credits</button>
            </div>
          </>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3 text-xl">Where would you like to find them?</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {d.locations.map((l) => (
            <button key={l.key} onClick={() => setLoc(l.key)} aria-pressed={loc === l.key} className={`relative flex min-h-[96px] flex-col justify-end overflow-hidden rounded-2xl p-3 text-left ring-2 transition ${loc === l.key ? 'ring-ember-400' : 'ring-transparent'}`} style={{ background: `linear-gradient(160deg, ${l.gradient[0]}, ${l.gradient[1]})` }}>
              <span className="absolute right-2 top-2 text-2xl" aria-hidden="true">{l.emoji}</span>
              <span className="font-semibold text-white drop-shadow">{l.label}</span>
              <span className="text-[11px] leading-tight text-white/85 drop-shadow">{l.description}</span>
            </button>
          ))}
        </div>
        {loc === 'old_home' && (
          <div className="mt-4">
            {place ? <div className="flex items-center gap-3"><img src={place.url} alt="Their home" className="h-20 w-20 rounded-xl object-cover" /><button className="btn-ghost" onClick={() => fileRef.current?.click()}>Change photo</button></div>
              : <button className="btn-ghost" onClick={() => fileRef.current?.click()}>{upl != null ? `Uploading ${upl}%` : 'Upload a photo of their home'}</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadPlace(e.target.files[0])} />
          </div>
        )}
      </div>
      <div className="card space-y-4">
        <div><div className="label">What are they doing?</div><div className="flex flex-wrap gap-2">{d.activities.map((a) => <Chip key={a.key} active={activity === a.key} onClick={() => setActivity(a.key)}>{a.label}</Chip>)}</div></div>
        <div><div className="label">Time of day</div><div className="flex flex-wrap gap-2">{d.times.map((a) => <Chip key={a.key} active={time === a.key} onClick={() => setTime(a.key)}>{a.label}</Chip>)}</div></div>
        <div><div className="label">Weather mood</div><div className="flex flex-wrap gap-2">{d.weather.map((a) => <Chip key={a.key} active={weather === a.key} onClick={() => setWeather(a.key)}>{a.label}</Chip>)}</div></div>
        <div><div className="label">What are they wearing? (optional)</div><div className="flex flex-wrap gap-2"><Chip active={!outfit} onClick={() => setOutfit('')}>As in their photos</Chip>{d.outfits.map((o) => <Chip key={o} active={outfit === o} onClick={() => setOutfit(o)}>{o}</Chip>)}</div></div>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {scene?.status === 'failed' && <Notice tone="error">The last attempt didn't work. Your credits were returned.</Notice>}
      <button className="btn-primary w-full sm:w-auto" disabled={loc === 'old_home' && !place} onClick={() => generate()}>Create this moment · {d.cost_credits} credits</button>
      <p className="text-xs text-cream-200/60">We make this once and reuse it for every call in this place, so you're only charged once.</p>
    </div>
  )
}
