import crypto from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'

export interface AuthPayload {
  id: string
  email: string
  role: 'admin'
}

export function signToken(payload: AuthPayload): string {
  const cfg = useRuntimeConfig()
  const opts: SignOptions = { expiresIn: (cfg.jwtExpire as SignOptions['expiresIn']) || '30d' }
  return jwt.sign(payload, cfg.jwtSecret as string, opts)
}

export function verifyToken(token: string): AuthPayload {
  const cfg = useRuntimeConfig()
  const decoded = jwt.verify(token, cfg.jwtSecret as string) as Partial<AuthPayload> & { scope?: string }
  // Only a full session token may authorize the dashboard API. Tokens minted for a
  // narrower purpose carry a `scope` and no identity — reject them here so one can
  // never be replayed as a login.
  if (decoded?.scope !== undefined || !decoded?.id || decoded?.role !== 'admin') {
    throw new Error('Not a session token')
  }
  return decoded as AuthPayload
}

export interface DownloadTokenPayload {
  jobId: string
  scope: 'download'
}

/**
 * Download links carry their token in the URL, so it lands in browser history,
 * proxy logs and Referer headers. They are signed with a key *derived from* — and
 * never equal to — the session secret, so a leaked link cannot be presented as a
 * `Bearer` token against the rest of the API.
 */
function downloadSecret(): string {
  const cfg = useRuntimeConfig()
  return crypto
    .createHmac('sha256', cfg.jwtSecret as string)
    .update('backup-download-token/v1')
    .digest('hex')
}

export function signDownloadToken(jobId: string, ttlSeconds = 300): string {
  return jwt.sign({ jobId, scope: 'download' } satisfies DownloadTokenPayload, downloadSecret(), {
    expiresIn: ttlSeconds,
  })
}

export function verifyDownloadToken(token: string): DownloadTokenPayload {
  const decoded = jwt.verify(token, downloadSecret()) as DownloadTokenPayload
  if (decoded?.scope !== 'download' || !decoded?.jobId) {
    throw new Error('Invalid download token')
  }
  return decoded
}
