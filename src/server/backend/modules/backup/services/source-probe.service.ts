import mongoose from 'mongoose'
import { Injectable, Inject, AppError, NotFoundError } from 'truxie'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { decryptString } from '~/server/utils/crypto'

const SYSTEM_DBS = new Set(['admin', 'local', 'config'])

export interface ProbedDatabase {
  name: string
  collections: string[]
  isSystem: boolean
}

@Injectable()
@Inject(BackupTargetRepository)
export class SourceProbeService {
  constructor(private readonly targets: BackupTargetRepository) {}

  async probe(opts: { targetId?: string; mongoUri?: string }): Promise<ProbedDatabase[]> {
    const uri = await this.resolveUri(opts)
    if (!uri) throw new AppError('mongoUri or targetId required', 400)

    const conn = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 8_000, socketTimeoutMS: 15_000 })
      .asPromise()

    try {
      const adminDb = conn.getClient().db('admin')
      const { databases } = await adminDb.admin().listDatabases({ nameOnly: true })

      const results: ProbedDatabase[] = []
      for (const d of databases) {
        const isSystem = SYSTEM_DBS.has(d.name)
        const cols = await conn
          .getClient()
          .db(d.name)
          .listCollections({}, { nameOnly: true })
          .toArray()
        results.push({
          name: d.name,
          isSystem,
          collections: cols
            .map((c) => c.name)
            .filter((n) => !n.startsWith('system.'))
            .sort((a, b) => a.localeCompare(b)),
        })
      }
      results.sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
        return a.name.localeCompare(b.name)
      })
      return results
    } finally {
      await conn.close().catch(() => {})
    }
  }

  private async resolveUri(opts: { targetId?: string; mongoUri?: string }): Promise<string> {
    if (opts.mongoUri && opts.mongoUri.trim()) return opts.mongoUri.trim()
    if (opts.targetId) {
      const target = await this.targets.findById(opts.targetId)
      if (!target) throw new NotFoundError('Target not found')
      return decryptString(target.mongoUriEncrypted)
    }
    return ''
  }
}
