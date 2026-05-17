import { logger } from '~/server/utils/logger'

const log = logger.getContext('EnvValidation')

export default defineNitroPlugin(() => {
  const cfg = useRuntimeConfig()
  const errors: string[] = []

  if (!cfg.mongodbUri) errors.push('MONGODB_URI is not set')
  if (!cfg.jwtSecret || (cfg.jwtSecret as string).length < 32) errors.push('JWT_SECRET must be at least 32 chars')
  if (!cfg.encryptionKey || (cfg.encryptionKey as string).length < 32) {
    errors.push('ENCRYPTION_KEY must be at least 32 chars (or 64-hex)')
  }
  if (process.env.NODE_ENV === 'production' && !cfg.adminPassword) {
    errors.push('ADMIN_PASSWORD is required in production')
  }

  if (errors.length) {
    const msg = 'Invalid environment:\n  - ' + errors.join('\n  - ')
    if (process.env.NODE_ENV === 'production') {
      log.error(msg)
      throw new Error(msg)
    }
    log.warn(msg)
  } else {
    log.info('Environment OK')
  }
})
