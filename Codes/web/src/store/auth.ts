import { create } from 'zustand'
import { ApiError, get, post } from '../lib/api'
import type { User } from '../lib/types'

interface AuthState {
  user: User | null
  loading: boolean
  refresh: () => Promise<User | null>
  setUser: (u: User | null) => void
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  refresh: async () => {
    try {
      const r = await get<{ user: User }>('/api/auth/me')
      set({ user: r.user, loading: false })
      return r.user
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.warn(e)
      set({ user: null, loading: false })
      return null
    }
  },
  setUser: (user) => set({ user, loading: false }),
  logout: async () => {
    try { await post('/api/auth/logout') } finally { set({ user: null }) }
  },
}))
