import type { ICanActivateGuard, ExecutionContext } from 'truxie'
import { UnauthorizedError, defineAuth } from 'truxie'
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

function getEvent(ctx: ExecutionContext): H3Event | undefined {
  return ctx.getNativeRequest() as H3Event | undefined
}

function extractKey(event: H3Event | undefined): string {
  const headers = event?.node?.req?.headers ?? {}
  const fromHeader = (headers['x-api-key'] as string | undefined) ?? ''
  const authHeader = (headers.authorization as string | undefined) ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const key = (fromHeader || bearer).trim()
  if (!key) throw new UnauthorizedError('Missing API key')
  return key
}

function clientIp(event: H3Event | undefined): string {
  const headers = event?.node?.req?.headers ?? {}
  const xff = (headers['x-forwarded-for'] as string | undefined) ?? ''
  if (xff) return xff.split(',')[0]?.trim() ?? ''
  return event?.node?.req?.socket?.remoteAddress ?? ''
}

export class ApiKeyGuard implements ICanActivateGuard {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const event = getEvent(ctx)
    const plaintext = extractKey(event)
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
      { lastUsedAt: new Date(), lastUsedIp: clientIp(event) },
    ).catch(() => {})

    return true
  }
}
