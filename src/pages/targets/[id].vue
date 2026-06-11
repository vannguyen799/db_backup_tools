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
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { formatBytes, formatDate, formatDuration } from '~/utils/format'

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

const tabs = [
  { id: 'settings', label: 'Settings' },
  { id: 'history', label: 'History' },
] as const
const active = ref<'settings' | 'history'>('settings')

const target = ref<Target | null>(null)
const jobs = ref<Job[]>([])
const loading = ref(true)
const refreshing = ref(false)
const busy = ref(false)
const error = ref('')
const expanded = reactive<Record<string, boolean>>({})
const downloading = reactive<Record<string, boolean>>({})
const downloadErrors = reactive<Record<string, string>>({})

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
    const [t, list] = await Promise.all([
      api.get<Target>(`/api/targets/${id}`),
      api.get<Job[]>(`/api/jobs?targetId=${id}&limit=50`),
    ])
    target.value = { ...t, mongoUri: '', googleAuthId: t.googleAuthId || undefined }
    jobs.value = list
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

onMounted(refresh)
const timer = setInterval(refresh, 8000)
onBeforeUnmount(() => clearInterval(timer))
</script>
