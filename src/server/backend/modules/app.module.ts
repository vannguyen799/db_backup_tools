import { Module, type DynamicModule, type Type } from 'truxie'
import { ScheduleModule } from 'truxie/schedule'
import { logger } from '~/server/utils/logger'

import { AuthModule } from './auth/auth.module'
import { GoogleDriveModule } from './gdrive/gdrive.module'
import { BackupModule } from './backup/backup.module'
import { HealthModule } from './health/health.module'

const cronLog = logger.getContext('Cron')

const cfg = useRuntimeConfig()

const moduleImports: Array<Type | DynamicModule> = [
  ScheduleModule.forRoot({
    enabled: Boolean(cfg.schedulerEnabled),
    onError: (error, taskName) => {
      cronLog.error(`${taskName} threw: ${error instanceof Error ? error.message : String(error)}`)
    },
  }),
  AuthModule.forRoot({
    jwtSecret: cfg.jwtSecret as string,
    jwtExpire: cfg.jwtExpire as string,
    seedAdmin: {
      email: cfg.adminEmail as string,
      password: cfg.adminPassword as string,
      name: cfg.adminName as string,
    },
  }),
  GoogleDriveModule.forRoot({
    clientId: cfg.googleClientId as string,
    clientSecret: cfg.googleClientSecret as string,
    redirectUri: cfg.googleRedirectUri as string,
  }),
  BackupModule.forRoot({
    tmpDir: cfg.backupTmpDir as string,
    mongodumpBin: cfg.mongodumpBin as string,
    pgDumpBin: cfg.pgDumpBin as string,
  }),
  HealthModule,
]

@Module({
  imports: moduleImports,
})
export class AppModule {}
