import type { ICanActivateGuard, ExecutionContext } from 'truxie'
import { Injectable, Inject, UnauthorizedError, ForbiddenError, defineAuth, getRequestHeaders } from 'truxie'
import type { H3Event } from 'h3'
import { ApiKeyRepository } from '../domain/api-key.repository'

export interface ApiKeyContext {
  keyId: string
  targetId: string
  scopes: string[]
}

// Scopes a key can carry. `sync:run` implies `sync:read` — a key allowed to start a
// backup may always read back the job it started.
export const SCOPE_RUN = 'sync:run'
export const SCOPE_READ = 'sync:read'

/**
 * Enforce that the calling key carries one of `allowed`. Scopes are stored per key
 * and surfaced in the UI, so they have to actually gate something.
 */
export function assertScope(key: ApiKeyContext, ...allowed: string[]): void {
  const scopes = key.scopes || []
  if (!allowed.some((s) => scopes.includes(s))) {
    throw new ForbiddenError(`API key lacks the required scope (${allowed.join(' or ')})`)
  }
}

// Param accessor: `@ApiKeyAuth() key: ApiKeyContext` inside ApiKeyGuard-protected routes.
export const ApiKeyAuth = defineAuth<ApiKeyContext>()

// Headers come through truxie so the guard works under every adapter: the
// Nitro dispatcher hands it an H3Event, @truxie/mcp a Web Request.
function extractKey(headers: Record<string, string>): string {
  const fromHeader = headers['x-api-key'] ?? ''
  const authHeader = headers.authorization ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const key = (fromHeader || bearer).trim()
  if (!key) throw new UnauthorizedError('Missing API key')
  return key
}

function clientIp(ctx: ExecutionContext, headers: Record<string, string>): string {
  const xff = headers['x-forwarded-for'] ?? ''
  if (xff) return xff.split(',')[0]?.trim() ?? ''
  const event = ctx.getNativeRequest() as H3Event | undefined
  return event?.node?.req?.socket?.remoteAddress ?? ''
}

@Injectable()
@Inject(ApiKeyRepository)
export class ApiKeyGuard implements ICanActivateGuard {
  constructor(private readonly keys: ApiKeyRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const headers = getRequestHeaders(ctx)
    const plaintext = extractKey(headers)
    const doc = await this.keys.findByPlaintext(plaintext)

    if (!doc || !doc.enabled) throw new UnauthorizedError('Invalid API key')
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('API key expired')
    }

    ctx.setAuth({
      keyId: String(doc._id),
      targetId: String(doc.targetId),
      scopes: doc.scopes,
    } satisfies ApiKeyContext)

    // Usage tracking — best-effort, must not block or fail the request.
    this.keys.touch(String(doc._id), clientIp(ctx, headers)).catch(() => {})

    return true
  }
}
