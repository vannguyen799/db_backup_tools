import crypto from 'node:crypto'

const ALG = 'aes-256-gcm'

function keyBuf(): Buffer {
  const cfg = useRuntimeConfig()
  const raw = cfg.encryptionKey as string
  if (!raw) throw new Error('ENCRYPTION_KEY is required')
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) return Buffer.from(raw, 'hex')
  const buf = Buffer.from(raw, 'utf8')
  if (buf.length === 32) return buf
  return crypto.createHash('sha256').update(raw).digest()
}

export function encryptString(plain: string): string {
  if (!plain) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALG, keyBuf(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptString(payload: string): string {
  if (!payload) return ''
  const [v, ivB64, tagB64, dataB64] = payload.split(':')
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid ciphertext format')
  }
  const decipher = crypto.createDecipheriv(ALG, keyBuf(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}
