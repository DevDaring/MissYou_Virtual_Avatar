import { useEffect, useRef } from 'react'
import type { Job } from './types'

/** Subscribe to live job progress over /api/ws (falls back silently). */
export function useJobEvents(onJob: (j: Job) => void, enabled = true) {
  const cb = useRef(onJob)
  cb.current = onJob
  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let timer: number | undefined
    let stopped = false
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/ws`)
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'job') cb.current(m as Job)
        } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!stopped) timer = window.setTimeout(connect, 3000) }
    }
    connect()
    const ping = window.setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25000)
    return () => { stopped = true; window.clearTimeout(timer); window.clearInterval(ping); ws?.close() }
  }, [enabled])
}
