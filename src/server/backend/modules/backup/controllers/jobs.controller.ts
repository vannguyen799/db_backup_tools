import { Inject, Controller, Get, Post, RouteGuards, NoGuard, Param, Query, AppError, NotFoundError, createParamDecorator } from 'truxie'
import type { H3Event } from 'h3'
import { AuthGuard } from '$/guards/auth.guard'
import { BackupJobRepository } from '../domain/backup-job.repository'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { BackupSchedulerService } from '../services/backup-scheduler.service'
import { GoogleDriveService } from '$/modules/gdrive/services/gdrive.service'
import { signDownloadToken, verifyDownloadToken } from '~/server/utils/jwt'
import { sendSuccess } from '~/server/utils/response'

const Event = createParamDecorator<H3Event>((ctx) => ctx.getNativeRequest() as H3Event)

@Inject(BackupJobRepository, BackupTargetRepository, BackupSchedulerService, GoogleDriveService)
@Controller('jobs')
@RouteGuards(AuthGuard)
export class JobsController {
  constructor(
    private readonly jobs: BackupJobRepository,
    private readonly targets: BackupTargetRepository,
    private readonly scheduler: BackupSchedulerService,
    private readonly gdrive: GoogleDriveService,
  ) {}

  @Get('/')
  async list(@Query() query: { targetId?: string; limit?: string }) {
    const limit = query.limit ? Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500) : 50
    const data = await this.jobs.list({ targetId: query.targetId, limit })
    return sendSuccess(data)
  }

  @Get('/recent')
  async recent() {
    return sendSuccess(await this.jobs.recent(20))
  }

  @Get('/stats')
  async stats() {
    const raw = await this.jobs.stats()
    const out: Record<string, number> = { success: 0, failed: 0, running: 0, pending: 0, cancelled: 0 }
    for (const row of raw) {
      const key = row._id as string
      if (key in out) out[key] = row.count as number
    }
    return sendSuccess({ counts: out, schedules: this.scheduler.list() })
  }

  @Get('/:id')
  async get(@Param('id') id: string) {
    const job = await this.jobs.findById(id)
    if (!job) throw new NotFoundError('Job not found')
    return sendSuccess(job)
  }

  @Post('/:id/download-url')
  async downloadUrl(@Param('id') id: string) {
    const job = await this.jobs.findById(id)
    if (!job) throw new NotFoundError('Job not found')
    if (!job.gdriveFileId) throw new AppError('Job has no archive on Google Drive', 400)
    const token = signDownloadToken(String(job._id))
    return sendSuccess({
      url: `/api/jobs/${job._id}/download?token=${encodeURIComponent(token)}`,
      filename: job.archiveFilename || '',
      expiresInSeconds: 300,
    })
  }

  @Get('/:id/download')
  @NoGuard()
  async download(@Param('id') id: string, @Query('token') token: string | undefined, @Event() event: H3Event) {
    if (!token) throw new AppError('Missing download token', 401)
    let decoded
    try {
      decoded = verifyDownloadToken(token)
    } catch {
      throw new AppError('Invalid or expired download token', 401)
    }
    if (decoded.jobId !== id) throw new AppError('Token does not match job', 403)

    const job = await this.jobs.findById(id)
    if (!job) throw new NotFoundError('Job not found')
    if (!job.gdriveFileId) throw new AppError('Job has no archive on Google Drive', 400)

    const target = await this.targets.findById(String(job.targetId))
    if (!target || !target.googleAuthId) {
      throw new AppError('Target or Google account missing for this job', 400)
    }
    const accountId = String(target.googleAuthId)

    const meta = await this.gdrive.getFileMeta(accountId, job.gdriveFileId)
    const filename = job.archiveFilename || meta.name || `backup-${id}`
    const mime = job.archiveFilename?.endsWith('.tar')
      ? 'application/x-tar'
      : job.archiveFilename?.endsWith('.gz')
        ? 'application/gzip'
        : meta.mimeType || 'application/octet-stream'

    setResponseHeader(event, 'content-type', mime)
    setResponseHeader(event, 'content-disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
    if (meta.size > 0) setResponseHeader(event, 'content-length', meta.size)
    setResponseHeader(event, 'cache-control', 'no-store')

    return this.gdrive.openFileStream(accountId, job.gdriveFileId)
  }
}
