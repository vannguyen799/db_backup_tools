import type { ICanActivateGuard, ExecutionContext } from 'truxie'
import { UnauthorizedError, defineAuth } from 'truxie'
import { verifyToken, type AuthPayload } from '~/server/utils/jwt'
import type { H3Event } from 'h3'

export type { AuthPayload }

export const Auth = defineAuth<AuthPayload>()

function extractBearer(ctx: ExecutionContext): string {
  const event = ctx.getNativeRequest() as H3Event | undefined
  const headers = event?.node?.req?.headers ?? {}
  const authHeader: string = (headers.authorization as string | undefined) ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Not authorized, no token provided')
  }
  const token = authHeader.slice(7).trim()
  if (!token) throw new UnauthorizedError('Not authorized, no token provided')
  return token
}

export class AuthGuard implements ICanActivateGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const token = extractBearer(ctx)
    const decoded = verifyToken(token)
    ctx.setAuth(decoded)
    return true
  }
}
