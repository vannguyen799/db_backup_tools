<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <h1 class="text-xl font-semibold">MCP Connection</h1>
      <span class="badge" :class="statusBadgeClass">{{ statusLabel }}</span>
    </div>
    <p class="text-sm text-[var(--color-text-muted)] mb-6 max-w-3xl">
      Point Claude Code (or any MCP client) at this dashboard so an agent can list targets, inspect jobs
      and trigger backups through the same API — and the same permission checks — the UI uses.
    </p>

    <!-- 1 · Endpoint -->
    <div class="panel p-6 max-w-3xl mb-4">
      <h2 class="text-sm font-semibold mb-1">1 · The endpoint</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-3">
        One HTTP endpoint, no session state. Edit the host if your client reaches this app on a different
        address than your browser does (a tunnel, a reverse proxy, a LAN IP).
      </p>
      <div class="flex items-center gap-2 mb-3">
        <input v-model="mcpUrl" class="input font-mono text-xs" spellcheck="false" />
        <button class="btn text-xs whitespace-nowrap" @click="copy(mcpUrl, 'url')">
          {{ copiedKey === 'url' ? 'Copied ✓' : 'Copy' }}
        </button>
      </div>

      <div class="flex items-center gap-3">
        <button class="btn btn-primary text-xs" :disabled="testing" @click="testConnection">
          {{ testing ? 'Testing…' : 'Test connection' }}
        </button>
        <span class="text-xs" :class="testToneClass">{{ testMessage }}</span>
      </div>
      <p v-if="originDiffers" class="text-xs text-[var(--color-warning)] mt-2">
        ⚠ The test always runs against <code>{{ browserMcpUrl }}</code> — the address this browser
        loaded — not the URL above.
      </p>
    </div>

    <!-- 2 · Token -->
    <div class="panel p-6 max-w-3xl mb-4">
      <h2 class="text-sm font-semibold mb-1">2 · The token</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-3">
        MCP takes the same session JWT as the HTTP API — the one this browser is signed in with. Every
        call an agent makes runs as <strong>{{ auth.user?.email || 'you' }}</strong> and is re-checked by
        the same guards, so an agent can reach nothing you could not.
      </p>

      <div class="panel-2 p-3 flex items-center gap-2 mb-2">
        <code class="font-mono text-xs text-[var(--color-accent)] break-all flex-1">{{ tokenDisplay }}</code>
        <button class="btn text-xs whitespace-nowrap" @click="showToken = !showToken">
          {{ showToken ? 'Hide' : 'Reveal' }}
        </button>
        <button class="btn text-xs whitespace-nowrap" :disabled="!auth.token" @click="copy(auth.token, 'token')">
          {{ copiedKey === 'token' ? 'Copied ✓' : 'Copy' }}
        </button>
      </div>
      <div class="text-xs text-[var(--color-text-muted)] mb-4">
        <span v-if="tokenExpiry" :class="expired ? 'text-[var(--color-danger)]' : ''">
          Expires {{ formatDate(tokenExpiry) }} — {{ expiryHint }}.
        </span>
        <span v-else>Session token.</span>
        Treat it like a password — it carries your full dashboard access until it expires. Sign out and
        back in to mint a fresh one; there is no revoke for session tokens.
      </div>

      <details class="text-sm">
        <summary class="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          Getting a token without the browser (CI, a headless box)
        </summary>
        <pre class="panel-2 p-3 font-mono text-xs overflow-x-auto whitespace-pre mt-2">{{ loginSnippet }}</pre>
      </details>
    </div>

    <!-- 3 · Client config -->
    <div class="panel p-6 max-w-3xl mb-4">
      <h2 class="text-sm font-semibold mb-1">3 · Add it to your client</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-4">
        Pick your client. The snippet already carries the endpoint above.
      </p>

      <div class="flex flex-wrap border-b border-[var(--color-border)] mb-4">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="px-3 py-2 text-sm border-b-2 transition-colors"
          :class="tab === t.id ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-transparent text-[var(--color-text-muted)]'"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </div>

      <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-3 cursor-pointer">
        <input v-model="inlineToken" type="checkbox" class="accent-[var(--color-accent)]" :disabled="!auth.token" />
        Paste my token into the snippet instead of a placeholder
      </label>

      <p class="text-sm text-[var(--color-text-muted)] mb-2">{{ activeTab.hint }}</p>
      <div class="relative">
        <pre class="panel-2 p-3 pr-24 font-mono text-xs overflow-x-auto whitespace-pre">{{ activeSnippet }}</pre>
        <button class="btn text-xs absolute top-2 right-2" @click="copy(activeSnippet, 'snippet')">
          {{ copiedKey === 'snippet' ? 'Copied ✓' : 'Copy' }}
        </button>
      </div>
      <p v-if="activeTab.note" class="text-xs text-[var(--color-text-muted)] mt-2">{{ activeTab.note }}</p>
    </div>

    <!-- What the agent gets -->
    <div class="panel p-6 max-w-3xl mb-4">
      <h2 class="text-sm font-semibold mb-1">What the agent gets</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-3">
        Four generic tools, not one per route — the agent fetches the catalog when it needs it instead of
        carrying every endpoint in its context. Exposure is opt-in per route, so a controller nobody
        exposed is invisible and uncallable.
      </p>

      <div v-if="tools.length" class="space-y-2 mb-4">
        <div v-for="t in tools" :key="t.name" class="panel-2 p-3">
          <code class="text-xs text-[var(--color-accent)]">{{ t.name }}</code>
          <p class="text-xs text-[var(--color-text-muted)] mt-1">{{ t.description }}</p>
        </div>
      </div>
      <div v-else class="text-sm text-[var(--color-text-muted)] mb-4">
        Run <strong>Test connection</strong> above to read the live tool list and catalog.
      </div>

      <div v-if="catalogText">
        <div class="text-xs text-[var(--color-text-muted)] mb-1">
          Endpoints reachable with your credentials, straight from <code>list_endpoints</code>:
        </div>
        <pre class="panel-2 p-3 font-mono text-xs overflow-auto whitespace-pre max-h-96">{{ catalogText }}</pre>
      </div>
    </div>

    <!-- Troubleshooting -->
    <div class="panel p-6 max-w-3xl">
      <h2 class="text-sm font-semibold mb-3">When it does not connect</h2>
      <table class="data">
        <thead>
          <tr><th>Symptom</th><th>Cause</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code class="text-xs">404</code></td>
            <td>The endpoint is switched off — the server runs with <code class="text-xs">MCP_ENABLED=false</code>.</td>
          </tr>
          <tr>
            <td><code class="text-xs">401</code></td>
            <td>Token missing, malformed or expired. Sign out and in again, then re-copy it.</td>
          </tr>
          <tr>
            <td><code class="text-xs">403</code> on one call</td>
            <td>Auth worked; that route's guard refused this account. Nothing to fix in the MCP config.</td>
          </tr>
          <tr>
            <td>Connection refused / timeout</td>
            <td>The client cannot reach the host. <code class="text-xs">localhost</code> means the client's own machine — use a reachable address for a remote client.</td>
          </tr>
          <tr>
            <td>Tools missing after an edit</td>
            <td>Clients read their MCP config at startup. Restart the client (Claude Code: <code class="text-xs">/mcp</code> to check).</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { formatDate } from '~/utils/format'

interface McpTool { name: string; description?: string }

// Written as a plain string so it survives into the snippets verbatim: this is
// Claude Code's own env interpolation, not ours.
const ENV_REF = '${BACKUP_TOOLS_TOKEN}'
const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>'

const auth = useAuthStore()
const config = useRuntimeConfig()

const mcpUrl = ref('')
const browserMcpUrl = ref('')
const showToken = ref(false)
const inlineToken = ref(false)
const copiedKey = ref('')
const tab = ref('claude-code')

const testing = ref(false)
const testMessage = ref('Not tested yet.')
const status = ref<'unknown' | 'ok' | 'disabled' | 'unauthorized' | 'error'>('unknown')
const tools = ref<McpTool[]>([])
const catalogText = ref('')

const originDiffers = computed(() => !!browserMcpUrl.value && mcpUrl.value !== browserMcpUrl.value)

const statusLabel = computed(() => ({
  unknown: 'not tested',
  ok: 'connected',
  disabled: 'disabled on server',
  unauthorized: 'token rejected',
  error: 'unreachable',
}[status.value]))

const statusBadgeClass = computed(() => ({
  unknown: '',
  ok: 'badge-success',
  disabled: 'badge-warning',
  unauthorized: 'badge-danger',
  error: 'badge-danger',
}[status.value]))

const testToneClass = computed(() =>
  status.value === 'ok'
    ? 'text-[var(--color-success)]'
    : status.value === 'unknown'
      ? 'text-[var(--color-text-muted)]'
      : 'text-[var(--color-danger)]',
)

const tokenDisplay = computed(() => {
  if (!auth.token) return 'No session token — sign in again.'
  if (showToken.value) return auth.token
  return `${auth.token.slice(0, 12)}${'•'.repeat(28)}${auth.token.slice(-6)}`
})

/** `exp` off the JWT payload, purely to warn before a token dies mid-session. */
const tokenExpiry = computed(() => {
  const payload = auth.token.split('.')[1]
  if (!payload) return ''
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : ''
  } catch {
    return ''
  }
})

const expired = computed(() => !!tokenExpiry.value && new Date(tokenExpiry.value).getTime() < Date.now())

const expiryHint = computed(() => {
  if (!tokenExpiry.value) return ''
  const ms = new Date(tokenExpiry.value).getTime() - Date.now()
  if (ms <= 0) return 'already expired, sign in again'
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return `in ${Math.max(1, Math.floor(ms / 60_000))} minutes`
  if (hours < 48) return `in ${hours} hours`
  return `in ${Math.floor(hours / 24)} days`
})

/** The literal token when the user asked for it, a placeholder otherwise. */
function tokenFor(placeholder: string) {
  return inlineToken.value && auth.token ? auth.token : placeholder
}

const loginSnippet = computed(() => {
  const origin = mcpUrl.value.replace(/\/mcp$/, '') || 'https://backup.example.com'
  return [
    `TOKEN=$(curl -fsS -X POST ${origin}/api/auth/login \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '{"email":"${auth.user?.email || 'admin@local'}","password":"…"}' | jq -r .data.token)`,
  ].join('\n')
})

/** Also the fallback, so `activeTab` is never undefined. */
const DEFAULT_TAB = {
  id: 'claude-code',
  label: 'Claude Code',
  hint: 'Registers the server for every project on this machine.',
  note: 'Check it with /mcp inside Claude Code. Drop --scope user to register it for the current project only.',
}

const tabs = [
  DEFAULT_TAB,
  {
    id: 'mcp-json',
    label: '.mcp.json',
    hint: 'Checked into a repo, shared with everyone working on it — the token stays in the environment, never in the file.',
    note: 'This repo already ships exactly this file; exporting the two variables is all it needs.',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    hint: 'Claude Desktop speaks stdio, so mcp-remote bridges it to the HTTP endpoint.',
    note: 'macOS: ~/Library/Application Support/Claude/claude_desktop_config.json · Windows: %APPDATA%\\Claude\\claude_desktop_config.json. Restart the app after saving.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    hint: 'Global at ~/.cursor/mcp.json, or per-project at .cursor/mcp.json.',
    note: '',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    hint: 'Workspace file .vscode/mcp.json — note the key is "servers", not "mcpServers".',
    note: '',
  },
  {
    id: 'curl',
    label: 'curl',
    hint: 'No client at all — the raw JSON-RPC call, which is what the button above sends.',
    note: '',
  },
]

const activeTab = computed(() => tabs.find((t) => t.id === tab.value) ?? DEFAULT_TAB)

const snippets = computed<Record<string, string>>(() => {
  const url = mcpUrl.value
  const shellToken = tokenFor('$BACKUP_TOOLS_TOKEN')
  const literalToken = tokenFor(TOKEN_PLACEHOLDER)
  const exportLine = inlineToken.value ? '' : `export BACKUP_TOOLS_TOKEN="<paste the token from step 2>"\n\n`

  return {
    'claude-code':
      `${exportLine}claude mcp add --transport http --scope user backup-tools ${url} \\\n` +
      `  --header "Authorization: Bearer ${shellToken}"`,

    'mcp-json':
      `# .mcp.json (repo root)\n` +
      JSON.stringify(
        {
          mcpServers: {
            'backup-tools': {
              type: 'http',
              url: `\${BACKUP_TOOLS_MCP_URL:-${url}}`,
              headers: { Authorization: `Bearer ${ENV_REF}` },
            },
          },
        },
        null,
        2,
      ) +
      `\n\n# then, in the shell that starts the client:\n` +
      `export BACKUP_TOOLS_TOKEN="${inlineToken.value && auth.token ? auth.token : '<paste the token from step 2>'}"\n` +
      `export BACKUP_TOOLS_MCP_URL="${url}"   # optional, the default above is used otherwise`,

    'claude-desktop': JSON.stringify(
      {
        mcpServers: {
          'backup-tools': {
            command: 'npx',
            args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
            env: { AUTH_HEADER: `Bearer ${literalToken}` },
          },
        },
      },
      null,
      2,
    ),

    cursor: JSON.stringify(
      {
        mcpServers: {
          'backup-tools': {
            url,
            headers: { Authorization: `Bearer ${literalToken}` },
          },
        },
      },
      null,
      2,
    ),

    vscode: JSON.stringify(
      {
        servers: {
          'backup-tools': {
            type: 'http',
            url,
            headers: { Authorization: `Bearer ${literalToken}` },
          },
        },
      },
      null,
      2,
    ),

    curl:
      `${exportLine}curl -sS -X POST ${url} \\\n` +
      `  -H "Authorization: Bearer ${shellToken}" \\\n` +
      `  -H 'content-type: application/json' \\\n` +
      `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  }
})

const activeSnippet = computed(() => snippets.value[tab.value] || '')

async function copy(text: string, key: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 2000)
  } catch { /* clipboard unavailable */ }
}

/** One JSON-RPC round trip against this origin's own /mcp. */
async function rpc(method: string, params?: Record<string, unknown>) {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function testConnection() {
  testing.value = true
  tools.value = []
  catalogText.value = ''
  try {
    const { status: code, body } = await rpc('tools/list')

    if (code === 404) {
      status.value = 'disabled'
      testMessage.value = '404 — the server runs with MCP_ENABLED=false. No client can connect until that changes.'
      return
    }
    if (code === 401 || code === 403) {
      status.value = 'unauthorized'
      testMessage.value = `${code} — ${body?.error_description || 'token rejected'}. Sign out and in again for a fresh one.`
      return
    }
    if (body?.error) {
      status.value = 'error'
      testMessage.value = `The endpoint answered with an error: ${body.error.message || 'unknown'}`
      return
    }
    if (!body?.result?.tools) {
      status.value = 'error'
      testMessage.value = `Unexpected reply (HTTP ${code}). Is something other than this app serving /mcp?`
      return
    }

    tools.value = body.result.tools
    status.value = 'ok'
    testMessage.value = `✓ Connected as ${auth.user?.email || 'this account'} — ${tools.value.length} tools available.`

    // The catalog is the interesting half: which routes this account may reach.
    const catalog = await rpc('tools/call', { name: 'list_endpoints', arguments: { limit: 200 } })
    const text = catalog.body?.result?.content?.[0]?.text
    if (typeof text === 'string') catalogText.value = text
  } catch (err) {
    status.value = 'error'
    testMessage.value = `Could not reach /mcp: ${(err as Error).message}`
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  const origin = window.location.origin
  browserMcpUrl.value = `${origin}/mcp`
  // Prefer the configured public URL — that is the address a remote client uses,
  // while the browser may well be on localhost through a tunnel.
  const configured = (config.public.appUrl as string || '').replace(/\/$/, '')
  mcpUrl.value = configured ? `${configured}/mcp` : browserMcpUrl.value
})
</script>
