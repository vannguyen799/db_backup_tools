import { Inject, Controller, Get, Post, Body, Param, RouteGuards, AppError, NotFoundError } from 'truxie'
import { ApiKeyGuard, ApiKeyAuth, type ApiKeyContext } from '../guards/api-key.guard'
import { BackupTargetsService } from '../services/backup-targets.service'
import { BackupRunnerService } from '../services/backup-runner.service'
import { BackupJobRepository } from '../domain/backup-job.repository'
import { sendSuccess } from '~/server/utils/response'

@Inject(BackupTargetsService, BackupRunnerService, BackupJobRepository)
@Controller('sync')
@RouteGuards(ApiKeyGuard)
export class SyncController {
  constructor(
    private readonly targets: BackupTargetsService,
    private readonly runner: BackupRunnerService,
    private readonly jobs: BackupJobRepository,
  ) {}

  // Trigger the target this key is bound to (no id needed in the path).
  @Post('/')
  async triggerBound(@Body() body: TriggerBody, @ApiKeyAuth() key: ApiKeyContext) {
    return this.fire(key.targetId, body?.reason)
  }

  // Poll the result of a triggered job so CI/CD can wait and fail the pipeline
  // if the backup failed. Scoped to the key's own target.
  @Get('/job/:jobId')
  async jobStatus(@Param('jobId') jobId: string, @ApiKeyAuth() key: ApiKeyContext) {
    const job = await this.jobs.findById(jobId)
    if (!job || String(job.targetId) !== key.targetId) {
      throw new NotFoundError('Job not found')
    }
    return sendSuccess({
      jobId: String(job._id),
      status: job.status,
      reason: job.reason ?? null,
      triggeredBy: job.triggeredBy,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationMs: job.durationMs,
      archiveFilename: job.archiveFilename,
      archiveSizeBytes: job.archiveSizeBytes,
      error: job.error,
    })
  }

  // Explicit target id — must match the key's bound target.
  @Post('/:id')
  async trigger(@Param('id') id: string, @Body() body: TriggerBody, @ApiKeyAuth() key: ApiKeyContext) {
    if (id !== key.targetId) {
      throw new AppError('API key is not allowed to trigger this target', 403)
    }
    return this.fire(id, body?.reason)
  }

  private async fire(id: string, reason?: string) {
    // Throws NotFound if the target was deleted after the key was issued.
    const target = await this.targets.findById(id)

    // Don't stack a second run on top of an in-flight one — return the live job.
    if (target.lastJobStatus === 'running') {
      return sendSuccess({ targetId: id, status: 'running' }, 'Backup already running')
    }

    const job = await this.runner.start(id, 'api', reason)
    return sendSuccess(
      { jobId: String(job._id), targetId: id, status: job.status, reason: job.reason ?? null },
      'Backup started',
    )
  }
}

interface TriggerBody {
  // Optional free-text "why" recorded on the job (e.g. "pre-deploy <repo>@<sha>").
  reason?: string
}
