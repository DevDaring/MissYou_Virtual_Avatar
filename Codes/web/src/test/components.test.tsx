import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Login from '../pages/Login'
import StepUpload from '../setup/StepUpload'
import { AIBadge, SupportList } from '../components/ui'
import type { Person } from '../lib/types'

function wrap(ui: React.ReactNode, path = '/') {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.includes('/api/consent/media') ? { statements: ['I have the right to use these.', 'They were an adult.'] }
      : url.includes('/media') ? { media: [] } : {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  vi.stubGlobal('WebSocket', class { close() {} send() {} readyState = 0 })
})

describe('jury access', () => {
  it('shows and prefills the jury credentials', () => {
    wrap(<Login />, '/login?jury=1')
    expect(screen.getByText(/TestUser11/)).toBeInTheDocument()
    expect((screen.getByLabelText('Username or email') as HTMLInputElement).value).toBe('TestUser')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('TestUser11')
  })
})

describe('upload flow', () => {
  const person = { id: 'p1', name: 'Anjali', called_name: 'Ma', consented: false } as unknown as Person
  it('requires every consent statement before uploads', async () => {
    wrap(<StepUpload person={person} onNext={() => {}} />)
    const boxes = await screen.findAllByRole('checkbox')
    const btn = screen.getByRole('button', { name: 'I confirm' })
    expect(btn).toBeDisabled()
    fireEvent.click(boxes[0])
    expect(btn).toBeDisabled()
    fireEvent.click(boxes[1])
    expect(btn).toBeEnabled()
  })
  it('shows the uploader once consented', async () => {
    wrap(<StepUpload person={{ ...person, consented: true }} onNext={() => {}} />)
    expect(await screen.findByText(/Tap to choose files/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Find the people/ })).toBeDisabled()
  })
})

describe('safety UI', () => {
  it('always labels AI and lists helplines with tap-to-call', () => {
    render(<><AIBadge /><SupportList res={{ title: 't', intro: 'reach out', lines: [{ name: 'Tele-MANAS', phone: '14416', hours: '24x7', url: '' }], emergency: { name: 'E', phone: '112' } }} /></>)
    expect(screen.getByText('AI recreation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Call 14416/ })).toHaveAttribute('href', 'tel:14416')
  })
})
