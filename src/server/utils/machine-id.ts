import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'

let cached: string | null = null

export function getMachineId(): string {
  if (cached) return cached
  const candidates = ['/etc/machine-id', '/var/lib/dbus/machine-id']
  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, 'utf8').trim()
      if (v) {
        cached = v
        return v
      }
    } catch {
      // try next
    }
  }
  cached = crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 32)
  return cached
}

export function isLocalMongoUri(uri: string): boolean {
  if (!uri) return false
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]*@)?([^/?]+)/i)
  if (!m || !m[1]) return false
  const hosts = m[1].split(',').map((h) => h.split(':')[0]!.trim().toLowerCase())
  return hosts.every(
    (h) => h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]' || h.startsWith('127.'),
  )
}
