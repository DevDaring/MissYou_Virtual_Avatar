import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { useAuth } from './store/auth'

const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Home = lazy(() => import('./pages/Home'))
const PersonSetup = lazy(() => import('./pages/PersonSetup'))
const PersonDetail = lazy(() => import('./pages/PersonDetail'))
const Call = lazy(() => import('./pages/Call'))
const AfterCall = lazy(() => import('./pages/AfterCall'))
const History = lazy(() => import('./pages/History'))
const CallDetail = lazy(() => import('./pages/CallDetail'))
const Memories = lazy(() => import('./pages/Memories'))
const Letters = lazy(() => import('./pages/Letters'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const Join = lazy(() => import('./pages/Join'))
const Legal = lazy(() => import('./pages/Legal'))

function Loading() {
  return <div className="flex min-h-[60vh] items-center justify-center text-ember-300"><Spinner size={32} /></div>
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (!user.onboarded && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

export default function App() {
  const refresh = useAuth((s) => s.refresh)
  useEffect(() => { void refresh() }, [refresh])
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/terms" element={<Legal page="terms" />} />
        <Route path="/privacy" element={<Legal page="privacy" />} />
        <Route path="/faq" element={<Legal page="faq" />} />
        <Route path="/support" element={<Legal page="support" />} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route path="/call/:callId" element={<RequireAuth><Call /></RequireAuth>} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/home" element={<Home />} />
          <Route path="/people/new" element={<PersonSetup />} />
          <Route path="/people/:personId/setup" element={<PersonSetup />} />
          <Route path="/people/:personId" element={<PersonDetail />} />
          <Route path="/call/:callId/after" element={<AfterCall />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:callId" element={<CallDetail />} />
          <Route path="/memories" element={<Memories />} />
          <Route path="/letters" element={<Letters />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/join/:code" element={<Join />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
