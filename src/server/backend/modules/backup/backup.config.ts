export interface BackupModuleConfig {
  tmpDir: string
  mongodumpBin: string
}

export const BACKUP_MODULE_OPTIONS = Symbol('BACKUP_MODULE_OPTIONS')
