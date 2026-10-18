// Thin fetch wrapper: JSON, cookies, CSRF double-submit header, friendly errors.

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : (detail as { message?: string })?.message || `Error ${status}`)
    this.status = status
    this.detail = detail
  }
  get code(): string | undefined {
    if (typeof this.detail === 'string') return this.detail
    return (this.detail as { code?: string })?.code
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|; )my_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined || opts.raw ? 'POST' : 'GET')
  const headers: Record<string, string> = { ...(opts.headers || {}) }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf()
  let body: BodyInit | undefined = opts.raw
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const j = await res.json()
      detail = j.detail ?? j
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>
}

export const get = <T,>(p: string) => api<T>(p)
export const post = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body })
export const patch = <T,>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body })
export const del = <T,>(p: string) => api<T>(p, { method: 'DELETE' })

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { message?: string; code?: string } | string
    if (typeof d === 'object' && d?.message) return d.message
    if (e.code === 'insufficient_credits') return "You don't have enough credits for this."
    if (e.code === 'consent_required') return 'Please confirm the consent statements first.'
    if (e.code === 'csrf_failed') return 'Your session expired. Please refresh the page.'
    if (typeof d === 'string') return d
    return e.message
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}

/** Resumable chunked upload with progress (brief 6.2). */
export async function uploadFile(personId: string, file: File, onProgress: (p: number) => void, purpose = 'memory'): Promise<{ media: MediaItem }> {
  const init = await post<{ upload_id: string; chunk_size: number; received: number }>(`/api/people/${personId}/uploads`, { filename: file.name, size: file.size, purpose })
  let offset = init.received
  const size = init.chunk_size
  let tries = 0
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + size, file.size))
    try {
      const r = await api<{ received: number }>(`/api/uploads/${init.upload_id}?offset=${offset}`, { method: 'PUT', raw: chunk, headers: { 'Content-Type': 'application/octet-stream' } })
      offset = r.received
      tries = 0
      onProgress(Math.round((offset / file.size) * 100))
    } catch (e) {
      if (++tries > 4) throw e
      await new Promise((r) => setTimeout(r, 800 * tries))
      const s = await get<{ received: number }>(`/api/uploads/${init.upload_id}`)
      offset = s.received
    }
  }
  return post(`/api/uploads/${init.upload_id}/complete`)
}

export interface MediaItem { id: string; kind: string; mime: string; size: number; name: string; url: string; duration_s?: number; processed?: boolean }
