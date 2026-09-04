import { app, shutdownApp } from '$/app'
import { logMcpCatalog } from '$/mcp'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('BackendBoot')

export default defineNitroPlugin((nitroApp) => {
  log.info(`Truxie app ready with ${app ? '✓' : '✗'} container`)
  logMcpCatalog()

  nitroApp.hooks.hook('close', async () => {
    log.info('Shutting down truxie app...')
    await shutdownApp()
  })
})
