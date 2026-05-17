import { Module } from 'truxie'
import { BACKUP_MODULE_OPTIONS, type BackupModuleConfig } from './backup.config'
import { BackupTargetRepository } from './domain/backup-target.repository'
import { BackupJobRepository } from './domain/backup-job.repository'
import { BackupRunnerService } from './services/backup-runner.service'
import { BackupSchedulerService } from './services/backup-scheduler.service'
import { BackupTargetsService } from './services/backup-targets.service'
import { SourceProbeService } from './services/source-probe.service'
import { TargetsController } from './controllers/targets.controller'
import { JobsController } from './controllers/jobs.controller'

export { BACKUP_MODULE_OPTIONS }
export type { BackupModuleConfig }

@Module({})
export class BackupModule {
  static forRoot(config: BackupModuleConfig) {
    return {
      module: BackupModule,
      controllers: [TargetsController, JobsController],
      providers: [
        { provide: BACKUP_MODULE_OPTIONS, useValue: config },
        BackupTargetRepository,
        BackupJobRepository,
        BackupRunnerService,
        BackupSchedulerService,
        BackupTargetsService,
        SourceProbeService,
      ],
      exports: [BackupRunnerService, BackupSchedulerService],
    }
  }
}
