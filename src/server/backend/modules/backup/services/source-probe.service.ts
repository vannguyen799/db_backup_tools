import mongoose from 'mongoose'
import { Client as PgClient } from 'pg'
import { Injectable, Inject, AppError, NotFoundError } from 'truxie'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { decryptString } from '~/server/utils/crypto'
import type { DatabaseType } from './backup-targets.service'

const SYSTEM_DBS = new Set(['admin', 'local', 'config'])

export interface ProbedDatabase {
  name: string
  collections: string[]
  isSystem: boolean
}

interface ProbeInput {
  targetId?: string
  mongoUri?: string
  databaseType?: DatabaseType
}

@Injectable()
@Inject(BackupTargetRepository)
export class SourceProbeService {
  constructor(private readonly targets: BackupTargetRepository) {}

  async probe(opts: ProbeInput): Promise<ProbedDatabase[]> {
    const { uri, databaseType } = await this.resolveSource(opts)
    if (!uri) throw new AppError('mongoUri or targetId required', 400)
    return databaseType === 'postgresql' ? this.probePostgres(uri) : this.probeMongo(uri)
  }

  private async probeMongo(uri: string): Promise<ProbedDatabase[]> {
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

  private async probePostgres(uri: string): Promise<ProbedDatabase[]> {
    const client = new PgClient({ connectionString: uri, connectionTimeoutMillis: 8_000, statement_timeout: 15_000 })
    await client.connect()
    try {
      const dbRes = await client.query<{ name: string }>('SELECT current_database() AS name')
      const dbName = dbRes.rows[0]?.name || 'postgres'
      const tblRes = await client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name
           FROM information_schema.tables
          WHERE table_type = 'BASE TABLE'
            AND table_schema NOT IN ('pg_catalog', 'information_schema')
          ORDER BY table_schema, table_name`,
      )
      // Schema-qualify only non-public tables so pg_dump --table patterns stay precise but readable.
      const collections = tblRes.rows.map((r) =>
        r.table_schema === 'public' ? r.table_name : `${r.table_schema}.${r.table_name}`,
      )
      return [{ name: dbName, isSystem: false, collections }]
    } finally {
      await client.end().catch(() => {})
    }
  }

  private async resolveSource(opts: ProbeInput): Promise<{ uri: string; databaseType: DatabaseType }> {
    if (opts.mongoUri && opts.mongoUri.trim()) {
      return { uri: opts.mongoUri.trim(), databaseType: opts.databaseType === 'postgresql' ? 'postgresql' : 'mongodb' }
    }
    if (opts.targetId) {
      const target = await this.targets.findById(opts.targetId)
      if (!target) throw new NotFoundError('Target not found')
      const databaseType: DatabaseType =
        (target as { databaseType?: string }).databaseType === 'postgresql' ? 'postgresql' : 'mongodb'
      return { uri: decryptString(target.mongoUriEncrypted), databaseType }
    }
    return { uri: '', databaseType: 'mongodb' }
  }
}
