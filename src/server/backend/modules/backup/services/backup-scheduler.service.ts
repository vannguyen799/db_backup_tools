import cron, { type ScheduledTask } from 'node-cron'
import {
  Injectable,
  Inject,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from 'truxie'
import { BACKUP_MODULE_OPTIONS, type BackupModuleConfig } from '../backup.config'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { BackupRunnerService } from './backup-runner.service'
import { isDBConnected, onDBConnected } from '~/server/utils/database/connect'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('BackupScheduler')

@Injectable()
@Inject(BACKUP_MODULE_OPTIONS, BackupTargetRepository, BackupRunnerService)
export class BackupSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private tasks = new Map<string, { cron: string; task: ScheduledTask }>()
  private unsubscribe?: () => void
  // Reloads are serialized: `create`/`update`/`delete` each trigger one and so does
  // every DB reconnect. Two running concurrently would both pass the `tasks.has(id)`
  // check and schedule the same target twice, and the entry the second one overwrote
  // would keep firing forever, unreachable from stopAll().
  private reloading: Promise<void> = Promise.resolve()

  constructor(
    private readonly config: BackupModuleConfig,
    private readonly targets: BackupTargetRepository,
    private readonly runner: BackupRunnerService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.schedulerEnabled) {
      log.info('SCHEDULER_ENABLED=false — no backup cron will be registered')
      return
    }
    // Load schedules as soon as the DB is connected — and reload on every
    // reconnect. The MongoDB connection can take longer than the old fixed
    // 5s wait window (Atlas SRV resolution), which previously left cron jobs
    // permanently unregistered after a restart.
    this.unsubscribe = onDBConnected(() => {
      this.reload().catch((err) => log.error('Schedule reload failed:', (err as Error).message))
    })
    if (!isDBConnected()) log.info('Waiting for DB connection to load schedules…')
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.()
    this.stopAll()
  }

  reload(): Promise<void> {
    if (!this.config.schedulerEnabled) return Promise.resolve()
    const next = this.reloading.then(
      () => this.reloadOnce(),
      () => this.reloadOnce(),
    )
    this.reloading = next.catch(() => {})
    return next
  }

  private async reloadOnce(): Promise<void> {
    const targets = await this.targets.findEnabled().lean()
    const wanted = new Map<string, string>(
      targets.map((t) => [String(t._id), t.cronExpression || '']),
    )

    for (const [id, entry] of this.tasks) {
      if (!wanted.has(id) || wanted.get(id) !== entry.cron) {
        entry.task.stop()
        this.tasks.delete(id)
        log.info(`Removed schedule for target ${id}`)
      }
    }

    for (const t of targets) {
      const id = String(t._id)
      if (this.tasks.has(id)) continue
      const expr = t.cronExpression
      if (!expr || !cron.validate(expr)) {
        log.warn(`Skip ${t.name}: invalid cron "${expr}"`)
        continue
      }
      const task = cron.schedule(expr, async () => {
        try {
          log.info(`Cron trigger: ${t.name}`)
          await this.runner.run(id, 'cron', `Scheduled (cron ${expr})`)
        } catch (err) {
          log.error(`Cron run failed for ${t.name}:`, (err as Error).message)
        }
      })
      this.tasks.set(id, { cron: expr, task })
      log.info(`Scheduled "${t.name}" with cron "${expr}"`)
    }
  }

  stopAll(): void {
    for (const [, entry] of this.tasks) entry.task.stop()
    this.tasks.clear()
    log.info('All schedules stopped')
  }

  list() {
    return Array.from(this.tasks.entries()).map(([targetId, e]) => ({ targetId, cron: e.cron }))
  }
}
