import { connectDB } from '~/server/utils/database/connect'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('MongoPlugin')

export default defineNitroPlugin(async () => {
  const cfg = useRuntimeConfig()
  log.info('Initializing MongoDB connection...')
  try {
    await connectDB(cfg.mongodbUri as string)
  } catch (err) {
    log.warn(`MongoDB startup connection failed: ${(err as Error).message}`)
  }
})
