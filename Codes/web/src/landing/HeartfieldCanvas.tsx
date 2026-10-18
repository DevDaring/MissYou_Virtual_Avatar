import { useEffect, useRef, type RefObject } from 'react'
import { FLAME_CORE_PATH, FLAME_PATH, HEART_LEFT_PATH, HEART_RIGHT_PATH } from '../components/Logo'

/**
 * Twilight "heartfield": slow fireflies drift through the sky, then gather
 * into the Miss You mark (two crescents + a diya flame). Once formed, the
 * heart beats softly and releases a ring like an incoming call.
 *
 * Performance notes: particle count is capped by area and devicePixelRatio,
 * glow is pre-rendered into sprites (no per-frame shadowBlur), the loop
 * pauses when the tab is hidden or the hero is off-screen, and with
 * prefers-reduced-motion a single static frame is drawn.
 */

type Kind = 0 | 1 | 2 // left crescent, right crescent, flame
type Target = { x: number; y: number; kind: Kind }

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  bvx: number
  bvy: number
  z: number // depth 0.35..1, used for parallax and size
  size: number
  sprite: number
  tw: number
  twSpeed: number
  target: number // index into targets, -1 = ambient firefly
  delay: number
  dur: number
  curve: number
  sx: number
  sy: number
  started: boolean
  ox: number
  oy: number
}

type Ring = { born: number; strength: number }
type Ember = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; sprite: number }

const SPRITE_COLORS: [number, number, number][] = [
  [247, 176, 124], // ember-400
  [241, 155, 176], // rose-400
  [255, 243, 224], // warm cream
  [179, 162, 238], // dusk-400
]

const FORM_START = 450
const BEAT_PERIOD = 2800

function makeSprite(rgb: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const S = 64
  c.width = c.height = S
  const g = c.getContext('2d')!
  const [r, gg, b] = rgb
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grad.addColorStop(0, 'rgba(255,252,246,1)')
  grad.addColorStop(0.12, `rgba(${r},${gg},${b},0.95)`)
  grad.addColorStop(0.32, `rgba(${r},${gg},${b},0.35)`)
  grad.addColorStop(0.62, `rgba(${r},${gg},${b},0.08)`)
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  return c
}

/** Sample evenly spaced points inside the logo shapes (64-unit space, centred). */
function sampleLogoTargets(count: number): Target[] {
  const R = 256
  const k = R / 64
  const c = document.createElement('canvas')
  c.width = c.height = R
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.scale(k, k)
  g.fillStyle = '#ff0000'
  g.fill(new Path2D(HEART_LEFT_PATH))
  g.fillStyle = '#00ff00'
  g.fill(new Path2D(HEART_RIGHT_PATH))
  g.fillStyle = '#0000ff'
  g.fill(new Path2D(FLAME_PATH))
  const data = g.getImageData(0, 0, R, R).data
  const cands: Target[] = []
  for (let y = 0; y < R; y += 2) {
    for (let x = 0; x < R; x += 2) {
      const i = (y * R + x) * 4
      const kind: Kind | -1 = data[i] > 200 ? 0 : data[i + 1] > 200 ? 1 : data[i + 2] > 200 ? 2 : -1
      if (kind === -1) continue
      cands.push({ x: x / k - 32, y: y / k - 30.5, kind })
    }
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cands[i], cands[j]] = [cands[j], cands[i]]
  }
  // Dart throwing with a shrinking radius gives an even, organic spread.
  const pick = (pool: Target[], n: number, startDist: number) => {
    const out: Target[] = []
    let d = startDist
    while (out.length < n && d > 0.3) {
      for (const p of pool) {
        if (out.length >= n) break
        let ok = true
        for (const q of out) {
          const dx = p.x - q.x
          const dy = p.y - q.y
          if (dx * dx + dy * dy < d * d) {
            ok = false
            break
          }
        }
        if (ok) out.push(p)
      }
      d *= 0.82
    }
    return out
  }
  // The flame is not built from sparks: it is lit once the heart has formed.
  return pick(cands.filter((t) => t.kind !== 2), count, 3.2)
}

function renderHeartImage(s: number, dpr: number): HTMLCanvasElement {
  // Logo drawn at s px (for 64 units) with a soft pre-baked glow.
  const pad = s * 0.35
  const c = document.createElement('canvas')
  const size = s + pad * 2
  c.width = c.height = Math.ceil(size * dpr)
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  g.translate(pad, pad)
  const k = s / 64
  g.scale(k, k)
  const grad = g.createLinearGradient(10, 12, 54, 52)
  grad.addColorStop(0, '#fbd0a6')
  grad.addColorStop(0.45, '#f0925f')
  grad.addColorStop(1, '#f19bb0')
  g.shadowColor = 'rgba(240,146,95,0.85)'
  g.shadowBlur = 14 * k * dpr
  g.fillStyle = grad
  g.fill(new Path2D(HEART_LEFT_PATH))
  g.fill(new Path2D(HEART_RIGHT_PATH))
  g.shadowBlur = 0
  g.fill(new Path2D(HEART_LEFT_PATH))
  g.fill(new Path2D(HEART_RIGHT_PATH))
  return c
}

function renderFlameImage(s: number, dpr: number): HTMLCanvasElement {
  const pad = s * 0.35
  const c = document.createElement('canvas')
  const size = s + pad * 2
  c.width = c.height = Math.ceil(size * dpr)
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  g.translate(pad, pad)
  const k = s / 64
  g.scale(k, k)
  const halo = g.createRadialGradient(32, 32.5, 0, 32, 32.5, 15)
  halo.addColorStop(0, 'rgba(247,176,124,0.55)')
  halo.addColorStop(1, 'rgba(247,176,124,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, 64, 64)
  const fl = g.createLinearGradient(32, 20, 32, 38)
  fl.addColorStop(0, '#f0925f')
  fl.addColorStop(0.5, '#f7b07c')
  fl.addColorStop(1, '#fbd0a6')
  g.shadowColor = 'rgba(247,176,124,0.8)'
  g.shadowBlur = 5 * k * dpr
  g.fillStyle = fl
  g.fill(new Path2D(FLAME_PATH))
  g.shadowBlur = 0
  g.fillStyle = '#fff9f1'
  g.fill(new Path2D(FLAME_CORE_PATH))
  return c
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const smooth = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a), 0, 1)
  return x * x * (3 - 2 * x)
}
const bump = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (2 * w * w))

export function HeartfieldCanvas({
  anchorRef,
  className,
}: {
  anchorRef: RefObject<HTMLElement>
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const starsCanvas = starsRef.current
    if (!canvas || !starsCanvas) return
    const ctx = canvas.getContext('2d')
    const sctx = starsCanvas.getContext('2d')
    if (!ctx || !sctx) return

    const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = reducedMq.matches
    const sprites = SPRITE_COLORS.map(makeSprite)

    let W = 0
    let H = 0
    let dpr = 1
    let heart = { cx: 0, cy: 0, s: 0 }
    let heartImg: HTMLCanvasElement | null = null
    let flameImg: HTMLCanvasElement | null = null
    let targets: Target[] = []
    let particles: Particle[] = []
    let rings: Ring[] = []
    let embers: Ember[] = []
    let nextEmber = 0
    let elapsed = 0
    let lastBeat = -1
    let raf = 0
    let last = 0
    let visible = true
    let onScreen = true
    const pointer = { x: 0, y: 0, active: false, px: 0, py: 0 }

    const rand = (a: number, b: number) => a + Math.random() * (b - a)

    function measure() {
      const rect = canvas!.getBoundingClientRect()
      const a = anchorRef.current?.getBoundingClientRect()
      const s = a ? Math.min(a.width, a.height) : Math.min(rect.width, rect.height) * 0.4
      return {
        W: rect.width,
        H: rect.height,
        cx: a ? a.left - rect.left + a.width / 2 : rect.width / 2,
        cy: a ? a.top - rect.top + a.height / 2 : rect.height * 0.35,
        s,
      }
    }

    function drawStars() {
      starsCanvas!.width = Math.round(W * dpr)
      starsCanvas!.height = Math.round(H * dpr)
      sctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      sctx!.clearRect(0, 0, W, H)
      const n = Math.round(clamp((W * H) / 3800, 60, 320))
      for (let i = 0; i < n; i++) {
        const x = Math.random() * W
        // denser near the top, fading toward the horizon
        const y = Math.pow(Math.random(), 1.6) * H * 0.8
        const r = Math.random() < 0.08 ? rand(0.9, 1.4) : rand(0.35, 0.8)
        sctx!.globalAlpha = rand(0.2, 0.75) * (1 - y / (H * 0.95))
        sctx!.fillStyle = Math.random() < 0.2 ? '#d2c7ff' : '#fff3e0'
        sctx!.beginPath()
        sctx!.arc(x, y, r, 0, Math.PI * 2)
        sctx!.fill()
      }
      sctx!.globalAlpha = 1
    }

    function build(keepTime: boolean) {
      const m = measure()
      W = m.W
      H = m.H
      if (W < 2 || H < 2) return
      const small = W < 768
      dpr = Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2)
      canvas!.width = Math.round(W * dpr)
      canvas!.height = Math.round(H * dpr)
      heart = { cx: m.cx, cy: m.cy, s: m.s }
      heartImg = renderHeartImage(heart.s, dpr)
      flameImg = renderFlameImage(heart.s, dpr)
      drawStars()

      const lowPower = (navigator.hardwareConcurrency || 4) <= 4 || (window.devicePixelRatio || 1) > 2.5
      const scale = lowPower ? 0.75 : 1
      const heartN = Math.round(clamp(heart.s * 0.62, 80, 220) * scale)
      const ambientN = Math.round(clamp((W * H) / 6500, 45, 170) * scale)
      targets = sampleLogoTargets(heartN)

      particles = []
      const total = targets.length + ambientN
      for (let i = 0; i < total; i++) {
        const t = i < targets.length ? i : -1
        const kind = t >= 0 ? targets[t].kind : -1
        const angle = rand(0, Math.PI * 2)
        const speed = rand(0.05, 0.22)
        const z = rand(0.35, 1)
        const sprite = kind === 2 ? 2 : kind === 0 ? (Math.random() < 0.8 ? 0 : 2) : kind === 1 ? (Math.random() < 0.8 ? 1 : 0) : [0, 0, 1, 2, 3][Math.floor(rand(0, 5))]
        // Heart-bound sparks start scattered around the sky, biased away from the heart
        let x = rand(-20, W + 20)
        const y = rand(-20, H * 0.85)
        if (t >= 0 && Math.hypot(x - heart.cx, y - heart.cy) < heart.s * 0.6) {
          x = Math.random() < 0.5 ? rand(-20, W * 0.3) : rand(W * 0.7, W + 20)
        }
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          bvx: Math.cos(angle) * speed,
          bvy: Math.sin(angle) * speed - 0.03,
          z,
          size: t >= 0 ? (kind === 2 ? rand(7, 11) : rand(6, 10.5)) * Math.max(0.75, heart.s / 320) : rand(5, 13) * z,
          sprite,
          tw: rand(0, Math.PI * 2),
          twSpeed: rand(0.0008, 0.0026),
          target: t,
          delay: rand(0, 1300) + (kind === 2 ? 900 : 0),
          dur: rand(1700, 2300),
          curve: rand(0.12, 0.38) * (Math.random() < 0.5 ? -1 : 1),
          sx: 0,
          sy: 0,
          started: false,
          ox: 0,
          oy: 0,
        })
      }
      rings = []
      embers = []
      if (!keepTime) {
        elapsed = 0
        lastBeat = -1
      } else {
        // On resize after formation, snap sparks home so the heart stays intact.
        for (const p of particles) {
          if (p.target >= 0 && elapsed > FORM_START + p.delay) {
            p.started = true
            p.delay = -1e9
          }
        }
      }
    }

    function heartFormTime() {
      return FORM_START + 1300 + 900 + 2300
    }

    function frame(time: number, dt: number) {
      const c = ctx!
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, W, H)

      const formEnd = FORM_START + 3000
      const formed = smooth(FORM_START + 1600, formEnd + 900, time)
      // heartbeat (lub-dub) once formed
      let beat = 0
      if (time > formEnd) {
        const bt = time - formEnd
        const local = bt % BEAT_PERIOD
        const idx = Math.floor(bt / BEAT_PERIOD)
        beat = 0.05 * bump(local, 160, 75) + 0.028 * bump(local, 420, 85)
        if (idx !== lastBeat && local > 140) {
          lastBeat = idx
          rings.push({ born: time, strength: 1 })
        }
      }
      const sc = 1 + beat * formed

      // parallax from pointer (normalised -1..1)
      const pnx = pointer.active ? (pointer.x / W) * 2 - 1 : 0
      const pny = pointer.active ? (pointer.y / H) * 2 - 1 : 0
      pointer.px += (pnx - pointer.px) * 0.04
      pointer.py += (pny - pointer.py) * 0.04
      const hcx = heart.cx + pointer.px * 10
      const hcy = heart.cy + pointer.py * 8
      const unit = (heart.s / 64) * sc

      // rings: soft "incoming call" ripples
      const ringLife = 3000
      rings = rings.filter((r) => time - r.born < ringLife)
      c.globalCompositeOperation = 'source-over'
      for (const r of rings) {
        const k = (time - r.born) / ringLife
        const e = 1 - Math.pow(1 - k, 3)
        const rad = heart.s * (0.42 + e * 0.95)
        const a = 0.38 * Math.pow(1 - k, 1.6) * formed
        c.lineWidth = 1.6 - k
        c.strokeStyle = `rgba(247,176,124,${a})`
        c.beginPath()
        c.arc(hcx, hcy + heart.s * 0.02, rad, 0, Math.PI * 2)
        c.stroke()
        c.lineWidth = 1
        c.strokeStyle = `rgba(241,155,176,${a * 0.5})`
        c.beginPath()
        c.arc(hcx, hcy + heart.s * 0.02, rad * 0.9, 0, Math.PI * 2)
        c.stroke()
      }

      // formed logo underlay
      const size = heart.s * 1.7 * sc
      const imgY = hcy - size / 2 + heart.s * 0.0234 * sc
      if (formed > 0 && heartImg) {
        c.globalAlpha = formed * 0.62
        c.drawImage(heartImg, hcx - size / 2, imgY, size, size)
        c.globalAlpha = 1
      }
      // the diya flame is lit once the heart has gathered
      const ignite = smooth(formEnd - 500, formEnd + 900, time)
      if (ignite > 0 && flameImg) {
        const flick = 0.9 + 0.1 * Math.sin(time * 0.0061) * Math.sin(time * 0.0037 + 1)
        const fs = size * (0.55 + 0.45 * ignite) * (1 + 0.015 * Math.sin(time * 0.009))
        // scale about the flame's base (32, 38 in logo units)
        const by = hcy + 7.5 * unit
        const k = fs / size
        c.globalAlpha = ignite * flick
        c.drawImage(flameImg, hcx - (size / 2) * k, by - (size / 2 + 6 * unit) * k, fs, fs)
        c.globalAlpha = 1
      }

      c.globalCompositeOperation = 'lighter'
      const f = dt / 16.67
      const pr = heart.s * 0.32
      for (const p of particles) {
        p.tw += p.twSpeed * dt
        let dx = 0
        let dy = 0
        let alpha: number
        let size = p.size

        if (p.target >= 0 && time > FORM_START + p.delay) {
          const tg = targets[p.target]
          const tx = hcx + tg.x * unit + Math.sin(p.tw * 1.3) * 0.7
          const ty = hcy + tg.y * unit + Math.cos(p.tw) * 0.7
          if (!p.started) {
            p.started = true
            p.sx = p.x
            p.sy = p.y
          }
          const k = clamp((time - FORM_START - p.delay) / p.dur, 0, 1)
          // pointer: gentle push-away from the formed heart, springs back
          let wantOx = 0
          let wantOy = 0
          if (pointer.active && k >= 1) {
            const ddx = tx - pointer.x
            const ddy = ty - pointer.y
            const d = Math.hypot(ddx, ddy)
            if (d < pr && d > 0.01) {
              const push = Math.pow(1 - d / pr, 2) * heart.s * 0.07
              wantOx = (ddx / d) * push
              wantOy = (ddy / d) * push
            }
          }
          p.ox += (wantOx - p.ox) * 0.08 * f
          p.oy += (wantOy - p.oy) * 0.08 * f
          if (k < 1) {
            const e = easeInOutCubic(k)
            const lx = tx - p.sx
            const ly = ty - p.sy
            const arc = Math.sin(Math.PI * e) * p.curve
            p.x = p.sx + lx * e - ly * arc
            p.y = p.sy + ly * e + lx * arc
          } else {
            p.x = tx + p.ox
            p.y = ty + p.oy
          }
          const settle = smooth(0.6, 1, k)
          alpha = (0.55 + 0.45 * Math.sin(p.tw) * (1 - settle * 0.6)) * (0.75 + 0.25 * settle)
          size = p.size * (1.35 - 0.35 * settle) * (1 + beat * 2.2)
        } else {
          // free drift with a soft flow field
          const ang = Math.sin(p.x * 0.0023 + time * 0.00011) * Math.cos(p.y * 0.0019 - time * 0.00008) * Math.PI
          p.vx += Math.cos(ang) * 0.004 * f
          p.vy += Math.sin(ang) * 0.004 * f
          if (pointer.active && p.target < 0) {
            const ddx = pointer.x - p.x
            const ddy = pointer.y - p.y
            const d = Math.hypot(ddx, ddy)
            if (d < 170 && d > 1) {
              const g = (1 - d / 170) * 0.018 * f
              p.vx += (ddx / d) * g - (ddy / d) * g * 0.6
              p.vy += (ddy / d) * g + (ddx / d) * g * 0.6
            }
          }
          p.vx = p.vx * 0.985 + p.bvx * 0.015
          p.vy = p.vy * 0.985 + p.bvy * 0.015
          p.x += p.vx * f * (0.6 + p.z * 0.6)
          p.y += p.vy * f * (0.6 + p.z * 0.6)
          if (p.x < -30) p.x = W + 30
          else if (p.x > W + 30) p.x = -30
          if (p.y < -30) p.y = H * 0.85
          else if (p.y > H * 0.9) p.y = -30
          dx = pointer.px * 18 * p.z
          dy = pointer.py * 12 * p.z
          alpha = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.tw))) * (0.45 + 0.55 * p.z)
          if (p.target >= 0) alpha *= 0.9
        }

        c.globalAlpha = clamp(alpha, 0, 1)
        const sprite = sprites[p.sprite]
        c.drawImage(sprite, p.x + dx - size, p.y + dy - size, size * 2, size * 2)
      }
      // tiny embers rising from the flame
      if (ignite > 0.6 && dt > 0) {
        if (time > nextEmber && embers.length < 14) {
          nextEmber = time + rand(180, 420)
          embers.push({
            x: hcx + rand(-1.2, 1.2) * unit,
            y: hcy - 6 * unit,
            vx: rand(-0.12, 0.12),
            vy: -rand(0.25, 0.5) * Math.max(0.8, heart.s / 300),
            born: time,
            life: rand(1600, 2800),
            size: rand(2.2, 4.2),
            sprite: Math.random() < 0.5 ? 0 : 2,
          })
        }
        embers = embers.filter((e) => time - e.born < e.life)
        for (const e of embers) {
          const k = (time - e.born) / e.life
          e.x += (e.vx + Math.sin((time - e.born) * 0.004 + e.life) * 0.12) * f
          e.y += e.vy * f
          c.globalAlpha = Math.sin(Math.PI * k) * 0.9
          const sz = e.size * (1 - k * 0.5)
          c.drawImage(sprites[e.sprite], e.x - sz, e.y - sz, sz * 2, sz * 2)
        }
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    }

    function loop(now: number) {
      raf = requestAnimationFrame(loop)
      const dt = last ? Math.min(50, now - last) : 16.67
      last = now
      elapsed += dt
      frame(elapsed, dt)
    }

    function start() {
      if (raf || reduced || !visible || !onScreen) return
      last = 0
      raf = requestAnimationFrame(loop)
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    function renderStatic() {
      // Composed final frame: heart formed, fireflies resting, one faint ring.
      elapsed = heartFormTime() + 1200
      for (const p of particles) {
        if (p.target >= 0) {
          p.started = true
          p.sx = p.x
          p.sy = p.y
          p.delay = -1e9
        }
      }
      lastBeat = Math.floor((elapsed - (FORM_START + 3000)) / BEAT_PERIOD)
      rings = [{ born: elapsed - 900, strength: 1 }]
      frame(elapsed, 16.67)
    }

    build(false)
    if (reduced) renderStatic()
    else start()

    let resizeTimer = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        const m = measure()
        if (Math.abs(m.W - W) < 1 && Math.abs(m.H - H) < 1 && Math.abs(m.s - heart.s) < 1 && Math.abs(m.cx - heart.cx) < 1 && Math.abs(m.cy - heart.cy) < 1) return
        // Mobile URL-bar show/hide changes height only slightly; just re-measure the heart.
        if (Math.abs(m.W - W) < 1 && Math.abs(m.s - heart.s) < 1) {
          H = m.H
          canvas!.height = Math.round(H * dpr)
          heart.cx = m.cx
          heart.cy = m.cy
          drawStars()
        } else {
          build(true)
        }
        if (reduced) renderStatic()
      }, 120)
    })
    ro.observe(canvas)
    if (anchorRef.current) ro.observe(anchorRef.current)

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      if (onScreen) start()
      else stop()
    })
    io.observe(canvas)

    const onVis = () => {
      visible = document.visibilityState === 'visible'
      if (visible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVis)

    const onMotionPref = () => {
      reduced = reducedMq.matches
      if (reduced) {
        stop()
        renderStatic()
      } else start()
    }
    reducedMq.addEventListener('change', onMotionPref)

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
      pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height
    }
    const onLeave = () => {
      pointer.active = false
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') onLeave()
    }
    window.addEventListener('pointerup', onUp, { passive: true })
    document.addEventListener('pointerleave', onLeave)

    return () => {
      stop()
      window.clearTimeout(resizeTimer)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      reducedMq.removeEventListener('change', onMotionPref)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [anchorRef])

  return (
    <div className={className} aria-hidden="true">
      <canvas ref={starsRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}

export default HeartfieldCanvas
