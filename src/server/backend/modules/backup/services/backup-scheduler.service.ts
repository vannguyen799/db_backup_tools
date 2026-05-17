import cron, { type ScheduledTask } from 'node-cron'
import {
  Injectable,
  Inject,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from 'truxie'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { BackupRunnerService } from './backup-runner.service'
import { isDBConnected } from '~/server/utils/database/connect'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('BackupScheduler')

@Injectable()
@Inject(BackupTargetRepository, BackupRunnerService)
export class BackupSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private tasks = new Map<string, { cron: string; task: ScheduledTask }>()

  constructor(
    private readonly targets: BackupTargetRepository,
    private readonly runner: BackupRunnerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (let i = 0; i < 10 && !isDBConnected(); i++) {
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!isDBConnected()) {
      log.warn('DB not connected — schedule reload deferred')
      return
    }
    await this.reload()
  }

  onApplicationShutdown(): void {
    this.stopAll()
  }

  async reload(): Promise<void> {
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
          await this.runner.run(id, 'cron')
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
