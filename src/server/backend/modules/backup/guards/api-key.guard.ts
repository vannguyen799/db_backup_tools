import type { ICanActivateGuard, ExecutionContext } from 'truxie'
import { UnauthorizedError, defineAuth, getRequestHeaders } from 'truxie'
import type { H3Event } from 'h3'
import { ApiKey } from '../domain/api-key.model'
import { hashApiKey } from '~/server/utils/api-key.util'

export interface ApiKeyContext {
  keyId: string
  targetId: string
  scopes: string[]
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

export class ApiKeyGuard implements ICanActivateGuard {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const headers = getRequestHeaders(ctx)
    const plaintext = extractKey(headers)
    const doc = await ApiKey.findOne({ keyHash: hashApiKey(plaintext) })

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
    ApiKey.updateOne(
      { _id: doc._id },
      { lastUsedAt: new Date(), lastUsedIp: clientIp(ctx, headers) },
    ).catch(() => {})

    return true
  }
}
