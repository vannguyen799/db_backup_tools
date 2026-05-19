import cronLib from 'node-cron'
import { Injectable, Inject, AppError, NotFoundError } from 'truxie'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { BackupSchedulerService } from './backup-scheduler.service'
import { encryptString, decryptString } from '~/server/utils/crypto'
import { getMachineId, isLocalMongoUri } from '~/server/utils/machine-id'

function normalizeCollectionFilter(input?: CollectionFilterInput) {
  const mode: 'exclude' | 'include' = input?.mode === 'include' ? 'include' : 'exclude'
  const collections = (input?.collections || [])
    .filter((c) => c && typeof c.db === 'string' && typeof c.name === 'string' && c.db && c.name)
    .map((c) => ({ db: c.db.trim(), name: c.name.trim() }))
  const patterns = (input?.patterns || [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
  return { mode, collections, patterns }
}

interface RetentionInput {
  mode?: 'count' | 'days' | 'none'
  keepCount?: number
  keepDays?: number
}

export interface CollectionFilterInput {
  mode?: 'exclude' | 'include'
  collections?: { db: string; name: string }[]
  patterns?: string[]
}

export interface CreateTargetInput {
  name: string
  description?: string
  mongoUri: string
  includeDbs?: string[]
  excludeDbs?: string[]
  collectionFilter?: CollectionFilterInput
  cronExpression: string
  googleAuthId?: string
  gdriveFolderId?: string
  gdriveFolderName?: string
  retention?: RetentionInput
  enabled?: boolean
}

export type UpdateTargetInput = Partial<Omit<CreateTargetInput, 'mongoUri'>> & {
  mongoUri?: string
  regenerateMachineId?: boolean
  machineId?: string
}

@Injectable()
@Inject(BackupTargetRepository, BackupSchedulerService)
export class BackupTargetsService {
  constructor(
    private readonly repo: BackupTargetRepository,
    private readonly scheduler: BackupSchedulerService,
  ) {}

  list() {
    return this.repo.list()
  }

  async findById(id: string) {
    const t = await this.repo.findByIdSafe(id)
    if (!t) throw new NotFoundError('Target not found')
    const currentMachineId = getMachineId()
    const targetMachineId = (t as { machineId?: string }).machineId || ''
    return {
      ...t,
      currentMachineId,
      machineMatches: targetMachineId ? targetMachineId === currentMachineId : true,
    }
  }

  async getMongoUri(id: string) {
    const t = await this.repo.findById(id)
    if (!t) throw new NotFoundError('Target not found')
    return { mongoUri: decryptString(t.mongoUriEncrypted) }
  }

  async create(input: CreateTargetInput) {
    if (!input.name || !input.mongoUri) {
      throw new AppError('name and mongoUri are required', 400)
    }
    if (!input.cronExpression || !cronLib.validate(input.cronExpression)) {
      throw new AppError('invalid cronExpression', 400)
    }
    const created = await this.repo.create({
      name: input.name.trim(),
      description: input.description || '',
      mongoUriEncrypted: encryptString(input.mongoUri),
      includeDbs: input.includeDbs || [],
      excludeDbs: input.excludeDbs || [],
      collectionFilter: normalizeCollectionFilter(input.collectionFilter) as never,
      cronExpression: input.cronExpression,
      googleAuthId: input.googleAuthId ? (input.googleAuthId as never) : null,
      gdriveFolderId: input.gdriveFolderId || '',
      gdriveFolderName: input.gdriveFolderName || '',
      retention: {
        mode: input.retention?.mode || 'count',
        keepCount: input.retention?.keepCount ?? 7,
        keepDays: input.retention?.keepDays ?? 30,
      },
      enabled: input.enabled !== false,
      machineId: isLocalMongoUri(input.mongoUri) ? getMachineId() : '',
    })
    await this.scheduler.reload()
    const { mongoUriEncrypted: _drop, ...rest } = created.toObject()
    return rest
  }

  async update(id: string, input: UpdateTargetInput) {
    const patch: Record<string, unknown> = {}
    if (typeof input.name === 'string') patch.name = input.name.trim()
    if (typeof input.description === 'string') patch.description = input.description
    if (typeof input.mongoUri === 'string' && input.mongoUri.length > 0) {
      patch.mongoUriEncrypted = encryptString(input.mongoUri)
      patch.machineId = isLocalMongoUri(input.mongoUri) ? getMachineId() : ''
    } else if (input.regenerateMachineId) {
      const existing = await this.repo.findById(id)
      if (!existing) throw new NotFoundError('Target not found')
      if (existing.machineId) {
        patch.machineId = getMachineId()
      }
    }
    if (Array.isArray(input.includeDbs)) patch.includeDbs = input.includeDbs
    if (Array.isArray(input.excludeDbs)) patch.excludeDbs = input.excludeDbs
    if (input.collectionFilter) patch.collectionFilter = normalizeCollectionFilter(input.collectionFilter)
    if (typeof input.cronExpression === 'string') {
      if (!cronLib.validate(input.cronExpression)) {
        throw new AppError('invalid cronExpression', 400)
      }
      patch.cronExpression = input.cronExpression
    }
    if (typeof input.googleAuthId === 'string') {
      patch.googleAuthId = input.googleAuthId ? input.googleAuthId : null
    }
    if (typeof input.gdriveFolderId === 'string') patch.gdriveFolderId = input.gdriveFolderId
    if (typeof input.gdriveFolderName === 'string') patch.gdriveFolderName = input.gdriveFolderName
    if (input.retention) patch.retention = input.retention
    if (typeof input.enabled === 'boolean') patch.enabled = input.enabled

    // Explicit machineId wins over the auto-set from mongoUri/regenerateMachineId above.
    if (typeof input.machineId === 'string') patch.machineId = input.machineId.trim()

    const target = await this.repo.update(id, patch as never)
    if (!target) throw new NotFoundError('Target not found')

    await this.scheduler.reload()
    return target
  }

  async delete(id: string) {
    const res = await this.repo.delete(id)
    if (!res) throw new NotFoundError('Target not found')
    await this.scheduler.reload()
    return { id }
  }
}
