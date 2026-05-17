import { defineStore } from 'pinia'

interface UserShape {
  id: string
  email: string
  name: string
  role: string
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: '' as string,
    user: null as UserShape | null,
    ready: false,
  }),
  getters: {
    isAuthenticated: (s) => !!s.token,
  },
  actions: {
    hydrate() {
      if (import.meta.client) {
        this.token = localStorage.getItem('mb_token') || ''
        const raw = localStorage.getItem('mb_user')
        if (raw) {
          try { this.user = JSON.parse(raw) } catch { /* ignore */ }
        }
      }
      this.ready = true
    },
    persist() {
      if (import.meta.client) {
        if (this.token) localStorage.setItem('mb_token', this.token)
        else localStorage.removeItem('mb_token')
        if (this.user) localStorage.setItem('mb_user', JSON.stringify(this.user))
        else localStorage.removeItem('mb_user')
      }
    },
    async login(email: string, password: string) {
      const res = await $fetch<{ success: boolean; data: { token: string; user: UserShape } }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      this.token = res.data.token
      this.user = res.data.user
      this.persist()
    },
    async fetchMe() {
      if (!this.token) return
      try {
        const res = await $fetch<{ success: boolean; data: UserShape }>('/api/auth/me', {
          headers: { Authorization: `Bearer ${this.token}` },
        })
        this.user = res.data
        this.persist()
      } catch {
        this.logout()
      }
    },
    logout() {
      this.token = ''
      this.user = null
      this.persist()
      if (import.meta.client) navigateTo('/login')
    },
  },
})
