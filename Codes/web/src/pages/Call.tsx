import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CallAudio } from '../call/audio'
import { blobToBase64, Mic } from '../call/mic'
import { AIBadge, Modal, Notice, Spinner, SupportList } from '../components/ui'
import { get, post } from '../lib/api'
import { t } from '../lib/i18n'
import type { CallInfo, SupportResources } from '../lib/types'
import { useAuth } from '../store/auth'

type Status = 'loading' | 'ringing' | 'active' | 'paused' | 'ended'
type Stage = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
interface Line { id: string; role: 'user' | 'assistant'; text: string; sub?: string }

export default function Call() {
  const { callId } = useParams()
  const nav = useNavigate()
  const user = useAuth((s) => s.user)
  const prefs = (user?.prefs || {}) as Record<string, unknown>
  const [call, setCall] = useState<CallInfo | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [stage, setStage] = useState<Stage>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [captions, setCaptions] = useState(prefs.captions === true)  // off by default so nothing covers their face
  const [ambientOn, setAmbientOn] = useState(prefs.ambient !== false)
  const [muted, setMuted] = useState(false)
  const [vad, setVad] = useState(false)
  const [volume, setVolume] = useState(1)
  const [showVol, setShowVol] = useState(false)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [crisis, setCrisis] = useState<{ message: string; resources: SupportResources } | null>(null)
  const [checkin, setCheckin] = useState<string | null>(null)
  const [report, setReport] = useState(false)
  const [reportText, setReportText] = useState('')
  const [needTap, setNeedTap] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [pip, setPip] = useState(!!prefs.pip_camera)
  const [level, setLevel] = useState(0)
  const lowBw = !!prefs.low_bandwidth

  const ws = useRef<WebSocket | null>(null)
  const audio = useRef<CallAudio | null>(null)
  const mic = useRef<Mic | null>(null)
  const idleRef = useRef<HTMLVideoElement>(null)
  const listenRef = useRef<HTMLVideoElement>(null)
  const talkRef = useRef<HTMLVideoElement>(null)
  const stillRef = useRef<HTMLImageElement>(null)
  const pipRef = useRef<HTMLVideoElement>(null)
  const connectedAt = useRef<number | null>(null)
  const stageRef = useRef<Stage>('idle')
  stageRef.current = stage
  const lang = call?.language || 'en'
  const name = call?.person?.called_name || call?.person?.name || ''
  const scene = call?.scene

  const send = useCallback((m: object) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m)) }, [])

  // ---------------------------------------------------------------- setup
  useEffect(() => {
    let alive = true
    const a = new CallAudio()
    audio.current = a
    a.onSpeakingChange = (sp) => { if (mic.current) mic.current.blocked = sp; if (!sp && stageRef.current === 'speaking') setStage('idle') }
    if (a.suspended) a.resume().catch(() => setNeedTap(true)).then(() => a.suspended && setNeedTap(true))
    get<{ call: CallInfo }>(`/api/calls/${callId}`).then((r) => {
      if (!alive) return
      setCall(r.call)
      if (r.call.status === 'ended') { nav(`/call/${callId}/after`, { replace: true }); return }
      setStatus('ringing')
      a.startRing()
      const amb = r.call.scene?.ambient || 'home'
      a.startAmbient(amb, r.call.scene?.weather === 'light_rain' || r.call.scene?.time_of_day === 'light_rain')
      a.setAmbient(prefs.ambient !== false)
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const sock = new WebSocket(`${proto}://${location.host}/api/calls/${callId}/ws`)
      ws.current = sock
      sock.onmessage = (ev) => onMessage(JSON.parse(ev.data))
      sock.onclose = () => { if (alive && connectedAt.current) setNotice('The line dropped. Reconnecting won’t lose anything — you can end and call again.') }
    }).catch(() => setNotice('This call could not be found.'))
    const m = new Mic()
    mic.current = m
    m.onLevel = (v) => setLevel(v)
    m.onRecording = (r) => setStage((s) => (r ? 'recording' : s === 'recording' ? 'transcribing' : s))
    m.onUtterance = async (blob, mime) => { setStage('transcribing'); send({ type: 'user_audio', data: await blobToBase64(blob), mime }) }
    m.open().catch(() => setMicError('Microphone access was blocked. You can still type to them.'))
    const ping = window.setInterval(() => send({ type: 'ping' }), 20000)
    return () => { alive = false; window.clearInterval(ping); ws.current?.close(); a.close(); m.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId])

  // ------------------------------------------------------------- messages
  const onMessage = (m: Record<string, unknown>) => {
    const a = audio.current!
    switch (m.type) {
      case 'state':
        if (m.status === 'active') {
          if (!connectedAt.current) { a.stopRing(); a.chime(); connectedAt.current = Date.now() }
          setStatus('active')
        } else if (m.status === 'ringing') setStatus('ringing')
        break
      case 'checkin': setCheckin(String(m.message)); break
      case 'stage': setStage((m.stage as Stage) === 'idle' && a.isSpeaking ? 'speaking' : (m.stage as Stage)); break
      case 'user_transcript': setLines((l) => [...l.slice(-6), { id: String(m.turn_id), role: 'user', text: String(m.text) }]); break
      case 'reply_text': setLines((l) => [...l.slice(-6), { id: String(m.turn_id), role: 'assistant', text: String(m.text) }]); break
      case 'subtitle': setLines((l) => l.map((x) => (x.id === m.turn_id ? { ...x, sub: String(m.text) } : x))); break
      case 'reply_audio':
        if (m.url) { a.enqueue(String(m.url), Number(m.seq)); setStage('speaking') }
        else if (m.error) setNotice('Their voice is unavailable right now — showing their words instead.')
        break
      case 'crisis': a.stopVoice(); setStatus('paused'); setCrisis({ message: String(m.message), resources: m.resources as SupportResources }); break
      case 'blocked': break
      case 'time_warning': setNotice(`About a minute left in this call. ${name} will say goodbye soon.`); break
      case 'goodbye': setNotice(null); break
      case 'error': setNotice(String(m.message)); setStage('idle'); break
      case 'busy': setStage('idle'); setNotice('One moment — the call is still connecting.'); break
      case 'queued': setNotice(`${name || 'They'} will answer that next.`); break
      case 'ended': {
        a.stopRing()
        const wait = () => (a.isSpeaking ? window.setTimeout(wait, 400) : (a.endTone(), window.setTimeout(() => nav(`/call/${callId}/after`, { replace: true }), 900)))
        setStatus('ended'); wait(); break
      }
    }
  }

  // ------------------------------------------- video layers driven by state
  useEffect(() => {
    let raf = 0
    let smooth = 0
    const tick = () => {
      const env = audio.current?.envelope() || 0
      smooth = smooth * 0.75 + env * 0.25
      const speaking = audio.current?.isSpeaking
      const talkOp = speaking ? Math.min(1, 0.35 + smooth * 1.6) : 0
      const listenOp = !speaking && (stageRef.current === 'recording' || stageRef.current === 'transcribing' || stageRef.current === 'thinking') ? 1 : 0
      if (talkRef.current) talkRef.current.style.opacity = String(talkOp)
      if (listenRef.current) listenRef.current.style.opacity = String(listenOp)
      if (stillRef.current) stillRef.current.style.transform = `scale(${1.04 + smooth * 0.012}) translateY(${-smooth * 2}px)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => { if (talkRef.current) { if (stage === 'speaking') void talkRef.current.play().catch(() => {}); } }, [stage])
  useEffect(() => { const i = window.setInterval(() => connectedAt.current && setElapsed(Math.floor((Date.now() - connectedAt.current) / 1000)), 1000); return () => window.clearInterval(i) }, [])
  useEffect(() => { audio.current?.setVolume(volume) }, [volume])
  useEffect(() => { audio.current?.setAmbient(ambientOn) }, [ambientOn])
  useEffect(() => { if (mic.current) { mic.current.muted = muted; if (muted) mic.current.cancel() } }, [muted])
  useEffect(() => { if (mic.current) mic.current.vad = vad && status === 'active' }, [vad, status])
  useEffect(() => {
    if (!pip) { (pipRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop()); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 240, height: 320 } }).then((s) => { if (pipRef.current) pipRef.current.srcObject = s }).catch(() => setPip(false))
  }, [pip])

  const canTalk = status === 'active' && !muted && stage !== 'transcribing' && stage !== 'thinking' && !audio.current?.isSpeaking
  const end = () => { send({ type: 'end' }); setNotice(`Saying goodbye…`) }
  const endNow = () => { send({ type: 'end', now: true }) }
  const sendText = () => { if (!text.trim()) return; send({ type: 'user_text', text }); setText(''); setStage('thinking') }
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const remaining = call ? call.soft_limit_s - elapsed : 0
  const stageLabel = stage === 'recording' ? t(lang, 'listening') : stage === 'transcribing' || stage === 'thinking' ? t(lang, 'thinking') : ''

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white" style={{ height: '100dvh' }}>
      {/* Their "front camera": full-screen on phones; on wide screens a centred 9:16 phone frame
          over a blurred fill, so the portrait video is never zoomed and cropped. */}
      <div className="absolute inset-0 overflow-hidden bg-black">
        {scene?.still_url && <img src={scene.still_url} alt="" aria-hidden="true" className="absolute inset-0 hidden h-full w-full scale-110 object-cover opacity-45 blur-2xl sm:block" />}
        <div className="absolute inset-0 overflow-hidden sm:inset-y-0 sm:left-1/2 sm:right-auto sm:aspect-[9/16] sm:max-w-full sm:-translate-x-1/2 sm:shadow-[0_0_80px_rgba(0,0,0,0.6)]">
          {scene?.still_url && <img ref={stillRef} src={scene.still_url} alt={`${name} — AI recreation`} className={`absolute inset-0 h-full w-full object-cover transition-transform duration-100 ${lowBw ? 'animate-[sway_8s_ease-in-out_infinite]' : ''}`} />}
          {!lowBw && scene?.idle_url && <video ref={idleRef} src={scene.idle_url} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />}
          {!lowBw && scene?.listening_url && <video ref={listenRef} src={scene.listening_url} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500" aria-hidden="true" />}
          {!lowBw && scene?.talking_url && <video ref={talkRef} src={scene.talking_url} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-150" aria-hidden="true" />}
        </div>
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      </div>

      {/* Ringing */}
      {(status === 'ringing' || status === 'loading') && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-night-950/70 backdrop-blur-xl">
          <div className="relative mb-6">
            {[0, 1, 2].map((i) => <span key={i} className="absolute inset-0 animate-ping rounded-full ring-2 ring-ember-300/40" style={{ animationDelay: `${i * 0.6}s`, animationDuration: '2.4s' }} />)}
            <div className="h-32 w-32 overflow-hidden rounded-full ring-4 ring-ember-300/50">{scene?.still_url && <img src={scene.still_url} alt="" className="h-full w-full object-cover" />}</div>
          </div>
          <div className="text-sm uppercase tracking-[0.3em] text-cream-200/70">{t(lang, 'ringing')}</div>
          <div className="mt-2 font-serif text-4xl">{name || '…'}</div>
          <AIBadge className="mt-3" label={t(lang, 'aiBadge')} />
          <div className="mt-2 text-sm text-cream-200/60">{call?.scene?.location_label} · {t(lang, 'connecting')}</div>
          {needTap && <button className="btn-primary mt-8" onClick={async () => { await audio.current?.resume(); setNeedTap(false) }}>Tap to turn on sound</button>}
          <button className="mt-10 flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-2xl shadow-lg" aria-label="Cancel call" onClick={endNow}>✕</button>
        </div>
      )}

      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:inset-x-auto sm:left-1/2 sm:w-[calc(100dvh*9/16)] sm:max-w-full sm:-translate-x-1/2">
        <div>
          <div className="font-serif text-2xl drop-shadow">{name}</div>
          {call?.caller && <div className="text-xs text-white/75 drop-shadow">talking with {call.caller.name}</div>}
          <div className="mt-1 flex items-center gap-2 text-sm text-white/80">
            <AIBadge label={t(lang, 'aiBadge')} />
            <span aria-live="off">{status === 'active' ? mmss : status === 'paused' ? 'Paused' : ''}</span>
            {status === 'active' && remaining < 120 && remaining > 0 && <span className="text-ember-300">· {Math.ceil(remaining / 60)} min left</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {pip && <video ref={pipRef} autoPlay muted playsInline className="h-36 w-24 rounded-2xl object-cover ring-2 ring-white/30 [transform:scaleX(-1)]" aria-label="Your camera (stays on your device)" />}
          <button className="rounded-full bg-black/40 px-3 py-2 text-xs font-semibold backdrop-blur" onClick={() => setReport(true)} aria-label={t(lang, 'report')}>⚑ {t(lang, 'report')}</button>
          <button className={`rounded-full px-3 py-1.5 text-xs font-bold tracking-wide backdrop-blur ring-1 ${captions ? 'bg-white/85 text-black ring-white' : 'bg-black/40 text-white/80 ring-white/30'}`}
            onClick={() => setCaptions(!captions)} aria-pressed={captions} aria-label={t(lang, 'captions')} title={t(lang, 'captions')}>CC</button>
        </div>
      </header>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {/* Captions: small, low (just above the talk button) and only the latest line, so the face stays clear */}
        <div className="mb-2 space-y-1.5 px-5" aria-live="polite">
          {notice && <div className="mx-auto max-w-md rounded-2xl bg-black/55 px-4 py-2 text-center text-sm backdrop-blur">{notice}</div>}
          {captions && !showVol && lines.slice(-1).map((l) => (
            <div key={l.id + l.role} className={`mx-auto max-w-sm rounded-xl px-3 py-1.5 text-center text-xs leading-snug backdrop-blur ${l.role === 'assistant' ? 'bg-black/50 text-white/90' : 'bg-black/30 text-white/70'}`}>
              <p className="line-clamp-2">{l.role === 'user' && <span className="mr-1 text-[10px] uppercase tracking-wide text-white/50">You</span>}{l.text}</p>
              {l.sub && <p className="mt-0.5 line-clamp-2 text-[11px] text-white/60">{l.sub}</p>}
            </div>
          ))}
          {stageLabel && <div className="text-center text-sm text-white/70"><span className="inline-flex items-center gap-2">{stage !== 'recording' && <Spinner size={14} />}{stageLabel}</span></div>}
        </div>

        {micError && <div className="mx-4 mb-2"><Notice tone="warn">{micError}</Notice></div>}
        {typing ? (
          <form className="mx-4 mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); sendText() }}>
            <input autoFocus className="input bg-black/50" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Say something to ${name}…`} disabled={status !== 'active'} aria-label="Message" />
            <button className="btn-primary shrink-0" disabled={!text.trim() || status !== 'active' || stage === 'thinking'}>Send</button>
          </form>
        ) : (
          <div className="mb-4 flex justify-center">
            {vad ? (
              <div className={`flex h-20 w-20 items-center justify-center rounded-full ring-4 transition ${stage === 'recording' ? 'bg-ember-500 ring-ember-300' : 'bg-white/15 ring-white/20'}`} style={{ boxShadow: `0 0 ${10 + level * 50}px rgba(247,176,124,${0.2 + level})` }} aria-label="Hands-free listening">🎙️</div>
            ) : (
              <button
                className={`flex h-20 w-20 select-none items-center justify-center rounded-full text-3xl ring-4 transition active:scale-95 ${stage === 'recording' ? 'bg-ember-500 ring-ember-300' : 'bg-white/15 ring-white/25'} disabled:opacity-40`}
                style={stage === 'recording' ? { boxShadow: `0 0 ${12 + level * 60}px rgba(247,176,124,${0.3 + level})` } : undefined}
                disabled={!canTalk && stage !== 'recording'}
                onPointerDown={(e) => { e.preventDefault(); if (canTalk) mic.current?.start() }}
                onPointerUp={() => mic.current?.stop()} onPointerLeave={() => mic.current?.recording && mic.current.stop()}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={t(lang, 'hold')}>🎙️</button>
            )}
          </div>
        )}
        <div className="text-center text-xs text-white/60">{typing ? '' : vad ? 'Hands-free: just talk' : t(lang, 'hold')}</div>
        <div className="mx-auto mt-3 flex max-w-md items-center justify-around px-4">
          <CtlBtn label={muted ? t(lang, 'unmute') : t(lang, 'mute')} active={muted} onClick={() => setMuted(!muted)} icon={muted ? '🔇' : '🎤'} />
          <CtlBtn label={vad ? 'Push-to-talk' : 'Hands-free'} active={vad} onClick={() => setVad(!vad)} icon={vad ? '🖐️' : '🗣️'} />
          <button className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-2xl shadow-lg ring-4 ring-red-500/30" onClick={end} onDoubleClick={endNow} aria-label={t(lang, 'end')}>📞</button>
          <CtlBtn label={t(lang, 'type')} active={typing} onClick={() => setTyping(!typing)} icon="⌨️" />
          <CtlBtn label="More" active={showVol} onClick={() => setShowVol(!showVol)} icon="⋯" />
        </div>
        {showVol && (
          <div className="mx-auto mt-3 max-w-md space-y-3 rounded-3xl bg-black/60 p-4 backdrop-blur">
            <label className="flex items-center gap-3 text-sm">🔊 Volume<input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="flex-1 accent-ember-400" /></label>
            <div className="flex flex-wrap gap-2">
              <Toggle on={captions} set={setCaptions} label={t(lang, 'captions')} />
              <Toggle on={ambientOn} set={setAmbientOn} label="Ambient sound" />
              <Toggle on={pip} set={setPip} label="My camera (local only)" />
            </div>
            <p className="text-xs text-white/60">Lip movement is approximate on this server: a talking animation timed to their voice.</p>
          </div>
        )}
      </div>

      {/* Crisis */}
      {crisis && (
        <div className="absolute inset-0 z-30 overflow-y-auto bg-night-950/95 p-5 backdrop-blur-xl">
          <div className="mx-auto max-w-md space-y-5 py-8">
            <h2 className="font-serif text-3xl text-cream-50">{crisis.resources?.title || 'You matter'}</h2>
            <p className="text-lg leading-relaxed text-cream-100/90">{crisis.message}</p>
            <SupportList res={crisis.resources} />
            <div className="flex gap-3 pt-2">
              <button className="btn-ghost flex-1" onClick={() => { setCrisis(null); send({ type: 'resume' }); setStatus('active') }}>Continue the call</button>
              <button className="btn-danger flex-1" onClick={endNow}>End the call</button>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!checkin} onClose={() => setCheckin(null)} title="A gentle check-in">
        <p className="text-cream-100/90">{checkin}</p>
        <div className="mt-4 flex gap-2"><button className="btn-primary flex-1" onClick={() => setCheckin(null)}>Thank you</button><button className="btn-ghost flex-1" onClick={endNow}>Maybe later</button></div>
      </Modal>
      <Modal open={report} onClose={() => setReport(false)} title="Something felt wrong?">
        <p className="mb-3 text-cream-200/80">Tell us what happened. A person will review it. We only look at what you write here.</p>
        <textarea className="input min-h-[100px] py-3" value={reportText} onChange={(e) => setReportText(e.target.value)} placeholder="What felt wrong?" />
        <button className="btn-primary mt-3 w-full" onClick={async () => { await post(`/api/calls/${callId}/report`, { reason: 'felt_wrong', details: reportText }); setReport(false); setReportText(''); setNotice('Thank you for telling us.') }}>Send report</button>
      </Modal>
      <style>{`@keyframes sway{0%,100%{transform:scale(1.05) translate(0,0) rotate(0)}50%{transform:scale(1.06) translate(-4px,2px) rotate(-.4deg)}}`}</style>
    </div>
  )
}

function CtlBtn({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} aria-label={label} className="flex w-16 flex-col items-center gap-1 text-[11px] text-white/80">
      <span className={`flex h-12 w-12 items-center justify-center rounded-full text-xl backdrop-blur ${active ? 'bg-white text-night-900' : 'bg-white/15'}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return <button onClick={() => set(!on)} aria-pressed={on} className={`min-h-[40px] rounded-full px-3 text-sm font-semibold ${on ? 'bg-white text-night-900' : 'bg-white/15'}`}>{label}</button>
}
