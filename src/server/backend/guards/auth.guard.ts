import type { ICanActivateGuard, ExecutionContext } from 'truxie'
import { UnauthorizedError, defineAuth, getRequestHeaders } from 'truxie'
import { verifyToken, type AuthPayload } from '~/server/utils/jwt'

export type { AuthPayload }

export const Auth = defineAuth<AuthPayload>()

// Headers are read through truxie so the guard works under every adapter: the
// Nitro dispatcher hands it an H3Event, @truxie/mcp a Web Request.
function extractBearer(ctx: ExecutionContext): string {
  const authHeader = getRequestHeaders(ctx).authorization ?? ''
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
