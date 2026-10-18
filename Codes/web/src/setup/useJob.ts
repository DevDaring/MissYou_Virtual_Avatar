import { useCallback, useEffect, useRef, useState } from 'react'
import { get } from '../lib/api'
import { useJobEvents } from '../lib/events'
import type { Job } from '../lib/types'

/** Track one background job: live over WebSocket, with polling as a fallback. */
export function useJob(onDone?: (j: Job) => void) {
  const [job, setJob] = useState<Job | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  const idRef = useRef<string | null>(null)
  const finished = useRef(false)
  const apply = useCallback((j: Job) => {
    if (j.id !== idRef.current || finished.current) return
    setJob(j)
    if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') { finished.current = true; done.current?.(j) }
  }, [])
  useJobEvents(apply, true)
  useEffect(() => {
    const t = window.setInterval(async () => {
      if (!idRef.current || finished.current) return
      try { apply(await get<Job>(`/api/jobs/${idRef.current}`)) } catch { /* ignore */ }
    }, 3000)
    return () => window.clearInterval(t)
  }, [apply])
  const track = useCallback((id: string) => { idRef.current = id; finished.current = false; setJob({ id, kind: '', status: 'queued', progress: 0, message: 'Starting…' }) }, [])
  const running = !!job && (job.status === 'queued' || job.status === 'running')
  return { job, track, running, reset: () => { idRef.current = null; setJob(null) } }
}
