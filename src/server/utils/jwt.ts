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
  return jwt.verify(token, cfg.jwtSecret as string) as AuthPayload
}

export interface DownloadTokenPayload {
  jobId: string
  scope: 'download'
}

export function signDownloadToken(jobId: string, ttlSeconds = 300): string {
  const cfg = useRuntimeConfig()
  return jwt.sign({ jobId, scope: 'download' } satisfies DownloadTokenPayload, cfg.jwtSecret as string, {
    expiresIn: ttlSeconds,
  })
}

export function verifyDownloadToken(token: string): DownloadTokenPayload {
  const cfg = useRuntimeConfig()
  const decoded = jwt.verify(token, cfg.jwtSecret as string) as DownloadTokenPayload
  if (decoded?.scope !== 'download' || !decoded?.jobId) {
    throw new Error('Invalid download token')
  }
  return decoded
}
