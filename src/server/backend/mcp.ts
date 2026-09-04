import { createMcpHandler, bearerToken, McpAuthError, type McpAuthenticator } from '@truxie/mcp'
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
  onCall: (record) => {
    const outcome = record.ok ? 'ok' : `failed ${record.status}`
    log.info(`${record.principal.id} called ${record.endpointId} — ${outcome} in ${record.durationMs}ms`)
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
