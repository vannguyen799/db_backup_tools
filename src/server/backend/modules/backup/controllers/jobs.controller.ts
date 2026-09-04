import { Inject, Controller, Get, Post, RouteGuards, NoGuard, Param, Query, AppError, NotFoundError, createParamDecorator } from 'truxie'
import { McpExpose } from '@truxie/mcp'
import type { H3Event } from 'h3'
import { AuthGuard } from '$/guards/auth.guard'
import { BackupJobRepository } from '../domain/backup-job.repository'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { BackupSchedulerService } from '../services/backup-scheduler.service'
import { GoogleDriveService } from '$/modules/gdrive/services/gdrive.service'
import { signDownloadToken, verifyDownloadToken } from '~/server/utils/jwt'
import { isObjectId } from '~/server/utils/object-id'
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
  @McpExpose({
    summary: 'List backup jobs, newest first. Filter by target with `targetId`.',
    description:
      'One row per backup run: status, timing, archive size, Drive file id and the failure message when it failed.',
    tags: ['jobs'],
    querySchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Only jobs for this target. Omit for every target.' },
        limit: { type: 'string', description: 'Rows to return, 1-500. Default 50.' },
      },
    },
    related: ['GET /api/targets', 'GET /api/jobs/:id'],
  })
  async list(@Query() query: { targetId?: string; limit?: string }) {
    const limit = query.limit ? Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500) : 50
    const data = await this.jobs.list({ targetId: query.targetId, limit })
    return sendSuccess(data)
  }

  @Get('/recent')
  @McpExpose({
    summary: 'The 20 most recent backup jobs across every target.',
    description: 'The quickest read on whether backups are healthy right now.',
    tags: ['jobs'],
    related: ['GET /api/jobs/stats'],
  })
  async recent() {
    return sendSuccess(await this.jobs.recent(20))
  }

  @Get('/stats')
  @McpExpose({
    summary: 'Job counts by status, plus every schedule currently registered on this machine.',
    description:
      '`counts` totals jobs by status; `schedules` is what the cron scheduler actually holds — a target missing from it is not being backed up here.',
    tags: ['jobs'],
    related: ['GET /api/jobs/recent'],
  })
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
  @McpExpose({
    summary: 'One backup job in full, including its log output and failure reason.',
    tags: ['jobs'],
    errors: [{ status: 404, when: 'no job has that id', then: 'list jobs with GET /api/jobs first' }],
    related: ['GET /api/jobs'],
  })
  async get(@Param('id') id: string) {
    if (!isObjectId(id)) throw new NotFoundError('Job not found')
    const job = await this.jobs.findById(id)
    if (!job) throw new NotFoundError('Job not found')
    return sendSuccess(job)
  }

  @Post('/:id/download-url')
  async downloadUrl(@Param('id') id: string) {
    if (!isObjectId(id)) throw new NotFoundError('Job not found')
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
