import { Injectable, Inject, AppError, NotFoundError } from 'truxie'
import { ApiKeyRepository } from '../domain/api-key.repository'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { generateApiKey } from '~/server/utils/api-key.util'

export interface CreateApiKeyInput {
  name: string
  targetId: string
  scopes?: string[]
  expiresAt?: string
}

@Injectable()
@Inject(ApiKeyRepository, BackupTargetRepository)
export class ApiKeyService {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly targets: BackupTargetRepository,
  ) {}

  list() {
    return this.repo.list()
  }

  /**
   * Mint a key bound to a single target. The plaintext is returned ONCE here and
   * never again — the caller must surface it to the user immediately.
   */
  async create(input: CreateApiKeyInput, createdBy?: string) {
    if (!input.name || !input.name.trim()) throw new AppError('name is required', 400)
    if (!input.targetId) throw new AppError('targetId is required', 400)

    const target = await this.targets.findById(input.targetId)
    if (!target) throw new NotFoundError('Target not found')

    let expiresAt: Date | null = null
    if (input.expiresAt) {
      const parsed = new Date(input.expiresAt)
      if (Number.isNaN(parsed.getTime())) throw new AppError('invalid expiresAt', 400)
      expiresAt = parsed
    }

    const { plaintext, keyHash, prefix } = generateApiKey()
    const scopes = input.scopes?.length ? input.scopes : ['sync:run']

    const doc = await this.repo.create({
      name: input.name.trim(),
      keyHash,
      prefix,
      targetId: target._id as never,
      scopes,
      expiresAt,
      createdBy: (createdBy as never) ?? null,
    })

    return {
      id: String(doc._id),
      name: doc.name,
      prefix: doc.prefix,
      targetId: String(doc.targetId),
      scopes: doc.scopes,
      expiresAt: doc.expiresAt,
      // Shown exactly once — copy it now.
      key: plaintext,
    }
  }

  async revoke(id: string) {
    const res = await this.repo.delete(id)
    if (!res) throw new NotFoundError('API key not found')
    return { id }
  }
}
