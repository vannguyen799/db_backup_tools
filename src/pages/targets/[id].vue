<template>
  <div>
    <NuxtLink to="/targets" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">← Back to targets</NuxtLink>
    <div class="flex items-center justify-between mt-2 mb-4">
      <h1 class="text-xl font-semibold">{{ target?.name || 'Target' }}</h1>
      <div v-if="target" class="flex items-center gap-2">
        <button class="btn" :disabled="refreshing" @click="refresh">{{ refreshing ? '↻ Refreshing…' : '↻ Refresh' }}</button>
        <button class="btn btn-primary" @click="runNow">Run backup now</button>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>

    <div v-else-if="target">
      <div class="flex gap-1 border-b border-[var(--color-border)] mb-5">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="px-4 py-2 text-sm border-b-2 -mb-px transition-colors"
          :class="active === t.id
            ? 'border-[var(--color-accent)] text-[var(--color-text)]'
            : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'"
          @click="active = t.id"
        >
          {{ t.label }}<span v-if="t.id === 'history' && jobs.length" class="ml-1.5 text-xs text-[var(--color-text-muted)]">({{ jobs.length }})</span>
        </button>
      </div>

      <div v-show="active === 'settings'" class="panel p-6">
        <TargetForm
          :initial="target"
          :busy="busy"
          @submit="onSubmit"
          @delete="onDelete"
        />
        <div v-if="error" class="text-sm text-[var(--color-danger)] mt-3">{{ error }}</div>
      </div>

      <div v-show="active === 'history'" class="panel p-5">
        <div v-if="!jobs.length" class="text-sm text-[var(--color-text-muted)] py-8 text-center">
          No backup runs yet. Click <strong>Run backup now</strong> to trigger one.
        </div>
        <ul v-else class="space-y-2">
          <li v-for="j in jobs" :key="j._id" class="panel-2 overflow-hidden">
            <button
              class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-panel)]"
              @click="toggle(j._id)"
            >
              <span class="text-[var(--color-text-muted)] text-xs w-4">{{ expanded[j._id] ? '▼' : '▶' }}</span>
              <JobStatusBadge :status="j.status" />
              <span class="text-sm flex-1">{{ formatDate(j.startedAt) }}</span>
              <span class="text-xs text-[var(--color-text-muted)] hidden sm:inline">{{ j.triggeredBy }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">{{ formatDuration(j.durationMs) }}</span>
              <span class="text-xs text-[var(--color-text-muted)] tabular-nums">{{ formatBytes(j.archiveSizeBytes) }}</span>
            </button>
            <div v-if="expanded[j._id]" class="border-t border-[var(--color-border)] p-4 space-y-3">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <div class="label">Started</div>
                  <div>{{ formatDate(j.startedAt) }}</div>
                </div>
                <div>
                  <div class="label">Finished</div>
                  <div>{{ formatDate(j.finishedAt) }}</div>
                </div>
                <div>
                  <div class="label">Archive</div>
                  <div class="font-mono break-all">{{ j.archiveFilename || '—' }}</div>
                </div>
                <div>
                  <div class="label">Drive</div>
                  <a v-if="j.gdriveWebViewLink" :href="j.gdriveWebViewLink" target="_blank" rel="noopener" class="text-[var(--color-accent)]">Open →</a>
                  <span v-else>—</span>
                </div>
              </div>
              <div v-if="j.gdriveFileId" class="flex items-center gap-2">
                <button class="btn" :disabled="!!downloading[j._id]" @click="download(j)">
                  {{ downloading[j._id] ? '↓ Preparing…' : '↓ Download archive' }}
                </button>
                <span v-if="downloadErrors[j._id]" class="text-xs text-[var(--color-danger)]">{{ downloadErrors[j._id] }}</span>
              </div>
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <div class="label !mb-0">Log</div>
                  <NuxtLink :to="`/jobs/${j._id}`" class="text-xs text-[var(--color-accent)]">Full job page →</NuxtLink>
                </div>
                <pre class="panel p-3 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">{{ j.log || '(no log)' }}</pre>
              </div>
              <div v-if="j.error">
                <div class="label text-[var(--color-danger)]">Error</div>
                <pre class="panel p-3 text-xs text-[var(--color-danger)] whitespace-pre-wrap">{{ j.error }}</pre>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <div v-show="active === 'apikeys'" class="space-y-4">
        <div v-if="createdKey" class="panel p-6 border border-[var(--color-success)]">
          <h3 class="text-sm font-semibold mb-1">✓ Key created — copy it now</h3>
          <p class="text-sm text-[var(--color-text-muted)] mb-3">
            Only shown once. Store it as a CI secret (e.g. <code class="text-xs">BACKUP_API_KEY</code>).
          </p>
          <div class="panel-2 p-3 flex items-center gap-2 mb-4">
            <code class="font-mono text-xs text-[var(--color-accent)] break-all flex-1">{{ createdKey.key }}</code>
            <button class="btn text-xs whitespace-nowrap" @click="copyKey(createdKey.key)">{{ keyCopied ? 'Copied ✓' : 'Copy' }}</button>
          </div>
          <div class="text-xs text-[var(--color-text-muted)] mb-1">Trigger this target from anywhere:</div>
          <pre class="panel-2 p-3 font-mono text-xs overflow-x-auto whitespace-pre">{{ keyCurl(createdKey.key) }}</pre>
          <button class="btn text-xs mt-3" @click="createdKey = null">Dismiss</button>
        </div>

        <div class="panel p-6">
          <h3 class="text-sm font-semibold mb-1">Create API key</h3>
          <p class="text-sm text-[var(--color-text-muted)] mb-4">
            A machine key locked to <strong>{{ target?.name }}</strong> — it can trigger a backup of this target and nothing else.
          </p>
          <form class="space-y-3" @submit.prevent="createKey">
            <div>
              <label class="label">Name *</label>
              <input v-model="keyForm.name" class="input" required placeholder="e.g. github-actions" />
            </div>
            <div>
              <label class="label">Expires (optional)</label>
              <input v-model="keyForm.expiresAt" type="date" class="input" />
            </div>
            <button class="btn btn-primary" :disabled="keyBusy || !keyForm.name">{{ keyBusy ? 'Creating…' : 'Create key' }}</button>
            <span v-if="keyError" class="text-sm text-[var(--color-danger)] ml-2">{{ keyError }}</span>
          </form>
        </div>

        <div class="panel p-5">
          <h3 class="text-sm font-semibold mb-4">Keys for this target</h3>
          <div v-if="!keys.length" class="text-sm text-[var(--color-text-muted)] py-6 text-center">
            No API keys for this target yet.
          </div>
          <table v-else class="data">
            <thead>
              <tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Expires</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="k in keys" :key="k._id">
                <td class="font-medium">{{ k.name }}</td>
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
                  <button class="btn btn-danger text-xs" :disabled="keyRevoking[k._id]" @click="revokeKey(k)">
                    {{ keyRevoking[k._id] ? '…' : 'Revoke' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { formatBytes, formatDate, formatDuration, formatRelative } from '~/utils/format'

const route = useRoute()
const api = useApi()

interface Target {
  _id: string
  name: string
  description: string
  databaseType?: 'mongodb' | 'postgresql'
  mongoUri?: string
  includeDbs: string[]
  excludeDbs: string[]
  collectionFilter?: {
    mode: 'exclude' | 'include'
    collections: { db: string; name: string }[]
    patterns: string[]
  }
  cronExpression: string
  googleAuthId?: string
  gdriveFolderId: string
  gdriveFolderName: string
  retention: { mode: 'count' | 'days' | 'none'; keepCount: number; keepDays: number }
  enabled: boolean
  machineId?: string
  currentMachineId?: string
  machineMatches?: boolean
}

interface Job {
  _id: string
  status: string
  archiveFilename?: string
  archiveSizeBytes?: number
  durationMs?: number
  triggeredBy: string
  startedAt?: string
  finishedAt?: string
  gdriveFileId?: string
  gdriveWebViewLink?: string
  log?: string
  error?: string
}

interface ApiKeyRow {
  _id: string
  name: string
  prefix: string
  targetId: string
  scopes: string[]
  enabled: boolean
  expiresAt?: string | null
  lastUsedAt?: string | null
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

const tabs = [
  { id: 'settings', label: 'Settings' },
  { id: 'history', label: 'History' },
  { id: 'apikeys', label: 'API keys' },
] as const
const active = ref<'settings' | 'history' | 'apikeys'>('settings')

const target = ref<Target | null>(null)
const jobs = ref<Job[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref('')
const expanded = reactive<Record<string, boolean>>({})
const downloading = reactive<Record<string, boolean>>({})
const downloadErrors = reactive<Record<string, string>>({})

const keys = ref<ApiKeyRow[]>([])
const keyForm = reactive({ name: '', expiresAt: '' })
const keyBusy = ref(false)
const keyError = ref('')
const createdKey = ref<CreatedKey | null>(null)
const keyCopied = ref(false)
const keyRevoking = reactive<Record<string, boolean>>({})

function toggle(id: string) {
  expanded[id] = !expanded[id]
}

async function download(j: Job) {
  if (downloading[j._id]) return
  downloading[j._id] = true
  downloadErrors[j._id] = ''
  try {
    const res = await api.post<{ url: string; filename: string }>(`/api/jobs/${j._id}/download-url`)
    window.location.href = res.url
  } catch (err) {
    downloadErrors[j._id] = (err as Error).message || 'Failed to start download'
  } finally {
    setTimeout(() => { downloading[j._id] = false }, 800)
  }
}

async function refresh() {
  refreshing.value = true
  try {
    const id = route.params.id as string
    const [t, list, allKeys] = await Promise.all([
      api.get<Target>(`/api/targets/${id}`),
      api.get<Job[]>(`/api/jobs?targetId=${id}&limit=50`),
      api.get<ApiKeyRow[]>('/api/api-keys'),
    ])
    target.value = { ...t, mongoUri: '', googleAuthId: t.googleAuthId || undefined }
    jobs.value = list
    keys.value = allKeys.filter((k) => k.targetId === id)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function onSubmit(form: Record<string, any>) {
  busy.value = true
  error.value = ''
  try {
    await api.patch(`/api/targets/${route.params.id}`, form)
    await refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function onDelete() {
  if (!confirm(`Delete target "${target.value?.name}"? Existing backup files in Drive are not removed.`)) return
  await api.del(`/api/targets/${route.params.id}`)
  await navigateTo('/targets')
}

async function runNow() {
  await api.post(`/api/targets/${route.params.id}/run`)
  active.value = 'history'
  setTimeout(refresh, 1000)
}

function isExpired(d?: string | null) {
  return !!d && new Date(d).getTime() < Date.now()
}

function keyCurl(key: string) {
  const origin = import.meta.client ? window.location.origin : 'https://your-backup-host'
  return `curl -X POST ${origin}/api/sync \\\n  -H "X-API-Key: ${key}"`
}

async function copyKey(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    keyCopied.value = true
    setTimeout(() => { keyCopied.value = false }, 2000)
  } catch { /* clipboard unavailable */ }
}

async function createKey() {
  keyBusy.value = true
  keyError.value = ''
  try {
    const payload: Record<string, unknown> = { name: keyForm.name, targetId: route.params.id }
    if (keyForm.expiresAt) payload.expiresAt = keyForm.expiresAt
    createdKey.value = await api.post<CreatedKey>('/api/api-keys', payload)
    keyForm.name = ''
    keyForm.expiresAt = ''
    await refresh()
  } catch (err) {
    keyError.value = (err as Error).message
  } finally {
    keyBusy.value = false
  }
}

async function revokeKey(k: ApiKeyRow) {
  if (!confirm(`Revoke "${k.name}"? Any system using this key loses access immediately.`)) return
  keyRevoking[k._id] = true
  try {
    await api.del(`/api/api-keys/${k._id}`)
    await refresh()
  } finally {
    keyRevoking[k._id] = false
  }
}

onMounted(refresh)
const timer = setInterval(refresh, 8000)
onBeforeUnmount(() => clearInterval(timer))
</script>
