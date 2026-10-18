import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../call/audio', () => ({
  CallAudio: class { suspended = false; isSpeaking = false; resume = async () => {}; startRing() {}; stopRing() {}; startAmbient() {}; setAmbient() {}; setVolume() {}; envelope() { return 0 }; enqueue() {}; stopVoice() {}; chime() {}; endTone() {}; close() {} },
}))
vi.mock('../call/mic', () => ({
  Mic: class { vad = false; muted = false; blocked = false; recording = false; open = async () => {}; start() {}; stop() {}; cancel() {}; close() {} },
  blobToBase64: async () => '',
}))

const sockets: { onmessage?: (e: { data: string }) => void }[] = []
vi.stubGlobal('WebSocket', class { onmessage?: (e: { data: string }) => void; onclose?: () => void; readyState = 1; constructor() { sockets.push(this) } send() {} close() {} })
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
  call: { id: 'c1', status: 'ringing', language: 'en', soft_limit_s: 600, person: { name: 'Anjali Sen', called_name: 'Ma', relationship: 'mother' },
    scene: { location_label: 'Balcony at sunset', ambient: 'evening', still_url: '/s.png', idle_url: '/i.mp4', listening_url: '/l.mp4', talking_url: '/t.mp4', weather: 'clear', time_of_day: 'golden_hour' } },
}), { status: 200, headers: { 'content-type': 'application/json' } })))

import Call from '../pages/Call'

describe('call screen', () => {
  it('rings, then shows the AI-labelled call with captions and controls', async () => {
    render(<MemoryRouter initialEntries={['/call/c1']}><Routes><Route path="/call/:callId" element={<Call />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Calling')).toBeInTheDocument()
    expect(screen.getAllByText('AI recreation').length).toBeGreaterThan(0)
    const ws = sockets[sockets.length - 1]
    ws.onmessage?.({ data: JSON.stringify({ type: 'state', status: 'active', soft_limit_s: 600 }) })
    ws.onmessage?.({ data: JSON.stringify({ type: 'reply_text', turn_id: 't1', text: 'Ki re Shona, kemon achish?' }) })
    expect(await screen.findByText('Ki re Shona, kemon achish?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Something felt wrong' })).toBeInTheDocument()
    // a crisis pauses the call and shows support
    ws.onmessage?.({ data: JSON.stringify({ type: 'crisis', message: 'You matter.', resources: { title: 'You are not alone', intro: '', lines: [{ name: 'Tele-MANAS', phone: '14416', hours: '24x7', url: '' }] } }) })
    expect(await screen.findByText('You are not alone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue the call' })).toBeInTheDocument()
  })
})
