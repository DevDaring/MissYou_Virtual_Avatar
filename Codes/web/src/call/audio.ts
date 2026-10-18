// Call audio: reply playback with a loudness envelope (drives the talking loop),
// procedural ambient soundscapes, ringtone and chimes — all WebAudio, no assets.

type Ambient = 'birds' | 'river' | 'evening' | 'cafe' | 'waves' | 'wind' | 'home' | 'temple' | string

export class CallAudio {
  ctx: AudioContext
  master: GainNode
  voiceGain: GainNode
  ambientGain: GainNode
  analyser: AnalyserNode
  private el: HTMLAudioElement
  private queue: { url: string; seq: number }[] = []
  private playing = false
  private ambientNodes: AudioNode[] = []
  private timers: number[] = []
  private ringTimer: number | undefined
  onSpeakingChange?: (speaking: boolean) => void
  private buf = new Float32Array(512)

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    this.voiceGain = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.voiceGain.connect(this.analyser)
    this.analyser.connect(this.master)
    this.ambientGain = this.ctx.createGain()
    this.ambientGain.gain.value = 0.16
    this.ambientGain.connect(this.master)
    this.el = new Audio()
    this.el.crossOrigin = 'anonymous'
    this.el.preload = 'auto'
    this.ctx.createMediaElementSource(this.el).connect(this.voiceGain)
    this.el.onended = () => this.next()
    this.el.onerror = () => this.next()
  }

  get suspended() { return this.ctx.state === 'suspended' }
  async resume() { if (this.ctx.state === 'suspended') await this.ctx.resume() }
  setVolume(v: number) { this.master.gain.value = v }
  setAmbient(on: boolean, level = 0.16) { this.ambientGain.gain.setTargetAtTime(on ? level : 0, this.ctx.currentTime, 0.4) }

  /** 0..1 loudness of the reply voice right now. */
  envelope(): number {
    if (!this.playing) return 0
    this.analyser.getFloatTimeDomainData(this.buf)
    let s = 0
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i]
    return Math.min(1, Math.sqrt(s / this.buf.length) * 6)
  }

  enqueue(url: string, seq: number) {
    this.queue.push({ url, seq })
    this.queue.sort((a, b) => a.seq - b.seq)
    if (!this.playing) this.next()
  }
  stopVoice() { this.queue = []; this.el.pause(); this.setPlaying(false) }
  get isSpeaking() { return this.playing }

  private setPlaying(p: boolean) { if (p !== this.playing) { this.playing = p; this.onSpeakingChange?.(p) } }
  private next() {
    const item = this.queue.shift()
    if (!item) { this.setPlaying(false); return }
    this.setPlaying(true)
    this.el.src = item.url
    this.el.play().catch(() => this.next())
  }

  // ---------------------------------------------------------------- tones
  private tone(freq: number, start: number, dur: number, gain = 0.12, type: OscillatorType = 'sine') {
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(gain, start + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    o.connect(g).connect(this.master)
    o.start(start)
    o.stop(start + dur + 0.05)
  }
  startRing() {
    const ring = () => {
      const t = this.ctx.currentTime + 0.05
      this.tone(659, t, 0.9, 0.07); this.tone(784, t, 0.9, 0.05)
      this.tone(659, t + 1.1, 0.9, 0.07); this.tone(880, t + 1.1, 0.9, 0.04)
    }
    ring()
    this.ringTimer = window.setInterval(ring, 3200)
  }
  stopRing() { window.clearInterval(this.ringTimer) }
  chime() { const t = this.ctx.currentTime + 0.02; this.tone(523, t, 0.6, 0.06); this.tone(784, t + 0.12, 0.8, 0.05); this.tone(1047, t + 0.24, 1.0, 0.03) }
  endTone() { const t = this.ctx.currentTime + 0.02; this.tone(523, t, 0.35, 0.06); this.tone(392, t + 0.3, 0.6, 0.06) }

  // -------------------------------------------------------------- ambient
  private noise(kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
    const len = this.ctx.sampleRate * 4
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = b.getChannelData(0)
    let last = 0, b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'white') d[i] = w * 0.5
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 }
      else { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.5 }
    }
    const s = this.ctx.createBufferSource()
    s.buffer = b
    s.loop = true
    return s
  }
  private bed(kind: 'white' | 'pink' | 'brown', filter: BiquadFilterType, freq: number, gain: number, lfoRate = 0, lfoDepth = 0) {
    const n = this.noise(kind)
    const f = this.ctx.createBiquadFilter()
    f.type = filter; f.frequency.value = freq
    const g = this.ctx.createGain(); g.gain.value = gain
    n.connect(f).connect(g).connect(this.ambientGain)
    if (lfoRate) {
      const l = this.ctx.createOscillator(); const lg = this.ctx.createGain()
      l.frequency.value = lfoRate; lg.gain.value = lfoDepth
      l.connect(lg).connect(g.gain); l.start(); this.ambientNodes.push(l)
    }
    n.start()
    this.ambientNodes.push(n)
  }
  private chirps(rate: number, base: number) {
    const go = () => {
      const t = this.ctx.currentTime
      const n = 2 + Math.floor(Math.random() * 4)
      for (let i = 0; i < n; i++) {
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain()
        const st = t + i * (0.09 + Math.random() * 0.05)
        const f0 = base * (0.9 + Math.random() * 0.5)
        o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), st + 0.07)
        g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.05, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1)
        o.connect(g).connect(this.ambientGain); o.start(st); o.stop(st + 0.12)
      }
      this.timers.push(window.setTimeout(go, (rate * (0.5 + Math.random())) * 1000))
    }
    this.timers.push(window.setTimeout(go, 800))
  }
  private bells(every: number) {
    const go = () => { const t = this.ctx.currentTime; [1, 2.76, 5.4].forEach((m, i) => this.toneTo(this.ambientGain, 392 * m, t, 3.5, 0.05 / (i + 1))); this.timers.push(window.setTimeout(go, every * (0.7 + Math.random() * 0.6) * 1000)) }
    this.timers.push(window.setTimeout(go, 3000))
  }
  private toneTo(dest: AudioNode, freq: number, start: number, dur: number, gain: number) {
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain()
    o.frequency.value = freq; g.gain.setValueAtTime(gain, start); g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    o.connect(g).connect(dest); o.start(start); o.stop(start + dur)
  }
  startAmbient(kind: Ambient, rain = false) {
    this.stopAmbient()
    switch (kind) {
      case 'birds': this.bed('pink', 'lowpass', 900, 0.25, 0.08, 0.08); this.chirps(2.2, 3200); break
      case 'river': this.bed('brown', 'lowpass', 700, 0.9, 0.15, 0.2); this.bed('pink', 'bandpass', 2400, 0.12, 0.3, 0.05); this.chirps(7, 2600); break
      case 'waves': this.bed('brown', 'lowpass', 500, 1.1, 0.09, 0.8); this.bed('white', 'highpass', 4000, 0.05, 0.09, 0.04); break
      case 'wind': this.bed('pink', 'bandpass', 500, 0.6, 0.12, 0.4); break
      case 'cafe': this.bed('brown', 'bandpass', 300, 0.6); this.bed('pink', 'bandpass', 1200, 0.1, 0.5, 0.05); break
      case 'temple': this.bed('pink', 'lowpass', 600, 0.2); this.bells(14); break
      case 'evening': this.bed('pink', 'lowpass', 700, 0.25, 0.05, 0.05); this.chirps(5, 4200); break
      default: this.bed('brown', 'lowpass', 250, 0.35); break
    }
    if (rain) this.bed('white', 'bandpass', 2600, 0.18, 0.2, 0.05)
  }
  stopAmbient() {
    this.ambientNodes.forEach((n) => { try { (n as AudioScheduledSourceNode).stop() } catch { /* already stopped */ } })
    this.ambientNodes = []
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
  }
  close() { this.stopRing(); this.stopAmbient(); this.stopVoice(); void this.ctx.close() }
}
