import { Inject, Controller, Get, Post, Patch, Delete, RouteGuards, Body, Param } from 'truxie'
import { McpExpose } from '@truxie/mcp'
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
import { collectionFilterSchema, retentionSchema } from '../mcp-schemas'

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
  @McpExpose({
    summary: 'List every backup target with its schedule, retention and last job status.',
    description:
      'Connection URIs are never returned — only the target metadata. Start here to get the `id` every other target endpoint needs.',
    tags: ['targets'],
    related: ['GET /api/targets/:id', 'GET /api/jobs'],
  })
  async list() {
    return sendSuccess(await this.targets.list())
  }

  @Get('/:id')
  @McpExpose({
    summary: 'One backup target in full, plus whether this machine owns its schedule.',
    description:
      '`machineMatches: false` means the target is pinned to a different machine, so this instance will not run its cron — a common reason a backup silently never fires.',
    tags: ['targets'],
    related: ['GET /api/targets', 'POST /api/targets/:id/run'],
  })
  async get(@Param('id') id: string) {
    return sendSuccess(await this.targets.findById(id))
  }

  // Deliberately NOT exposed to MCP: returns the decrypted connection URI,
  // credentials and all. Nothing an agent does with it is worth that.
  @Get('/:id/uri')
  async getUri(@Param('id') id: string) {
    return sendSuccess(await this.targets.getMongoUri(id))
  }

  @Post('/')
  @McpExpose({
    summary: 'Create a backup target: a source database, a Drive destination and a cron schedule.',
    tags: ['targets'],
    write: true,
    idempotent: false,
    sideEffects: [
      'registers a cron job that will dump this database on the given schedule',
      'stores the connection URI encrypted at rest',
    ],
    bodySchema: {
      type: 'object',
      required: ['name', 'mongoUri', 'cronExpression'],
      properties: {
        name: { type: 'string', description: 'Display name.' },
        description: { type: 'string' },
        databaseType: { type: 'string', enum: ['mongodb', 'postgresql'], default: 'mongodb' },
        mongoUri: {
          type: 'string',
          description: 'Connection URI of the SOURCE database, for whichever databaseType is set.',
        },
        includeDbs: { type: 'array', items: { type: 'string' }, description: 'Empty means every database.' },
        excludeDbs: { type: 'array', items: { type: 'string' } },
        collectionFilter: collectionFilterSchema,
        cronExpression: { type: 'string', description: '5-field cron, server timezone. e.g. "0 3 * * *".' },
        googleAuthId: { type: 'string', description: 'Id from GET /api/gdrive/accounts.' },
        gdriveFolderId: { type: 'string' },
        gdriveFolderName: { type: 'string' },
        retention: retentionSchema,
        enabled: { type: 'boolean', default: true },
      },
    },
    related: ['GET /api/gdrive/accounts', 'POST /api/targets/probe-collections'],
  })
  async create(@Body() body: CreateTargetInput) {
    return sendSuccess(await this.targets.create(body), 'Target created')
  }

  @Patch('/:id')
  @McpExpose({
    summary: 'Update a backup target. Only the fields present in the body change.',
    tags: ['targets'],
    write: true,
    idempotent: true,
    sideEffects: [
      'reschedules the cron job when cronExpression or enabled changes',
      'replaces the stored connection URI when mongoUri is present',
    ],
    bodySchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        databaseType: { type: 'string', enum: ['mongodb', 'postgresql'] },
        mongoUri: { type: 'string', description: 'Omit to keep the stored URI.' },
        includeDbs: { type: 'array', items: { type: 'string' } },
        excludeDbs: { type: 'array', items: { type: 'string' } },
        collectionFilter: collectionFilterSchema,
        cronExpression: { type: 'string' },
        googleAuthId: { type: 'string' },
        gdriveFolderId: { type: 'string' },
        gdriveFolderName: { type: 'string' },
        retention: retentionSchema,
        enabled: { type: 'boolean' },
        machineId: { type: 'string', description: 'Pin the schedule to a specific machine.' },
        regenerateMachineId: { type: 'boolean', description: 'Re-pin the target to THIS machine.' },
      },
    },
    related: ['GET /api/targets/:id'],
  })
  async update(@Param('id') id: string, @Body() body: UpdateTargetInput) {
    return sendSuccess(await this.targets.update(id, body), 'Target updated')
  }

  // Deliberately NOT exposed to MCP: deleting a target drops its schedule and
  // its job history. Left to the dashboard.
  @Delete('/:id')
  async remove(@Param('id') id: string) {
    return sendSuccess(await this.targets.delete(id), 'Target deleted')
  }

  @Post('/:id/run')
  @McpExpose({
    summary: 'Start a backup of this target right now, outside its schedule.',
    description:
      'Returns as soon as the job is queued — it does NOT wait for the dump to finish. Poll GET /api/jobs/:id, or GET /api/jobs?targetId=… for the new job.',
    tags: ['targets', 'jobs'],
    write: true,
    dangerous: true,
    idempotent: false,
    confirmPrompt:
      'This dumps the entire source database now and uploads the archive to Google Drive — real load on the production database and a new file on Drive. Run the backup?',
    sideEffects: [
      'reads the whole source database with mongodump / pg_dump',
      'uploads an archive to the configured Google Drive folder',
      'deletes older archives when the retention policy says so',
    ],
    cost: 'expensive',
    related: ['GET /api/jobs', 'GET /api/jobs/:id'],
  })
  async run(@Param('id') id: string) {
    // Pre-flight: ensure target exists (throws NotFound if missing)
    const target = await this.targets.findById(id)
    this.runner.run(id, 'manual', 'Manual run (dashboard)').catch((err) => {
      log.error(`Manual backup ${target.name} failed:`, (err as Error).message)
    })
    return sendSuccess({ targetId: id }, 'Backup started')
  }

  @Post('/probe-collections')
  @McpExpose({
    summary: 'List the databases and collections/tables a source URI can see. Reads only, changes nothing.',
    description:
      'Pass `targetId` to probe a saved target with its stored URI, or `mongoUri` to probe a connection string directly. Use it to fill `collectionFilter` before creating or updating a target.',
    tags: ['targets'],
    write: true,
    idempotent: true,
    sideEffects: ['opens a connection to the source database'],
    bodySchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Probe this saved target using its stored URI.' },
        mongoUri: { type: 'string', description: 'Probe this connection string instead.' },
        databaseType: { type: 'string', enum: ['mongodb', 'postgresql'], default: 'mongodb' },
      },
    },
    related: ['POST /api/targets', 'PATCH /api/targets/:id'],
  })
  async probeCollections(
    @Body() body: { mongoUri?: string; targetId?: string; databaseType?: 'mongodb' | 'postgresql' },
  ) {
    return sendSuccess(await this.probe.probe(body || {}))
  }
}
