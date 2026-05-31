import mongoose from 'mongoose'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('MongoDB')

let connectPromise: Promise<typeof mongoose> | null = null

mongoose.set('bufferCommands', false)

export async function connectDB(uri: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose
  if (connectPromise) return connectPromise

  connectPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      maxPoolSize: 10,
      retryWrites: true,
    })
    .then((m) => {
      log.info(`Connected (${mongoose.connection.host}/${mongoose.connection.name})`)
      return m
    })
    .catch((err) => {
      connectPromise = null
      throw err
    })

  mongoose.connection.on('disconnected', () => {
    log.warn('Disconnected')
    connectPromise = null
  })
  mongoose.connection.on('error', (e) => log.error('Connection error:', e.message))

  return connectPromise
}

export function isDBConnected(): boolean {
  return mongoose.connection.readyState === 1
}

/**
 * Run `cb` as soon as the DB is connected — immediately if already connected,
 * otherwise on every (re)connect. Returns an unsubscribe function.
 */
export function onDBConnected(cb: () => void): () => void {
  if (isDBConnected()) cb()
  mongoose.connection.on('connected', cb)
  return () => mongoose.connection.off('connected', cb)
}
