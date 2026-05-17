import { app, shutdownApp } from '$/app'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('BackendBoot')

export default defineNitroPlugin((nitroApp) => {
  log.info(`Truxie app ready with ${app ? '✓' : '✗'} container`)

  nitroApp.hooks.hook('close', async () => {
    log.info('Shutting down truxie app...')
    await shutdownApp()
  })
})
