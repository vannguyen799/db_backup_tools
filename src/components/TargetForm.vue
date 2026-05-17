<template>
  <form class="space-y-5" @submit.prevent="onSubmit">
    <div class="grid grid-cols-2 gap-5">
      <div>
        <label class="label">Name *</label>
        <input v-model="form.name" class="input" required placeholder="prod-main" />
      </div>
      <div>
        <label class="label">Schedule *</label>
        <select v-model="cronMode" class="select" @change="onCronModeChange">
          <option v-for="p in cronPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
          <option value="custom">Custom…</option>
        </select>
        <input
          v-if="cronMode === 'custom'"
          v-model="form.cronExpression"
          class="input font-mono mt-2"
          required
          placeholder="0 3 * * *"
        />
        <div class="text-xs text-[var(--color-text-muted)] mt-1">
          {{ cronHumanLabel }} <span class="opacity-70">(server timezone)</span>
        </div>
      </div>
    </div>

    <div>
      <label class="label">Description</label>
      <input v-model="form.description" class="input" placeholder="Optional" />
    </div>

    <div>
      <label class="label">MongoDB URI {{ isCreate ? '*' : '(leave blank to keep)' }}</label>
      <div class="relative">
        <input
          v-model="form.mongoUri"
          class="input font-mono pr-44"
          :required="isCreate"
          :placeholder="isCreate ? 'mongodb+srv://user:pass@host/db' : '••• unchanged'"
        />
        <span
          v-if="probeLoading"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)]"
        >Loading databases…</span>
        <span
          v-else-if="probed.length"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-accent)]"
        >{{ probed.length }} database(s) loaded</span>
      </div>
      <div class="text-xs text-[var(--color-text-muted)] mt-1">
        Encrypted at rest. If the URI ends with <code>/&lt;db&gt;</code>, that database is auto-selected.
      </div>
    </div>

    <div v-if="boundMachineId" class="panel-2 p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Machine binding</h3>
        <span
          v-if="machineMatches"
          class="badge badge-success"
        >Bound to this server</span>
        <span v-else class="badge badge-warning">⚠ Bound to another server</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <div class="label">Target's machine ID</div>
          <code class="block panel p-2 font-mono break-all">{{ boundMachineId }}</code>
        </div>
        <div>
          <div class="label">Current server</div>
          <code class="block panel p-2 font-mono break-all">{{ currentMachineId || '—' }}</code>
        </div>
      </div>
      <div class="text-xs text-[var(--color-text-muted)] mt-2">
        This target uses a local MongoDB URI (<code>localhost</code> / <code>127.0.0.1</code>), so it is pinned to the
        server where it was created. Backups will refuse to run on any other machine to avoid backing up the wrong DB.
      </div>
      <div class="flex items-center justify-end mt-3">
        <button type="button" class="btn" :disabled="busy" @click="$emit('rebind')">
          Rebind to this server
        </button>
      </div>
    </div>

    <div class="panel-2 p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Database *</h3>
        <button
          type="button"
          class="btn text-xs"
          :disabled="probeLoading || (isCreate && !form.mongoUri)"
          @click="fetchCollections"
        >
          {{ probeLoading ? 'Fetching…' : 'Fetch from source ↻' }}
        </button>
      </div>

      <div v-if="probeError" class="text-xs text-[var(--color-danger)] mb-2">{{ probeError }}</div>

      <select v-model="selectedDb" class="select" required>
        <option value="" disabled>— select a database —</option>
        <option v-if="dbFromUri && !probed.some((d) => d.name === dbFromUri)" :value="dbFromUri">
          {{ dbFromUri }} (from URI)
        </option>
        <option v-for="db in probed" :key="db.name" :value="db.name" :disabled="db.isSystem">
          {{ db.name }}{{ db.isSystem ? ' (system)' : '' }}
        </option>
      </select>
      <div v-if="dbFromUri && selectedDb === dbFromUri" class="text-xs text-[var(--color-text-muted)] mt-1">
        Detected from URI path.
      </div>
      <div v-else-if="!probed.length && isCreate" class="text-xs text-[var(--color-text-muted)] mt-1">
        Paste a MongoDB URI above to load databases.
      </div>
    </div>

    <div v-if="selectedDb" class="panel-2 p-4">
      <h3 class="text-sm font-semibold mb-3">Collections in <span class="font-mono">{{ selectedDb }}</span></h3>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <label
          class="flex items-center gap-2 panel-2 p-2 cursor-pointer text-sm"
          :class="{ 'border-[var(--color-accent)]': form.collectionFilter.mode === 'exclude' }"
        >
          <input v-model="form.collectionFilter.mode" type="radio" value="exclude" />
          <span>Backup all, exclude some</span>
        </label>
        <label
          class="flex items-center gap-2 panel-2 p-2 cursor-pointer text-sm"
          :class="{ 'border-[var(--color-accent)]': form.collectionFilter.mode === 'include' }"
        >
          <input v-model="form.collectionFilter.mode" type="radio" value="include" />
          <span>Backup only checked</span>
        </label>
      </div>

      <div v-if="!selectedDbInfo" class="text-xs text-[var(--color-text-muted)] mb-3">
        Collections not yet loaded — click "Fetch from source ↻" to list them.
      </div>
      <div v-else-if="!selectedDbInfo.collections.length" class="text-xs text-[var(--color-text-muted)] mb-3">
        No collections found in this database.
      </div>
      <div v-else class="space-y-1 mb-3 max-h-72 overflow-auto panel-2 p-3">
        <div class="flex gap-2 text-xs mb-2">
          <button type="button" class="text-[var(--color-accent)]" @click="setAllCollections(true)">all</button>
          <button type="button" class="text-[var(--color-text-muted)]" @click="setAllCollections(false)">none</button>
        </div>
        <label
          v-for="col in selectedDbInfo.collections"
          :key="col"
          class="flex items-center gap-2 text-sm cursor-pointer"
        >
          <input
            type="checkbox"
            :checked="isPicked(col)"
            @change="togglePick(col, ($event.target as HTMLInputElement).checked)"
          />
          <span class="font-mono text-xs">{{ col }}</span>
        </label>
      </div>

      <div>
        <label class="label">
          Patterns ({{ form.collectionFilter.mode === 'include' ? 'include' : 'exclude' }}, one per line)
        </label>
        <textarea
          v-model="patternsRaw"
          class="input font-mono"
          rows="3"
          placeholder="logs&#10;tmp_*&#10;staging_*"
        />
        <div class="text-xs text-[var(--color-text-muted)] mt-1">
          Collection name or prefix with trailing <code>*</code>. Scoped to <span class="font-mono">{{ selectedDb }}</span>.
          {{ form.collectionFilter.mode === 'include'
             ? 'In include mode, source is queried at backup time to expand prefix patterns.'
             : '' }}
        </div>
      </div>

      <div v-if="filterSummary" class="text-xs text-[var(--color-text-muted)] mt-3">
        {{ filterSummary }}
      </div>
    </div>

    <div class="panel-2 p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Google Drive</h3>
        <span v-if="!accounts.length" class="badge badge-warning">No accounts</span>
        <span v-else-if="!form.googleAuthId" class="badge badge-warning">No account selected</span>
        <span v-else class="badge badge-success">{{ selectedAccountLabel }}</span>
      </div>
      <div v-if="!accounts.length" class="text-sm text-[var(--color-text-muted)]">
        Connect a Google account in <NuxtLink to="/settings" class="text-[var(--color-accent)]">Settings</NuxtLink> first.
      </div>
      <div v-else class="space-y-3">
        <div>
          <label class="label">Google account *</label>
          <select v-model="form.googleAuthId" class="select" required @change="onAccountChange">
            <option value="">— select an account —</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.label ? `${a.label} (${a.email})` : a.email }}
            </option>
          </select>
        </div>
        <div v-if="form.googleAuthId" class="grid grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label class="label">Destination folder</label>
            <div class="flex gap-2">
              <select v-model="form.gdriveFolderId" class="select" @change="syncFolderName">
                <option value="">My Drive (root)</option>
                <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <button type="button" class="btn" :disabled="loadingFolders" @click="loadFolders">↻</button>
            </div>
          </div>
          <div>
            <label class="label">New folder name</label>
            <div class="flex gap-2">
              <input v-model="newFolderName" class="input" placeholder="mongo-backups" />
              <button type="button" class="btn" :disabled="!newFolderName" @click="createFolder">Create</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-2 p-4">
      <h3 class="text-sm font-semibold mb-3">Retention</h3>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="label">Mode</label>
          <select v-model="form.retention.mode" class="select">
            <option value="count">Keep last N</option>
            <option value="days">Keep N days</option>
            <option value="none">Keep all</option>
          </select>
        </div>
        <div v-if="form.retention.mode === 'count'">
          <label class="label">Keep count</label>
          <input v-model.number="form.retention.keepCount" class="input" type="number" min="1" />
        </div>
        <div v-if="form.retention.mode === 'days'">
          <label class="label">Keep days</label>
          <input v-model.number="form.retention.keepDays" class="input" type="number" min="1" />
        </div>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input v-model="form.enabled" type="checkbox" />
        Enabled (run on schedule)
      </label>
    </div>

    <div v-if="submitError" class="text-sm text-[var(--color-danger)]">{{ submitError }}</div>

    <div class="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
      <button v-if="!isCreate" type="button" class="btn btn-danger" @click="$emit('delete')">Delete target</button>
      <div class="flex gap-2 ml-auto">
        <NuxtLink to="/targets" class="btn">Cancel</NuxtLink>
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Saving…' : (isCreate ? 'Create target' : 'Save changes') }}</button>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

interface CollectionRef { db: string; name: string }
interface CollectionFilter {
  mode: 'exclude' | 'include'
  collections: CollectionRef[]
  patterns: string[]
}
interface ProbedDb { name: string; collections: string[]; isSystem: boolean }

interface TargetForm {
  _id?: string
  name: string
  description: string
  mongoUri: string
  includeDbs: string[]
  excludeDbs: string[]
  collectionFilter: CollectionFilter
  cronExpression: string
  googleAuthId: string
  gdriveFolderId: string
  gdriveFolderName: string
  retention: { mode: 'count' | 'days' | 'none'; keepCount: number; keepDays: number }
  enabled: boolean
}

interface AccountSummary {
  id: string
  label: string
  email: string
  name: string
  picture: string
  source: 'oauth' | 'manual'
}

const props = defineProps<{
  initial?: Partial<TargetForm> & {
    machineId?: string
    currentMachineId?: string
    machineMatches?: boolean
  }
  busy?: boolean
  isCreate?: boolean
}>()
const emit = defineEmits<{
  (e: 'submit', value: TargetForm): void
  (e: 'delete'): void
  (e: 'rebind'): void
}>()

const boundMachineId = computed(() => props.initial?.machineId || '')
const currentMachineId = computed(() => props.initial?.currentMachineId || '')
const machineMatches = computed(() => props.initial?.machineMatches !== false)

const api = useApi()
const folders = ref<{ id: string; name: string }[]>([])
const loadingFolders = ref(false)
const accounts = ref<AccountSummary[]>([])
const newFolderName = ref('')
const submitError = ref('')

const defaults: TargetForm = {
  name: '',
  description: '',
  mongoUri: '',
  includeDbs: [],
  excludeDbs: [],
  collectionFilter: { mode: 'exclude', collections: [], patterns: [] },
  cronExpression: '0 3 * * *',
  googleAuthId: '',
  gdriveFolderId: '',
  gdriveFolderName: '',
  retention: { mode: 'count', keepCount: 7, keepDays: 30 },
  enabled: true,
}
const incoming = (props.initial || {}) as Partial<TargetForm>
const form = reactive<TargetForm>({
  ...defaults,
  ...incoming,
  googleAuthId: incoming.googleAuthId ? String(incoming.googleAuthId) : '',
  collectionFilter: {
    mode: (incoming.collectionFilter?.mode as 'exclude' | 'include') || 'exclude',
    collections: incoming.collectionFilter?.collections ? [...incoming.collectionFilter.collections] : [],
    patterns: incoming.collectionFilter?.patterns ? [...incoming.collectionFilter.patterns] : [],
  },
})

const selectedDb = ref<string>(form.includeDbs[0] || '')

function parseDbFromUri(uri: string): string {
  const trimmed = (uri || '').trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]+)/i)
  return match && match[1] ? decodeURIComponent(match[1]) : ''
}

const dbFromUri = computed(() => parseDbFromUri(form.mongoUri))

// Patterns are entered without the `<db>.` prefix; we strip on load and add on submit.
function stripDbPrefix(patterns: string[], db: string): string[] {
  if (!db) return patterns
  const prefix = `${db}.`
  return patterns.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
}

const patternsRaw = ref(stripDbPrefix(form.collectionFilter.patterns, selectedDb.value).join('\n'))
watch(patternsRaw, (v) => {
  form.collectionFilter.patterns = v.split('\n').map((s) => s.trim()).filter(Boolean)
})

const cronPresets = [
  { value: '*/15 * * * *', label: 'Every 15 minutes', human: 'Every 15 minutes' },
  { value: '*/30 * * * *', label: 'Every 30 minutes', human: 'Every 30 minutes' },
  { value: '0 * * * *', label: 'Hourly', human: 'Every hour, on the hour' },
  { value: '0 3 * * *', label: 'Daily at 3:00 AM', human: 'Every day at 03:00' },
  { value: '0 12 * * *', label: 'Daily at noon', human: 'Every day at 12:00' },
  { value: '0 0 * * *', label: 'Daily at midnight', human: 'Every day at 00:00' },
  { value: '0 3 * * 1', label: 'Weekly (Mon 3:00 AM)', human: 'Every Monday at 03:00' },
  { value: '0 3 1 * *', label: 'Monthly (1st, 3:00 AM)', human: '1st of every month at 03:00' },
]
const cronMode = ref<string>(
  cronPresets.find((p) => p.value === form.cronExpression)?.value || 'custom',
)
function onCronModeChange() {
  if (cronMode.value !== 'custom') form.cronExpression = cronMode.value
}
const cronHumanLabel = computed(() => {
  if (cronMode.value === 'custom') {
    return form.cronExpression ? `Custom: ${form.cronExpression}` : 'Custom schedule'
  }
  return `Runs: ${cronPresets.find((p) => p.value === cronMode.value)?.human || ''}`
})

const probed = ref<ProbedDb[]>([])
const probeLoading = ref(false)
const probeError = ref('')

const selectedDbInfo = computed(() => probed.value.find((d) => d.name === selectedDb.value) || null)

const pickedSet = computed(() => {
  const s = new Set<string>()
  for (const c of form.collectionFilter.collections) {
    if (c.db === selectedDb.value) s.add(c.name)
  }
  return s
})

// `collections` stores the EXPLICIT decision the user made on items in the picker.
// In exclude mode: items in the list are EXCLUDED — checkbox checked = NOT in list.
// In include mode: items in the list are INCLUDED — checkbox checked = in list.
function isPicked(name: string) {
  const inList = pickedSet.value.has(name)
  return form.collectionFilter.mode === 'exclude' ? !inList : inList
}

function togglePick(name: string, checked: boolean) {
  const db = selectedDb.value
  if (!db) return
  const shouldBeInList = form.collectionFilter.mode === 'exclude' ? !checked : checked
  const inList = pickedSet.value.has(name)
  if (shouldBeInList && !inList) {
    form.collectionFilter.collections.push({ db, name })
  } else if (!shouldBeInList && inList) {
    form.collectionFilter.collections = form.collectionFilter.collections.filter(
      (c) => !(c.db === db && c.name === name),
    )
  }
}

function setAllCollections(checked: boolean) {
  const info = selectedDbInfo.value
  if (!info) return
  for (const c of info.collections) togglePick(c, checked)
}

const filterSummary = computed(() => {
  const c = pickedSet.value.size
  const p = form.collectionFilter.patterns.length
  if (!c && !p) return ''
  const verb = form.collectionFilter.mode === 'exclude' ? 'Excluding' : 'Including only'
  return `${verb} ${c} explicit collection(s)${p ? ` + ${p} pattern(s)` : ''}.`
})

async function fetchCollections() {
  probeLoading.value = true
  probeError.value = ''
  try {
    const body: { mongoUri?: string; targetId?: string } = {}
    if (form.mongoUri && form.mongoUri.trim()) body.mongoUri = form.mongoUri.trim()
    else if (form._id) body.targetId = form._id
    else throw new Error('Enter a MongoDB URI first')
    probed.value = await api.post<ProbedDb[]>('/api/targets/probe-collections', body)
    // Auto-select DB if URI provides one and it exists in probe.
    if (!selectedDb.value) {
      const fromUri = dbFromUri.value
      if (fromUri && probed.value.some((d) => d.name === fromUri)) {
        selectedDb.value = fromUri
      } else {
        const nonSystem = probed.value.filter((d) => !d.isSystem)
        if (nonSystem.length === 1 && nonSystem[0]) selectedDb.value = nonSystem[0].name
      }
    }
  } catch (err) {
    probeError.value = (err as Error).message
  } finally {
    probeLoading.value = false
  }
}

let uriDebounce: ReturnType<typeof setTimeout> | null = null
watch(() => form.mongoUri, (uri) => {
  if (uriDebounce) clearTimeout(uriDebounce)
  const trimmed = (uri || '').trim()
  if (!trimmed || !/^mongodb(\+srv)?:\/\/.+/.test(trimmed)) return
  // If URI has an explicit DB, prefer it as selectedDb (only when user hasn't picked another).
  const fromUri = parseDbFromUri(trimmed)
  if (fromUri && !selectedDb.value) selectedDb.value = fromUri
  uriDebounce = setTimeout(() => { fetchCollections() }, 700)
})

// Reset explicit collection picks when DB changes to avoid mixing across DBs.
watch(selectedDb, (next, prev) => {
  if (prev && next !== prev) {
    form.collectionFilter.collections = form.collectionFilter.collections.filter((c) => c.db === next)
  }
})

function syncFolderName() {
  const f = folders.value.find((x) => x.id === form.gdriveFolderId)
  form.gdriveFolderName = f?.name || ''
}

const selectedAccountLabel = computed(() => {
  const a = accounts.value.find((x) => x.id === form.googleAuthId)
  if (!a) return ''
  return a.label ? `${a.label} (${a.email})` : a.email
})

async function loadFolders() {
  if (!form.googleAuthId) {
    folders.value = []
    return
  }
  loadingFolders.value = true
  try {
    folders.value = await api.get(`/api/gdrive/folders?accountId=${encodeURIComponent(form.googleAuthId)}`)
  } finally {
    loadingFolders.value = false
  }
}

async function createFolder() {
  if (!newFolderName.value || !form.googleAuthId) return
  const f = await api.post<{ id: string; name: string }>('/api/gdrive/folders', {
    accountId: form.googleAuthId,
    name: newFolderName.value,
  })
  await loadFolders()
  form.gdriveFolderId = f.id
  form.gdriveFolderName = f.name
  newFolderName.value = ''
}

function onAccountChange() {
  form.gdriveFolderId = ''
  form.gdriveFolderName = ''
  folders.value = []
  if (form.googleAuthId) loadFolders()
}

function onSubmit() {
  submitError.value = ''
  if (!selectedDb.value) {
    submitError.value = 'Pick a database to back up.'
    return
  }
  const db = selectedDb.value
  const prefix = `${db}.`
  const patterns = form.collectionFilter.patterns.map((p) =>
    p.includes('.') ? p : prefix + p,
  )
  const collections = form.collectionFilter.collections.filter((c) => c.db === db)
  emit('submit', {
    ...form,
    includeDbs: [db],
    excludeDbs: [],
    collectionFilter: {
      mode: form.collectionFilter.mode,
      collections,
      patterns,
    },
  })
}

onMounted(async () => {
  try {
    accounts.value = await api.get<AccountSummary[]>('/api/gdrive/accounts')
    if (form.googleAuthId) await loadFolders()
  } catch { /* ignore */ }
})
</script>
