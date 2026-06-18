import crypto from 'node:crypto'

// Non-secret marker so leaked keys are recognisable and greppable in logs/secrets scanners.
const KEY_PREFIX = 'bk_live_'
// How many chars of the plaintext to keep as a non-secret display prefix.
const DISPLAY_PREFIX_LEN = KEY_PREFIX.length + 8

export interface GeneratedApiKey {
  plaintext: string
  keyHash: string
  prefix: string
}

/**
 * Generate a fresh API key. The plaintext is returned exactly once to the
 * caller; only `keyHash` + `prefix` should ever be persisted.
 */
export function generateApiKey(): GeneratedApiKey {
  const secret = crypto.randomBytes(24).toString('base64url') // 192 bits of entropy
  const plaintext = `${KEY_PREFIX}${secret}`
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LEN),
  }
}

/**
 * Deterministic SHA-256 of the key, used for constant-cost indexed lookups.
 * High-entropy keys do not need a slow KDF like bcrypt.
 */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext.trim()).digest('hex')
}
