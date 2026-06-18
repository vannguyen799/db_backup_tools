<template>
  <div>
    <NuxtLink to="/jobs" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">← Back to jobs</NuxtLink>
    <div class="flex items-center justify-between mt-2 mb-1">
      <h1 class="text-xl font-semibold">Job</h1>
      <button class="btn" :disabled="refreshing" @click="refresh">{{ refreshing ? '↻ Refreshing…' : '↻ Refresh' }}</button>
    </div>
    <p v-if="job" class="text-sm text-[var(--color-text-muted)] mb-6">{{ job.targetName }} · {{ formatDate(job.startedAt) }}</p>

    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>
    <div v-else-if="job" class="grid grid-cols-[2fr_1fr] gap-6">
      <div class="panel p-5">
        <h2 class="text-sm font-semibold mb-3">Log</h2>
        <pre class="panel-2 p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[600px] overflow-y-auto">{{ job.log || '(no log)' }}</pre>
        <div v-if="job.error" class="mt-3">
          <h3 class="text-sm font-semibold text-[var(--color-danger)] mb-2">Error</h3>
          <pre class="panel-2 p-4 text-xs text-[var(--color-danger)] whitespace-pre-wrap">{{ job.error }}</pre>
        </div>
      </div>

      <div class="panel p-5 space-y-3 text-sm">
        <div>
          <div class="label">Status</div>
          <JobStatusBadge :status="job.status" />
        </div>
        <div>
          <div class="label">Trigger</div>
          <span class="badge">{{ job.triggeredBy }}</span>
        </div>
        <div v-if="job.reason">
          <div class="label">Reason</div>
          <div class="text-xs">{{ job.reason }}</div>
        </div>
        <div>
          <div class="label">Started</div>
          <div>{{ formatDate(job.startedAt) }}</div>
        </div>
        <div>
          <div class="label">Finished</div>
          <div>{{ formatDate(job.finishedAt) }}</div>
        </div>
        <div>
          <div class="label">Duration</div>
          <div>{{ formatDuration(job.durationMs) }}</div>
        </div>
        <div>
          <div class="label">Archive</div>
          <div class="font-mono text-xs">{{ job.archiveFilename || '—' }}</div>
          <div class="text-xs text-[var(--color-text-muted)]">{{ formatBytes(job.archiveSizeBytes) }}</div>
        </div>
        <div v-if="job.gdriveWebViewLink">
          <div class="label">Google Drive</div>
          <a :href="job.gdriveWebViewLink" target="_blank" rel="noopener" class="text-[var(--color-accent)] text-xs">Open in Drive →</a>
        </div>
        <div v-if="job.gdriveFileId">
          <div class="label">Download</div>
          <button class="btn" :disabled="downloading" @click="download">
            {{ downloading ? '↓ Preparing…' : '↓ Download archive' }}
          </button>
          <div v-if="downloadError" class="mt-2 text-xs text-[var(--color-danger)]">{{ downloadError }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { formatBytes, formatDate, formatDuration } from '~/utils/format'

const route = useRoute()
const api = useApi()
const job = ref<Record<string, any> | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const downloading = ref(false)
const downloadError = ref('')

async function download() {
  if (downloading.value) return
  downloading.value = true
  downloadError.value = ''
  try {
    const res = await api.post<{ url: string; filename: string }>(`/api/jobs/${route.params.id}/download-url`)
    window.location.href = res.url
  } catch (err) {
    downloadError.value = (err as Error).message || 'Failed to start download'
  } finally {
    setTimeout(() => { downloading.value = false }, 800)
  }
}

async function refresh() {
  refreshing.value = true
  try {
    job.value = await api.get(`/api/jobs/${route.params.id}`)
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  try { await refresh() } finally { loading.value = false }
})
const t = setInterval(async () => {
  if (!job.value) return
  if (job.value.status === 'running' || job.value.status === 'pending') await refresh()
}, 3000)
onBeforeUnmount(() => clearInterval(t))
</script>
