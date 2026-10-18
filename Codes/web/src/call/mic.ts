// Microphone: push-to-talk and simple voice-activity detection (VAD).
// Audio never leaves the device except the finished utterance sent to the call.

export class Mic {
  stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private ctx: AudioContext | null = null
  private an: AnalyserNode | null = null
  private raf = 0
  private loud = 0
  private quiet = 0
  private startedAt = 0
  vad = false
  muted = false
  blocked = false // e.g. while they are speaking (half-duplex, avoids echo)
  onUtterance?: (b: Blob, mime: string, seconds: number) => void
  onLevel?: (v: number) => void
  onRecording?: (r: boolean) => void
  readonly maxSeconds = 28

  async open() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AC()
    this.an = this.ctx.createAnalyser()
    this.an.fftSize = 1024
    this.ctx.createMediaStreamSource(this.stream).connect(this.an)
    this.loop()
  }
  private mime() {
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MediaRecorder.isTypeSupported(m)) return m
    return ''
  }
  get recording() { return !!this.rec && this.rec.state === 'recording' }
  start() {
    if (!this.stream || this.recording || this.muted) return
    const mime = this.mime()
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined)
    this.chunks = []
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.onstop = () => {
      const secs = (performance.now() - this.startedAt) / 1000
      const type = this.rec?.mimeType || mime || 'audio/webm'
      this.onRecording?.(false)
      if (secs > 0.5 && this.chunks.length) this.onUtterance?.(new Blob(this.chunks, { type }), type, secs)
    }
    this.startedAt = performance.now()
    this.rec.start(250)
    this.onRecording?.(true)
  }
  stop() { if (this.recording) this.rec!.stop() }
  cancel() { if (this.recording) { this.chunks = []; this.rec!.onstop = () => this.onRecording?.(false); this.rec!.stop() } }
  private loop = () => {
    if (!this.an) return
    const buf = new Float32Array(this.an.fftSize)
    this.an.getFloatTimeDomainData(buf)
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    const rms = Math.sqrt(s / buf.length)
    this.onLevel?.(Math.min(1, rms * 8))
    if (this.vad && !this.muted && !this.blocked) {
      if (rms > 0.025) { this.loud++; this.quiet = 0 } else { this.quiet++; this.loud = Math.max(0, this.loud - 1) }
      if (!this.recording && this.loud > 8) this.start()
      if (this.recording && this.quiet > 55) this.stop() // ~0.9 s of quiet at 60fps
    }
    if (this.recording && (performance.now() - this.startedAt) / 1000 > this.maxSeconds) this.stop()
    this.raf = requestAnimationFrame(this.loop)
  }
  close() { cancelAnimationFrame(this.raf); this.cancel(); this.stream?.getTracks().forEach((t) => t.stop()); void this.ctx?.close() }
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(b) })
}
