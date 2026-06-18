<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold">All Jobs</h1>
        <p class="text-sm text-[var(--color-text-muted)] mt-0.5">Backup run history</p>
      </div>
      <button class="btn" @click="refresh">↻ Refresh</button>
    </div>

    <div class="panel p-5">
      <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>
      <div v-else-if="!jobs.length" class="text-sm text-[var(--color-text-muted)] py-8 text-center">No jobs yet.</div>
      <table v-else class="data">
        <thead>
          <tr>
            <th>Target</th>
            <th>Status</th>
            <th>Trigger</th>
            <th>Reason</th>
            <th>Duration</th>
            <th>Size</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="j in jobs" :key="j._id" class="cursor-pointer" @click="navigateTo(`/jobs/${j._id}`)">
            <td>{{ j.targetName }}</td>
            <td><JobStatusBadge :status="j.status" /></td>
            <td><span class="badge">{{ j.triggeredBy }}</span></td>
            <td>
              <div
                class="max-w-[22rem] truncate text-xs text-[var(--color-text-muted)]"
                :title="j.reason || ''"
              >{{ j.reason || '—' }}</div>
            </td>
            <td>{{ formatDuration(j.durationMs) }}</td>
            <td>{{ formatBytes(j.archiveSizeBytes) }}</td>
            <td>{{ formatDate(j.startedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { formatBytes, formatDate, formatDuration } from '~/utils/format'

interface Job {
  _id: string
  targetName: string
  status: string
  triggeredBy: string
  reason?: string | null
  durationMs?: number
  archiveSizeBytes?: number
  startedAt?: string
}

const api = useApi()
const jobs = ref<Job[]>([])
const loading = ref(true)

async function refresh() {
  loading.value = true
  try { jobs.value = await api.get<Job[]>('/api/jobs?limit=200') }
  finally { loading.value = false }
}

onMounted(refresh)
</script>
