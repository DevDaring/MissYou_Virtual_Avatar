import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/index.css'
import { registerSW } from 'virtual:pwa-register'

// New deploys apply themselves: check every 5 minutes, reload when a new version is ready —
// but never in the middle of a call (wait until the caller has left the call screen).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const apply = () => (location.pathname.startsWith('/call/') && !location.pathname.endsWith('/after')
      ? window.setTimeout(apply, 15000) : void updateSW(true))
    apply()
  },
  onRegisteredSW(_url, reg) { if (reg) window.setInterval(() => void reg.update(), 5 * 60 * 1000) },
})

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
