import {
  createMcpHandler,
  bearerToken,
  loggerActivitySink,
  DEFAULT_REDACT_KEYS,
  McpAuthError,
  type McpAuthenticator,
} from '@truxie/mcp'
import { app } from './app'
import { verifyToken } from '~/server/utils/jwt'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('Mcp')

const cfg = useRuntimeConfig()

export const mcpEnabled = Boolean(cfg.mcpEnabled)

/**
 * The dashboard's own login token is the MCP credential.
 *
 * Verifying here is not the security boundary — `AuthGuard` re-reads the same
 * header when the call is dispatched, exactly as it does over HTTP. What this
 * buys is a 401 before dispatch, a named principal for `whoami`, and an audit
 * line that says who called rather than "someone with a token".
 *
 * Add a second authenticator to this chain for headless automation; they are
 * tried in order and `null` means "not mine, try the next one".
 */
const dashboardJwt: McpAuthenticator = (request) => {
  const token = bearerToken(request)
  if (!token) return null

  let claims
  try {
    claims = verifyToken(token)
  } catch {
    // Reject rather than decline: a malformed token must never fall through to
    // a weaker scheme further down the chain.
    throw new McpAuthError('Invalid or expired token. Sign in again with POST /api/auth/login.')
  }

  return {
    id: claims.id,
    kind: 'dashboard-jwt',
    name: claims.email,
    // Forwarded verbatim so the guard chain authenticates the call itself.
    headers: { authorization: `Bearer ${token}` },
  }
}

export const mcpHandler = createMcpHandler({
  app,
  serverInfo: { name: 'backup-tools', version: '0.1.0' },
  authenticate: [dashboardJwt],
  // One line per MCP request: initialize, listings, every call, calls refused
  // before dispatch (read_only / needs_confirm / unknown tool) and
  // unauthenticated attempts. This is the who-did-what trail for runs and
  // target edits and supersedes the old `onCall` line, which only saw
  // dispatched calls. BackupJob is a backup-run log with no place for
  // per-request rows, so this goes to the logger rather than a new collection.
  activity: loggerActivitySink(log),
  // Arguments reach the activity record only after redaction. Connection
  // strings (`mongoUri`, DSNs, database URLs) and Google/S3-style keys carry
  // credentials but don't match the default credential key list.
  redact: {
    keys: [
      ...DEFAULT_REDACT_KEYS,
      'uri',
      'dsn',
      'connection',
      'databaseurl',
      'database_url',
      'accesskey',
      'access_key',
      'secretkey',
      'clientsecret',
      'refreshtoken',
    ],
  },
})

export function logMcpCatalog(): void {
  if (!mcpEnabled) {
    log.info('MCP endpoint disabled (MCP_ENABLED=false)')
    return
  }
  const { endpoints } = mcpHandler.catalog
  const writes = endpoints.filter((e) => e.write).length
  log.info(`MCP ready at POST /mcp — ${endpoints.length} endpoints exposed (${writes} of them writes)`)
}
