import { ApiError, post } from './api'
import type { CallInfo } from './types'

export async function startCall(personId: string, opts: { scene_id?: string; kind?: string; store_transcript?: boolean; caller_id?: string } = {}): Promise<CallInfo> {
  const r = await post<{ call: CallInfo }>('/api/calls', { person_id: personId, ...opts })
  return r.call
}

export function callErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { code?: string; message?: string; needed?: number; balance?: number }
    if (d?.code === 'daily_limit') return d.message || "You've reached today's call time."
    if (d?.code === 'insufficient_credits') return `You need ${d.needed} credits to start (you have ${d.balance}).`
    if (e.code === 'archived') return 'This loved one is archived. You can restore them from their page.'
    if (typeof e.detail === 'string') return e.detail
  }
  return 'The call could not start. Please try again.'
}
