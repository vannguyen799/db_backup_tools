import { TruxieFactory } from 'truxie'
import { AppModule } from './modules/app.module'
import { AppErrorFilter } from './filters/app-error.filter'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('TruxieApp')

const app = await TruxieFactory.create(AppModule, {
  globalFilters: [new AppErrorFilter()],
})

app.setGlobalPrefix('api')
log.info('Application initialized with DI container')

export function resolve<T>(token: any): Promise<T> {
  return app.resolve<T>(token)
}

export async function shutdownApp(): Promise<void> {
  await app.shutdown()
}

export { app }
