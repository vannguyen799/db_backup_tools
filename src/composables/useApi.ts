import { useAuthStore } from '~/stores/auth'

export function useApi() {
  const auth = useAuthStore()

  async function request<T = unknown>(url: string, opts: Parameters<typeof $fetch>[1] = {}): Promise<T> {
    const headers: Record<string, string> = { ...((opts?.headers as Record<string, string>) || {}) }
    if (auth.token) headers.Authorization = `Bearer ${auth.token}`
    try {
      const res = await $fetch<{ success: boolean; data: T; message?: string }>(url, { ...opts, headers })
      return res.data
    } catch (err: unknown) {
      const e = err as { statusCode?: number; data?: { message?: string }; message?: string }
      if (e.statusCode === 401) auth.logout()
      throw new Error(e.data?.message || e.message || 'Request failed')
    }
  }

  return {
    get: <T>(url: string) => request<T>(url),
    post: <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body: body as never }),
    patch: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PATCH', body: body as never }),
    del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
  }
}
