import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/index.css'

const inCall = () => location.pathname.startsWith('/call/') && !location.pathname.endsWith('/after')

// Page loads always fetch fresh HTML (the service worker only falls back to its cache offline), so a
// deploy shows up on the next load without a forced reload. New versions install quietly; check every 5 minutes.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => window.setInterval(() => void reg.update(), 5 * 60 * 1000)).catch(() => {})
  })
}

// A tab left open across a deploy may ask for a code chunk that no longer exists: reload once to pick up the
// new version, but never in the middle of a call.
window.addEventListener('vite:preloadError', (e) => {
  if (inCall() || sessionStorage.getItem('chunk-reload')) return
  e.preventDefault()
  sessionStorage.setItem('chunk-reload', '1')
  location.reload()
})
window.addEventListener('load', () => window.setTimeout(() => sessionStorage.removeItem('chunk-reload'), 10_000))

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
