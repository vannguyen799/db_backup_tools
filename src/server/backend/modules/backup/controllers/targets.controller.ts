import { Inject, Controller, Get, Post, Patch, Delete, RouteGuards, Body, Param } from 'truxie'
import { AuthGuard } from '$/guards/auth.guard'
import {
  BackupTargetsService,
  type CreateTargetInput,
  type UpdateTargetInput,
} from '../services/backup-targets.service'
import { BackupRunnerService } from '../services/backup-runner.service'
import { SourceProbeService } from '../services/source-probe.service'
import { logger } from '~/server/utils/logger'
import { sendSuccess } from '~/server/utils/response'

const log = logger.getContext('TargetsCtrl')

@Inject(BackupTargetsService, BackupRunnerService, SourceProbeService)
@Controller('targets')
@RouteGuards(AuthGuard)
export class TargetsController {
  constructor(
    private readonly targets: BackupTargetsService,
    private readonly runner: BackupRunnerService,
    private readonly probe: SourceProbeService,
  ) {}

  @Get('/')
  async list() {
    return sendSuccess(await this.targets.list())
  }

  @Get('/:id')
  async get(@Param('id') id: string) {
    return sendSuccess(await this.targets.findById(id))
  }

  @Get('/:id/uri')
  async getUri(@Param('id') id: string) {
    return sendSuccess(await this.targets.getMongoUri(id))
  }

  @Post('/')
  async create(@Body() body: CreateTargetInput) {
    return sendSuccess(await this.targets.create(body), 'Target created')
  }

  @Patch('/:id')
  async update(@Param('id') id: string, @Body() body: UpdateTargetInput) {
    return sendSuccess(await this.targets.update(id, body), 'Target updated')
  }

  @Delete('/:id')
  async remove(@Param('id') id: string) {
    return sendSuccess(await this.targets.delete(id), 'Target deleted')
  }

  @Post('/:id/run')
  async run(@Param('id') id: string) {
    // Pre-flight: ensure target exists (throws NotFound if missing)
    const target = await this.targets.findById(id)
    this.runner.run(id, 'manual').catch((err) => {
      log.error(`Manual backup ${target.name} failed:`, (err as Error).message)
    })
    return sendSuccess({ targetId: id }, 'Backup started')
  }

  @Post('/probe-collections')
  async probeCollections(
    @Body() body: { mongoUri?: string; targetId?: string; databaseType?: 'mongodb' | 'postgresql' },
  ) {
    return sendSuccess(await this.probe.probe(body || {}))
  }
}
