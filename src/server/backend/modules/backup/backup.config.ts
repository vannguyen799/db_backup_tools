export interface BackupModuleConfig {
  tmpDir: string
  /** Where each target's newest archive(s) stay on disk, so a Drive outage never loses a dump. */
  localDir: string
  mongodumpBin: string
  pgDumpBin: string
  /** When false, no backup cron is registered (SCHEDULER_ENABLED=false). */
  schedulerEnabled: boolean
}

export const BACKUP_MODULE_OPTIONS = Symbol('BACKUP_MODULE_OPTIONS')
