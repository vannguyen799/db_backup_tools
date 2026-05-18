<template>
  <div>
    <h1 class="text-xl font-semibold mb-1">Settings</h1>
    <p class="text-sm text-[var(--color-text-muted)] mb-6">Manage your account and Google Drive integrations</p>

    <div v-if="banner" class="mb-4 panel p-3 text-sm" :class="bannerClass">{{ banner }}</div>

    <div class="panel p-6 max-w-3xl mb-4">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold">Change password</h2>
        <span v-if="auth.user?.email" class="text-xs text-[var(--color-text-muted)]">{{ auth.user.email }}</span>
      </div>
      <div v-if="pwBanner" class="mb-3 panel-2 p-3 text-sm" :class="pwBannerClass">{{ pwBanner }}</div>
      <form class="space-y-3" @submit.prevent="changePassword">
        <div>
          <label class="label">Current password</label>
          <input v-model="pw.currentPassword" type="password" class="input" autocomplete="current-password" required />
        </div>
        <div>
          <label class="label">New password</label>
          <input v-model="pw.newPassword" type="password" class="input" autocomplete="new-password" minlength="8" required />
          <div class="text-xs text-[var(--color-text-muted)] mt-1">At least 8 characters.</div>
        </div>
        <div>
          <label class="label">Confirm new password</label>
          <input v-model="pw.confirmPassword" type="password" class="input" autocomplete="new-password" required />
        </div>
        <button class="btn btn-primary" :disabled="pwBusy">
          {{ pwBusy ? 'Updating…' : 'Update password' }}
        </button>
      </form>
    </div>

    <div class="panel p-6 max-w-3xl">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold">Connected Google accounts</h2>
        <span class="text-xs text-[var(--color-text-muted)]">{{ accounts.length }} account(s)</span>
      </div>

      <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>

      <div v-else-if="accounts.length" class="space-y-3 mb-6">
        <div v-for="acc in accounts" :key="acc.id" class="panel-2 p-3 flex items-center gap-3">
          <img v-if="acc.picture" :src="acc.picture" class="w-10 h-10 rounded-full" alt="" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{ acc.label || acc.name || acc.email }}</span>
              <span class="badge">{{ acc.source }}</span>
            </div>
            <div class="text-xs text-[var(--color-text-muted)] truncate">{{ acc.email }}</div>
            <div class="text-xs text-[var(--color-text-muted)] mt-0.5">
              Connected {{ formatDate(acc.connectedAt) }}
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <input
              v-model="labelEdits[acc.id]"
              class="input text-xs"
              :placeholder="acc.label || 'label (optional)'"
              @blur="saveLabel(acc)"
              @keydown.enter.prevent="saveLabel(acc)"
            />
            <button class="btn btn-danger text-xs" :disabled="busy" @click="disconnect(acc)">Disconnect</button>
          </div>
        </div>
      </div>

      <div v-else class="text-sm text-[var(--color-text-muted)] mb-6">
        No Google accounts connected yet. Add one below.
      </div>

      <h3 class="text-sm font-semibold mb-3">Add another account</h3>
      <div class="flex border-b border-[var(--color-border)] mb-5">
        <button
          class="px-4 py-2 text-sm border-b-2 transition-colors"
          :class="mode === 'oauth' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-transparent text-[var(--color-text-muted)]'"
          @click="mode = 'oauth'"
        >OAuth flow</button>
        <button
          class="px-4 py-2 text-sm border-b-2 transition-colors"
          :class="mode === 'manual' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-transparent text-[var(--color-text-muted)]'"
          @click="mode = 'manual'"
        >Paste credentials</button>
      </div>

      <div v-if="mode === 'oauth'" class="space-y-3">
        <p class="text-sm text-[var(--color-text-muted)]">
          Click below to be redirected to Google's consent screen. Requires
          <code class="text-xs">GOOGLE_CLIENT_ID</code> / <code class="text-xs">GOOGLE_CLIENT_SECRET</code>
          set in the server environment.
        </p>
        <div v-if="!envInfo.hasEnvCreds" class="text-sm text-[var(--color-warning)]">
          ⚠ Env credentials are not set. Use the "Paste credentials" tab instead, or restart the server with env vars configured.
        </div>
        <div>
          <label class="label">Label (optional)</label>
          <input v-model="oauthLabel" class="input" placeholder="e.g. company-a" />
        </div>
        <button class="btn btn-primary" :disabled="busy || !envInfo.hasEnvCreds" @click="connectOAuth">
          Connect another Google account
        </button>
      </div>

      <form v-else class="space-y-3" @submit.prevent="connectManual">
        <p class="text-sm text-[var(--color-text-muted)]">
          Paste an OAuth client_id, client_secret, and refresh_token from any Google Cloud project (or
          <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener" class="text-[var(--color-accent)]">OAuth Playground</a>).
          The refresh token must have been issued by the same client_id/secret pair.
        </p>
        <div>
          <label class="label">Label (optional)</label>
          <input v-model="manual.label" class="input" placeholder="e.g. client-b" />
        </div>
        <div>
          <label class="label">Client ID</label>
          <input v-model="manual.clientId" class="input font-mono text-xs" placeholder="123456-abc.apps.googleusercontent.com" required />
        </div>
        <div>
          <label class="label">Client Secret</label>
          <input v-model="manual.clientSecret" type="password" class="input font-mono text-xs" placeholder="GOCSPX-..." required />
        </div>
        <div>
          <label class="label">Refresh Token</label>
          <textarea v-model="manual.refreshToken" class="textarea font-mono text-xs" rows="3" placeholder="1//0g..." required></textarea>
          <div class="text-xs text-[var(--color-text-muted)] mt-1">
            Scope must include <code>https://www.googleapis.com/auth/drive.file</code> for uploads to work.
          </div>
        </div>
        <button class="btn btn-primary" :disabled="busy">
          {{ busy ? 'Verifying with Google…' : 'Verify & Add account' }}
        </button>
      </form>
    </div>

    <div class="panel p-5 max-w-3xl mt-4 text-xs text-[var(--color-text-muted)]">
      <div class="mb-1 text-[var(--color-text)] text-sm font-semibold">OAuth redirect URI</div>
      <p class="mb-2">Use this exact value in your Google Cloud Console OAuth client (only needed for the OAuth flow tab):</p>
      <code class="block panel-2 p-2 font-mono text-[var(--color-accent)] break-all">{{ envInfo.redirectUri }}</code>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { useAuthStore } from '~/stores/auth'
import { formatDate } from '~/utils/format'

interface Account {
  id: string
  label: string
  email: string
  name: string
  picture: string
  connectedAt?: string
  source: 'oauth' | 'manual'
}

interface StatusResponse {
  accounts: Account[]
  hasEnvCreds: boolean
  redirectUri: string
}

const api = useApi()
const auth = useAuthStore()
const accounts = ref<Account[]>([])
const envInfo = reactive({ hasEnvCreds: false, redirectUri: '' })
const loading = ref(true)
const busy = ref(false)
const banner = ref('')
const bannerClass = ref('')
const mode = ref<'oauth' | 'manual'>('manual')
const oauthLabel = ref('')
const labelEdits = reactive<Record<string, string>>({})

const manual = reactive({
  label: '',
  clientId: '',
  clientSecret: '',
  refreshToken: '',
})

const pw = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const pwBusy = ref(false)
const pwBanner = ref('')
const pwBannerClass = ref('')

async function changePassword() {
  pwBanner.value = ''
  if (pw.newPassword !== pw.confirmPassword) {
    pwBanner.value = 'New password and confirmation do not match'
    pwBannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
    return
  }
  pwBusy.value = true
  try {
    await api.post('/api/auth/change-password', {
      currentPassword: pw.currentPassword,
      newPassword: pw.newPassword,
    })
    pw.currentPassword = ''
    pw.newPassword = ''
    pw.confirmPassword = ''
    pwBanner.value = '✓ Password updated'
    pwBannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
  } catch (err) {
    pwBanner.value = `✗ ${(err as Error).message}`
    pwBannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
  } finally {
    pwBusy.value = false
  }
}

const route = useRoute()

async function refresh() {
  const res = await api.get<StatusResponse>('/api/gdrive/status')
  accounts.value = res.accounts || []
  envInfo.hasEnvCreds = res.hasEnvCreds
  envInfo.redirectUri = res.redirectUri
  for (const a of accounts.value) {
    if (!(a.id in labelEdits)) labelEdits[a.id] = a.label || ''
  }
  if (envInfo.hasEnvCreds && !accounts.value.length) {
    mode.value = 'oauth'
  }
}

async function connectOAuth() {
  busy.value = true
  try {
    const res = await api.post<{ url: string }>('/api/gdrive/connect', { label: oauthLabel.value })
    window.location.href = res.url
  } finally {
    busy.value = false
  }
}

async function connectManual() {
  busy.value = true
  banner.value = ''
  try {
    const result = await api.post<Account>('/api/gdrive/accounts/manual', manual)
    banner.value = `✓ Connected as ${result.email || result.label || 'Google account'}`
    bannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
    manual.label = ''
    manual.clientId = ''
    manual.clientSecret = ''
    manual.refreshToken = ''
    await refresh()
  } catch (err) {
    banner.value = `✗ ${(err as Error).message}`
    bannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
  } finally {
    busy.value = false
  }
}

async function saveLabel(acc: Account) {
  const next = (labelEdits[acc.id] || '').trim()
  if (next === (acc.label || '')) return
  try {
    await api.patch(`/api/gdrive/accounts/${acc.id}`, { label: next })
    await refresh()
  } catch (err) {
    banner.value = `✗ ${(err as Error).message}`
    bannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
  }
}

async function disconnect(acc: Account) {
  if (!confirm(`Disconnect ${acc.email || acc.label}? Targets using this account will fail until reassigned.`)) return
  busy.value = true
  try {
    await api.del(`/api/gdrive/accounts/${acc.id}`)
    await refresh()
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try { await refresh() } finally { loading.value = false }
  const q = route.query
  if (q.gdrive === 'connected') {
    banner.value = `✓ Google Drive connected${q.email ? ` as ${q.email}` : ''}`
    bannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
  } else if (q.gdrive === 'error') {
    banner.value = `✗ Connection failed: ${q.message || 'unknown error'}`
    bannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
  }
})
</script>
