<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold">Dashboard</h1>
        <p class="text-sm text-[var(--color-text-muted)] mt-0.5">Backup health and recent activity</p>
      </div>
      <NuxtLink to="/targets/new" class="btn btn-primary">+ New Backup Target</NuxtLink>
    </div>

    <div class="grid grid-cols-4 gap-4 mb-6">
      <StatCard label="Success" :value="stats?.counts.success ?? 0" tone="success" />
      <StatCard label="Failed" :value="stats?.counts.failed ?? 0" tone="danger" />
      <StatCard label="Running" :value="stats?.counts.running ?? 0" tone="info" />
      <StatCard label="Active Schedules" :value="stats?.schedules.length ?? 0" />
    </div>

    <div class="panel p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold">Recent Jobs</h2>
        <NuxtLink to="/jobs" class="text-xs text-[var(--color-accent)]">View all →</NuxtLink>
      </div>
      <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>
      <div v-else-if="!jobs.length" class="text-sm text-[var(--color-text-muted)] py-6 text-center">
        No jobs yet. Create a target and run your first backup.
      </div>
      <table v-else class="data">
        <thead>
          <tr>
            <th>Target</th>
            <th>Status</th>
            <th>Trigger</th>
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

interface Stats {
  counts: Record<string, number>
  schedules: { targetId: string; cron: string }[]
}
interface JobRow {
  _id: string
  targetName: string
  status: string
  triggeredBy: string
  durationMs?: number
  archiveSizeBytes?: number
  startedAt?: string
}

const api = useApi()
const stats = ref<Stats | null>(null)
const jobs = ref<JobRow[]>([])
const loading = ref(true)

async function refresh() {
  try {
    const [s, j] = await Promise.all([
      api.get<Stats>('/api/jobs/stats'),
      api.get<JobRow[]>('/api/jobs/recent'),
    ])
    stats.value = s
    jobs.value = j
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
const t = setInterval(() => { if (!loading.value) refresh() }, 10000)
onBeforeUnmount(() => clearInterval(t))
</script>
