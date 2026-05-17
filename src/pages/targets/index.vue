<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold">Backup Targets</h1>
        <p class="text-sm text-[var(--color-text-muted)] mt-0.5">MongoDB sources to dump and ship to Drive</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn" :disabled="refreshing" @click="refresh">{{ refreshing ? '↻ Refreshing…' : '↻ Refresh' }}</button>
        <NuxtLink to="/targets/new" class="btn btn-primary">+ New Target</NuxtLink>
      </div>
    </div>

    <div class="panel p-5">
      <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading...</div>
      <div v-else-if="!targets.length" class="text-sm text-[var(--color-text-muted)] py-8 text-center">
        No targets yet. <NuxtLink to="/targets/new" class="text-[var(--color-accent)]">Create one →</NuxtLink>
      </div>
      <table v-else class="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Cron</th>
            <th>GDrive Folder</th>
            <th>Retention</th>
            <th>Enabled</th>
            <th>Last Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in targets"
            :key="t._id"
            class="cursor-pointer"
            @click="navigateTo(`/targets/${t._id}`)"
          >
            <td>
              <span class="text-[var(--color-accent)]">{{ t.name }}</span>
              <div v-if="t.description" class="text-xs text-[var(--color-text-muted)] mt-0.5">{{ t.description }}</div>
            </td>
            <td><code class="text-xs">{{ t.cronExpression }}</code></td>
            <td>{{ t.gdriveFolderName || 'My Drive' }}</td>
            <td>{{ retentionLabel(t.retention) }}</td>
            <td>
              <span class="badge" :class="t.enabled ? 'badge-success' : ''">{{ t.enabled ? 'on' : 'off' }}</span>
            </td>
            <td><JobStatusBadge v-if="t.lastJobStatus" :status="t.lastJobStatus" /></td>
            <td class="text-right">
              <button class="btn" :disabled="running[t._id]" @click.stop="runNow(t._id)">
                {{ running[t._id] ? 'Running…' : 'Run' }}
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

interface Retention { mode: string; keepCount?: number; keepDays?: number }
interface Target {
  _id: string
  name: string
  description: string
  cronExpression: string
  gdriveFolderId: string
  gdriveFolderName: string
  retention: Retention
  enabled: boolean
  lastJobStatus?: string
}

const api = useApi()
const targets = ref<Target[]>([])
const loading = ref(true)
const refreshing = ref(false)
const running = reactive<Record<string, boolean>>({})

async function refresh() {
  refreshing.value = true
  try {
    targets.value = await api.get<Target[]>('/api/targets')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function runNow(id: string) {
  running[id] = true
  try {
    await api.post(`/api/targets/${id}/run`)
    await refresh()
  } finally {
    setTimeout(() => { running[id] = false }, 2000)
  }
}

function retentionLabel(r: Retention) {
  if (!r || r.mode === 'none') return 'keep all'
  if (r.mode === 'count') return `keep last ${r.keepCount}`
  if (r.mode === 'days') return `keep ${r.keepDays}d`
  return '—'
}

onMounted(refresh)
</script>
