import { Module } from 'truxie'
import { BACKUP_MODULE_OPTIONS, type BackupModuleConfig } from './backup.config'
import { BackupTargetRepository } from './domain/backup-target.repository'
import { BackupJobRepository } from './domain/backup-job.repository'
import { ApiKeyRepository } from './domain/api-key.repository'
import { BackupRunnerService } from './services/backup-runner.service'
import { BackupSchedulerService } from './services/backup-scheduler.service'
import { BackupTargetsService } from './services/backup-targets.service'
import { SourceProbeService } from './services/source-probe.service'
import { ApiKeyService } from './services/api-key.service'
import { TargetsController } from './controllers/targets.controller'
import { JobsController } from './controllers/jobs.controller'
import { ApiKeyController } from './controllers/api-key.controller'
import { SyncController } from './controllers/sync.controller'

export { BACKUP_MODULE_OPTIONS }
export type { BackupModuleConfig }

@Module({})
export class BackupModule {
  static forRoot(config: BackupModuleConfig) {
    return {
      module: BackupModule,
      controllers: [TargetsController, JobsController, ApiKeyController, SyncController],
      providers: [
        { provide: BACKUP_MODULE_OPTIONS, useValue: config },
        BackupTargetRepository,
        BackupJobRepository,
        ApiKeyRepository,
        BackupRunnerService,
        BackupSchedulerService,
        BackupTargetsService,
        SourceProbeService,
        ApiKeyService,
      ],
      exports: [BackupRunnerService, BackupSchedulerService],
    }
  }
}
