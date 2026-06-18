<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <h1 class="text-xl font-semibold">API Keys</h1>
      <span class="text-xs text-[var(--color-text-muted)]">{{ keys.length }} key(s)</span>
    </div>
    <p class="text-sm text-[var(--color-text-muted)] mb-6">
      Machine credentials that let external systems (CI/CD, cron, webhooks) trigger a backup for one target.
    </p>

    <div v-if="banner" class="mb-4 panel p-3 text-sm" :class="bannerClass">{{ banner }}</div>

    <!-- One-time reveal of a freshly created key -->
    <div v-if="created" class="panel p-6 max-w-3xl mb-4 border border-[var(--color-success)]">
      <h2 class="text-sm font-semibold mb-1">✓ Key created — copy it now</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-3">
        This is the only time the full key is shown. Store it somewhere safe (e.g. a CI secret).
      </p>
      <div class="panel-2 p-3 flex items-center gap-2 mb-4">
        <code class="font-mono text-xs text-[var(--color-accent)] break-all flex-1">{{ created.key }}</code>
        <button class="btn text-xs whitespace-nowrap" @click="copy(created.key)">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
      </div>
      <div class="text-xs text-[var(--color-text-muted)] mb-1">Trigger this target from anywhere:</div>
      <pre class="panel-2 p-3 font-mono text-xs overflow-x-auto whitespace-pre">{{ curlSnippet(created.key) }}</pre>
      <button class="btn text-xs mt-3" @click="created = null">Dismiss</button>
    </div>

    <!-- Create form -->
    <div class="panel p-6 max-w-3xl mb-4">
      <h2 class="text-sm font-semibold mb-4">Create API key</h2>
      <form class="space-y-3" @submit.prevent="createKey">
        <div>
          <label class="label">Name *</label>
          <input v-model="form.name" class="input" required placeholder="e.g. github-actions / project-x" />
          <div class="text-xs text-[var(--color-text-muted)] mt-1">A label to recognise where this key is used.</div>
        </div>
        <div>
          <label class="label">Target *</label>
          <select v-model="form.targetId" class="select" required>
            <option value="" disabled>Select a backup target…</option>
            <option v-for="t in targets" :key="t._id" :value="t._id">{{ t.name }}</option>
          </select>
          <div class="text-xs text-[var(--color-text-muted)] mt-1">
            The key is locked to this target and can trigger nothing else.
          </div>
        </div>
        <div>
          <label class="label">Expires (optional)</label>
          <input v-model="form.expiresAt" type="date" class="input" />
        </div>
        <button class="btn btn-primary" :disabled="busy || !form.targetId">
          {{ busy ? 'Creating…' : 'Create key' }}
        </button>
      </form>
    </div>

    <!-- Existing keys -->
    <div class="panel p-5 max-w-5xl">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold">Existing keys</h2>
        <button class="btn text-xs" :disabled="refreshing" @click="refresh">{{ refreshing ? '↻…' : '↻ Refresh' }}</button>
      </div>

      <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>
      <div v-else-if="!keys.length" class="text-sm text-[var(--color-text-muted)] py-8 text-center">
        No API keys yet. Create one above.
      </div>
      <table v-else class="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Target</th>
            <th>Prefix</th>
            <th>Last used</th>
            <th>Expires</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k._id">
            <td class="font-medium">{{ k.name }}</td>
            <td>
              <span class="text-[var(--color-accent)]">{{ targetName(k.targetId) }}</span>
            </td>
            <td><code class="text-xs">{{ k.prefix }}…</code></td>
            <td>
              <span v-if="k.lastUsedAt">{{ formatRelative(k.lastUsedAt) }}</span>
              <span v-else class="text-[var(--color-text-muted)]">never</span>
            </td>
            <td>
              <span v-if="k.expiresAt" :class="isExpired(k.expiresAt) ? 'badge badge-warning' : ''">
                {{ isExpired(k.expiresAt) ? 'expired' : formatDate(k.expiresAt) }}
              </span>
              <span v-else class="text-[var(--color-text-muted)]">—</span>
            </td>
            <td class="text-xs text-[var(--color-text-muted)]">{{ formatDate(k.createdAt) }}</td>
            <td class="text-right">
              <button class="btn btn-danger text-xs" :disabled="revoking[k._id]" @click="revoke(k)">
                {{ revoking[k._id] ? '…' : 'Revoke' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { formatDate, formatRelative } from '~/utils/format'

interface TargetLite { _id: string; name: string }
interface ApiKeyRow {
  _id: string
  name: string
  prefix: string
  targetId: string
  scopes: string[]
  enabled: boolean
  expiresAt?: string | null
  lastUsedAt?: string | null
  lastUsedIp?: string
  createdAt?: string
}
interface CreatedKey {
  id: string
  name: string
  prefix: string
  targetId: string
  scopes: string[]
  expiresAt?: string | null
  key: string
}

const api = useApi()
const keys = ref<ApiKeyRow[]>([])
const targets = ref<TargetLite[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const copied = ref(false)
const created = ref<CreatedKey | null>(null)
const banner = ref('')
const bannerClass = ref('')
const revoking = reactive<Record<string, boolean>>({})

const form = reactive({ name: '', targetId: '', expiresAt: '' })

function setBanner(msg: string, ok: boolean) {
  banner.value = msg
  bannerClass.value = ok
    ? 'border-[var(--color-success)] text-[var(--color-success)]'
    : 'border-[var(--color-danger)] text-[var(--color-danger)]'
}

function targetName(id: string) {
  return targets.value.find((t) => t._id === id)?.name || id
}

function isExpired(d?: string | null) {
  return !!d && new Date(d).getTime() < Date.now()
}

function curlSnippet(key: string) {
  const origin = import.meta.client ? window.location.origin : 'https://your-backup-host'
  return `curl -X POST ${origin}/api/sync \\\n  -H "X-API-Key: ${key}"`
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard unavailable */ }
}

async function refresh() {
  refreshing.value = true
  try {
    const [k, t] = await Promise.all([
      api.get<ApiKeyRow[]>('/api/api-keys'),
      api.get<TargetLite[]>('/api/targets'),
    ])
    keys.value = k
    targets.value = t
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function createKey() {
  busy.value = true
  banner.value = ''
  try {
    const payload: Record<string, unknown> = { name: form.name, targetId: form.targetId }
    if (form.expiresAt) payload.expiresAt = form.expiresAt
    created.value = await api.post<CreatedKey>('/api/api-keys', payload)
    form.name = ''
    form.targetId = ''
    form.expiresAt = ''
    await refresh()
  } catch (err) {
    setBanner(`✗ ${(err as Error).message}`, false)
  } finally {
    busy.value = false
  }
}

async function revoke(k: ApiKeyRow) {
  if (!confirm(`Revoke "${k.name}"? Any system using this key will immediately lose access.`)) return
  revoking[k._id] = true
  try {
    await api.del(`/api/api-keys/${k._id}`)
    setBanner(`✓ Revoked "${k.name}"`, true)
    await refresh()
  } catch (err) {
    setBanner(`✗ ${(err as Error).message}`, false)
  } finally {
    revoking[k._id] = false
  }
}

onMounted(async () => {
  try { await refresh() } finally { loading.value = false }
})
</script>
