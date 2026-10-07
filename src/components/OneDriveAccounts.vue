<template>
  <div>
    <div v-if="banner" class="mb-4 panel p-3 text-sm max-w-3xl" :class="bannerClass">{{ banner }}</div>

    <div class="panel p-6 max-w-3xl">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold">Connected Microsoft accounts (OneDrive)</h2>
        <span class="text-xs text-[var(--color-text-muted)]">{{ accounts.length }} account(s)</span>
      </div>

      <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>

      <div v-else-if="accounts.length" class="space-y-3 mb-6">
        <div v-for="acc in accounts" :key="acc.id" class="panel-2 p-3 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{ acc.label || acc.name || acc.email }}</span>
              <span class="badge">{{ acc.source }}</span>
              <span v-if="acc.tenant && acc.tenant !== 'common'" class="badge">{{ acc.tenant }}</span>
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
        No Microsoft accounts connected yet. Add one below.
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
          :class="mode === 'device' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-transparent text-[var(--color-text-muted)]'"
          @click="mode = 'device'"
        >Device code</button>
        <button
          class="px-4 py-2 text-sm border-b-2 transition-colors"
          :class="mode === 'paste-url' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-transparent text-[var(--color-text-muted)]'"
          @click="mode = 'paste-url'"
        >Paste redirect URL</button>
        <button
          class="px-4 py-2 text-sm border-b-2 transition-colors"
          :class="mode === 'manual' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-transparent text-[var(--color-text-muted)]'"
          @click="mode = 'manual'"
        >Paste credentials</button>
      </div>

      <div v-if="mode === 'oauth'" class="space-y-3">
        <p class="text-sm text-[var(--color-text-muted)]">
          Click below to sign in with Microsoft (personal or work/school account). Requires
          <code class="text-xs">MICROSOFT_CLIENT_ID</code> / <code class="text-xs">MICROSOFT_CLIENT_SECRET</code>
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
          Connect a Microsoft account
        </button>
      </div>

      <div v-else-if="mode === 'device'" class="space-y-3">
        <p class="text-sm text-[var(--color-text-muted)]">
          Sign in by entering a short code at microsoft.com/link — no redirect URI or client secret needed. The client id
          must belong to an app with <em>Allow public client flows</em> enabled.
        </p>
        <div v-if="device.userCode" class="panel-2 p-4 space-y-2">
          <div class="text-sm">
            Open
            <a :href="device.verificationUri" target="_blank" rel="noopener" class="text-[var(--color-accent)] underline">{{ device.verificationUri }}</a>
            and enter:
          </div>
          <code class="block text-2xl font-mono tracking-widest text-[var(--color-accent)]">{{ device.userCode }}</code>
          <div class="text-xs text-[var(--color-text-muted)]">Waiting for you to sign in…</div>
          <button class="btn" @click="cancelDevice">Cancel</button>
        </div>
        <template v-else>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Label (optional)</label>
              <input v-model="device.label" class="input" placeholder="e.g. personal" />
            </div>
            <div>
              <label class="label">Tenant</label>
              <input v-model="device.tenant" class="input font-mono text-xs" placeholder="consumers" />
            </div>
          </div>
          <div>
            <label class="label">Client ID{{ envInfo.hasEnvCreds ? ' (optional — env default)' : '' }}</label>
            <input v-model="device.clientId" class="input font-mono text-xs" placeholder="00000000-0000-0000-0000-000000000000" />
          </div>
          <button class="btn btn-primary" :disabled="busy" @click="startDevice">Get sign-in code</button>
        </template>
      </div>

      <div v-else-if="mode === 'paste-url'" class="space-y-3">
        <p class="text-sm text-[var(--color-text-muted)]">
          Uses rclone's public app by default, no Azure registration needed. Its redirect is <code class="text-xs">http://localhost:53682/</code>. Sign in, then the browser
          lands on a page that fails to load — copy that full URL from the address bar and paste it below.
        </p>
        <template v-if="loop.url">
          <div class="panel-2 p-3 space-y-2">
            <div class="text-sm">1. Open this link and sign in:</div>
            <a :href="loop.url" target="_blank" rel="noopener" class="block text-xs text-[var(--color-accent)] underline break-all">{{ loop.url }}</a>
          </div>
          <form class="space-y-3" @submit.prevent="finishLoop">
            <div>
              <label class="label">2. Paste the URL the browser ended up on</label>
              <textarea v-model="loop.redirectUrl" class="textarea font-mono text-xs" rows="3" placeholder="http://localhost:53682/?code=M.C5...&state=..." required></textarea>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Connecting…' : 'Connect' }}</button>
              <button type="button" class="btn" @click="Object.assign(loop, { url: '', id: '', redirectUrl: '' })">Cancel</button>
            </div>
          </form>
        </template>
        <template v-else>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Label (optional)</label>
              <input v-model="loop.label" class="input" placeholder="e.g. personal" />
            </div>
            <div>
              <label class="label">Tenant</label>
              <input v-model="loop.tenant" class="input font-mono text-xs" placeholder="consumers" />
            </div>
          </div>
          <div>
            <label class="label">Client ID (optional)</label>
            <input v-model="loop.clientId" class="input font-mono text-xs" placeholder="empty = rclone's public app (works for personal accounts)" />
          </div>
          <div>
            <label class="label">Client Secret (optional)</label>
            <input v-model="loop.clientSecret" type="password" class="input font-mono text-xs" placeholder="empty = rclone's default secret" />
          </div>
          <button class="btn btn-primary" :disabled="busy" @click="startLoop">Get sign-in link</button>
        </template>
      </div>

      <form v-else class="space-y-3" @submit.prevent="connectManual">
        <p class="text-sm text-[var(--color-text-muted)]">
          Paste an Azure app registration's client id (and client secret for a "Web" app; leave it empty for a
          public client) plus a refresh token that app issued with the
          <code class="text-xs">offline_access Files.ReadWrite User.Read</code> scopes.
        </p>
        <p class="text-xs text-[var(--color-text-muted)]">
          No app registration? Run <code>rclone authorize "onedrive"</code> on a machine with a browser, sign in, and paste the
          <code>refresh_token</code> it prints. Use rclone's own client id (check it in rclone's source), leave the secret empty and set tenant to
          <code>consumers</code> for a personal account.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Label (optional)</label>
            <input v-model="manual.label" class="input" placeholder="e.g. client-b" />
          </div>
          <div>
            <label class="label">Tenant (optional)</label>
            <input v-model="manual.tenant" class="input font-mono text-xs" placeholder="common" />
          </div>
        </div>
        <div>
          <label class="label">Client ID</label>
          <input v-model="manual.clientId" class="input font-mono text-xs" placeholder="00000000-0000-0000-0000-000000000000" required />
        </div>
        <div>
          <label class="label">Client Secret (optional)</label>
          <input v-model="manual.clientSecret" type="password" class="input font-mono text-xs" />
        </div>
        <div>
          <label class="label">Refresh Token</label>
          <textarea v-model="manual.refreshToken" class="textarea font-mono text-xs" rows="3" placeholder="M.C5..." required></textarea>
        </div>
        <button class="btn btn-primary" :disabled="busy">
          {{ busy ? 'Verifying with Microsoft…' : 'Verify & Add account' }}
        </button>
      </form>
    </div>

    <div class="panel p-5 max-w-3xl mt-4 text-xs text-[var(--color-text-muted)]">
      <div class="mb-1 text-[var(--color-text)] text-sm font-semibold">Microsoft redirect URI</div>
      <p class="mb-2">Add this exact value as a "Web" redirect URI in the Azure app registration (only needed for the OAuth flow tab):</p>
      <code class="block panel-2 p-2 font-mono text-[var(--color-accent)] break-all">{{ envInfo.redirectUri }}</code>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { formatDate } from '~/utils/format'

interface Account {
  id: string
  label: string
  email: string
  name: string
  tenant: string
  connectedAt?: string
  source: 'oauth' | 'manual'
}

interface StatusResponse {
  accounts: Account[]
  hasEnvCreds: boolean
  redirectUri: string
}

const api = useApi()
const route = useRoute()
const accounts = ref<Account[]>([])
const envInfo = reactive({ hasEnvCreds: false, redirectUri: '' })
const loading = ref(true)
const busy = ref(false)
const banner = ref('')
const bannerClass = ref('')
const mode = ref<'oauth' | 'device' | 'paste-url' | 'manual'>('manual')
const oauthLabel = ref('')
const labelEdits = reactive<Record<string, string>>({})

const device = reactive({ label: '', tenant: 'consumers', clientId: '', userCode: '', verificationUri: '', id: '' })
let devicePoller: ReturnType<typeof setTimeout> | null = null

function cancelDevice() {
  if (devicePoller) clearTimeout(devicePoller)
  devicePoller = null
  Object.assign(device, { userCode: '', verificationUri: '', id: '' })
}

async function startDevice() {
  busy.value = true
  banner.value = ''
  try {
    const res = await api.post<{ id: string; userCode: string; verificationUri: string; interval: number }>(
      '/api/onedrive/device/start',
      { clientId: device.clientId, tenant: device.tenant, label: device.label },
    )
    Object.assign(device, { id: res.id, userCode: res.userCode, verificationUri: res.verificationUri })
    const tick = async () => {
      if (!device.id) return
      try {
        const r = await api.post<{ status: string; account?: Account }>('/api/onedrive/device/poll', { id: device.id })
        if (r.status === 'connected') {
          banner.value = `✓ Connected as ${r.account?.email || 'Microsoft account'}`
          bannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
          cancelDevice()
          await refresh()
          return
        }
        devicePoller = setTimeout(tick, res.interval * 1000)
      } catch (err) {
        cancelDevice()
        showError(err)
      }
    }
    devicePoller = setTimeout(tick, res.interval * 1000)
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => cancelDevice())

const loop = reactive({ label: '', tenant: 'consumers', clientId: '', clientSecret: '', id: '', url: '', redirectUrl: '' })

async function startLoop() {
  busy.value = true
  banner.value = ''
  try {
    const res = await api.post<{ id: string; url: string }>('/api/onedrive/loopback/start', {
      clientId: loop.clientId, clientSecret: loop.clientSecret, tenant: loop.tenant, label: loop.label,
    })
    Object.assign(loop, { id: res.id, url: res.url, redirectUrl: '' })
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

async function finishLoop() {
  busy.value = true
  try {
    const acc = await api.post<Account>('/api/onedrive/loopback/finish', { id: loop.id, redirectUrl: loop.redirectUrl })
    banner.value = `✓ Connected as ${acc.email || acc.label || 'Microsoft account'}`
    bannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
    Object.assign(loop, { id: '', url: '', redirectUrl: '' })
    await refresh()
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

const manual = reactive({ label: '', tenant: '', clientId: '', clientSecret: '', refreshToken: '' })

function showError(err: unknown) {
  banner.value = `✗ ${(err as Error).message}`
  bannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
}

async function refresh() {
  const res = await api.get<StatusResponse>('/api/onedrive/status')
  accounts.value = res.accounts || []
  envInfo.hasEnvCreds = res.hasEnvCreds
  envInfo.redirectUri = res.redirectUri
  for (const a of accounts.value) {
    if (!(a.id in labelEdits)) labelEdits[a.id] = a.label || ''
  }
  if (envInfo.hasEnvCreds && !accounts.value.length) mode.value = 'oauth'
}

async function connectOAuth() {
  busy.value = true
  try {
    const res = await api.post<{ url: string }>('/api/onedrive/connect', { label: oauthLabel.value })
    window.location.href = res.url
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

async function connectManual() {
  busy.value = true
  banner.value = ''
  try {
    const result = await api.post<Account>('/api/onedrive/accounts/manual', manual)
    banner.value = `✓ Connected as ${result.email || result.label || 'Microsoft account'}`
    bannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
    Object.assign(manual, { label: '', tenant: '', clientId: '', clientSecret: '', refreshToken: '' })
    await refresh()
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

async function saveLabel(acc: Account) {
  const next = (labelEdits[acc.id] || '').trim()
  if (next === (acc.label || '')) return
  try {
    await api.patch(`/api/onedrive/accounts/${acc.id}`, { label: next })
    await refresh()
  } catch (err) {
    showError(err)
  }
}

async function disconnect(acc: Account) {
  if (!confirm(`Disconnect ${acc.email || acc.label}? OneDrive targets using this account will fail until reassigned.`)) return
  busy.value = true
  try {
    await api.del(`/api/onedrive/accounts/${acc.id}`)
    await refresh()
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try { await refresh() } catch (err) { showError(err) } finally { loading.value = false }
  const q = route.query
  if (q.onedrive === 'connected') {
    banner.value = `✓ OneDrive connected${q.email ? ` as ${q.email}` : ''}`
    bannerClass.value = 'border-[var(--color-success)] text-[var(--color-success)]'
  } else if (q.onedrive === 'error') {
    banner.value = `✗ OneDrive connection failed: ${q.message || 'unknown error'}`
    bannerClass.value = 'border-[var(--color-danger)] text-[var(--color-danger)]'
  }
})
</script>
