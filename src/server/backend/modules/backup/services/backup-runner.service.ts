import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Injectable, Inject, NotFoundError } from 'truxie'
import { BACKUP_MODULE_OPTIONS, type BackupModuleConfig } from '../backup.config'
import { BackupTargetRepository } from '../domain/backup-target.repository'
import { BackupJobRepository } from '../domain/backup-job.repository'
import { type IBackupTarget } from '../domain/backup-target.model'
import { SourceProbeService } from './source-probe.service'
import { GoogleDriveService } from '$/modules/gdrive/services/gdrive.service'
import { decryptString } from '~/server/utils/crypto'
import { getMachineId } from '~/server/utils/machine-id'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('BackupRunner')

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
}

interface PerDbExcludePlan {
  db: string
  excludeCollections: string[]
  excludePrefixes: string[]
}

interface PerCollectionIncludePlan {
  db: string
  collection: string
}

interface BundlePlan {
  kind: 'bundle'
  excludeDumps: PerDbExcludePlan[]
  includeDumps: PerCollectionIncludePlan[]
}

interface SingleArchivePlan {
  kind: 'single'
  includeDbs: string[]
  excludeDbs: string[]
}

type DumpPlan = SingleArchivePlan | BundlePlan

@Injectable()
@Inject(BACKUP_MODULE_OPTIONS, BackupTargetRepository, BackupJobRepository, GoogleDriveService, SourceProbeService)
export class BackupRunnerService {
  constructor(
    private readonly config: BackupModuleConfig,
    private readonly targets: BackupTargetRepository,
    private readonly jobs: BackupJobRepository,
    private readonly gdrive: GoogleDriveService,
    private readonly probe: SourceProbeService,
  ) {}

  private ensureTmp(): string {
    const dir = this.config.tmpDir || '/tmp/mongo-backup'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private async planDump(target: IBackupTarget, mongoUri: string): Promise<DumpPlan> {
    const filter = target.collectionFilter
    const hasCollections = !!filter && ((filter.collections?.length || 0) > 0 || (filter.patterns?.length || 0) > 0)
    if (!hasCollections) {
      return {
        kind: 'single',
        includeDbs: (target.includeDbs || []).filter(Boolean),
        excludeDbs: (target.excludeDbs || []).filter(Boolean),
      }
    }

    const mode = filter!.mode === 'include' ? 'include' : 'exclude'

    // Determine which DBs are in scope (respect includeDbs/excludeDbs).
    const includeDbs = (target.includeDbs || []).filter(Boolean)
    const excludeDbs = new Set((target.excludeDbs || []).filter(Boolean))

    let dbsInScope: string[]
    if (includeDbs.length > 0) {
      dbsInScope = includeDbs
    } else {
      const probed = await this.probe.probe({ mongoUri })
      dbsInScope = probed.filter((d) => !d.isSystem).map((d) => d.name)
    }
    dbsInScope = dbsInScope.filter((d) => !excludeDbs.has(d))

    // Map patterns by DB: "<db>.<rest>" — rest may end with "*" for prefix.
    interface PatternForDb { exact: string[]; prefix: string[] }
    const patternsByDb = new Map<string, PatternForDb>()
    for (const raw of filter!.patterns || []) {
      const dot = raw.indexOf('.')
      if (dot <= 0 || dot === raw.length - 1) continue
      const db = raw.slice(0, dot)
      const rest = raw.slice(dot + 1)
      const bucket = patternsByDb.get(db) || { exact: [], prefix: [] }
      if (rest.endsWith('*')) bucket.prefix.push(rest.slice(0, -1))
      else bucket.exact.push(rest)
      patternsByDb.set(db, bucket)
    }

    // Map explicit picker selections by DB.
    const explicitByDb = new Map<string, Set<string>>()
    for (const c of filter!.collections || []) {
      const set = explicitByDb.get(c.db) || new Set<string>()
      set.add(c.name)
      explicitByDb.set(c.db, set)
    }

    if (mode === 'exclude') {
      const excludeDumps: PerDbExcludePlan[] = []
      for (const db of dbsInScope) {
        const explicit = Array.from(explicitByDb.get(db) || [])
        const pat = patternsByDb.get(db) || { exact: [], prefix: [] }
        const excludeCollections = Array.from(new Set([...explicit, ...pat.exact]))
        const excludePrefixes = Array.from(new Set(pat.prefix))
        excludeDumps.push({ db, excludeCollections, excludePrefixes })
      }
      return { kind: 'bundle', excludeDumps, includeDumps: [] }
    }

    // include mode — enumerate collections per DB (needed to resolve prefix patterns).
    const probed = await this.probe.probe({ mongoUri })
    const collectionsByDb = new Map<string, string[]>()
    for (const d of probed) collectionsByDb.set(d.name, d.collections)

    const includeDumps: PerCollectionIncludePlan[] = []
    for (const db of dbsInScope) {
      const explicit = explicitByDb.get(db) || new Set<string>()
      const pat = patternsByDb.get(db) || { exact: [], prefix: [] }
      const dbCollections = collectionsByDb.get(db) || []
      const picked = new Set<string>(explicit)
      for (const name of pat.exact) picked.add(name)
      for (const prefix of pat.prefix) {
        for (const c of dbCollections) if (c.startsWith(prefix)) picked.add(c)
      }
      for (const name of picked) includeDumps.push({ db, collection: name })
    }
    return { kind: 'bundle', excludeDumps: [], includeDumps }
  }

  private runProcess(bin: string, args: string[]): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('error', (err) => reject(err))
      child.on('close', (code) => {
        if (code === 0) resolve({ stderr })
        else reject(new Error(`${bin} exited with code ${code}\n${stderr}`))
      })
    })
  }

  private dumpSingleArchive(opts: { mongoUri: string; archivePath: string; includeDbs: string[]; excludeDbs: string[] }) {
    const bin = this.config.mongodumpBin || 'mongodump'
    const args = [`--uri=${opts.mongoUri}`, `--archive=${opts.archivePath}`, '--gzip']
    for (const db of opts.includeDbs) if (db) args.push(`--db=${db}`)
    for (const db of opts.excludeDbs) if (db) args.push(`--excludeDatabase=${db}`)
    return this.runProcess(bin, args)
  }

  private dumpDbWithExcludes(opts: { mongoUri: string; archivePath: string; db: string; excludeCollections: string[]; excludePrefixes: string[] }) {
    const bin = this.config.mongodumpBin || 'mongodump'
    const args = [`--uri=${opts.mongoUri}`, `--archive=${opts.archivePath}`, '--gzip', `--db=${opts.db}`]
    for (const c of opts.excludeCollections) if (c) args.push(`--excludeCollection=${c}`)
    for (const p of opts.excludePrefixes) if (p) args.push(`--excludeCollectionsWithPrefix=${p}`)
    return this.runProcess(bin, args)
  }

  private dumpCollection(opts: { mongoUri: string; archivePath: string; db: string; collection: string }) {
    const bin = this.config.mongodumpBin || 'mongodump'
    const args = [
      `--uri=${opts.mongoUri}`,
      `--archive=${opts.archivePath}`,
      '--gzip',
      `--db=${opts.db}`,
      `--collection=${opts.collection}`,
    ]
    return this.runProcess(bin, args)
  }

  private tarBundle(workDir: string, outPath: string) {
    return this.runProcess('tar', ['-cf', outPath, '-C', workDir, '.'])
  }

  private async applyRetention(target: IBackupTarget, accountId: string): Promise<string[]> {
    if (!target.gdriveFolderId || !target.retention || target.retention.mode === 'none') return []
    const removed: string[] = []
    try {
      const files = await this.gdrive.listFilesInFolder(accountId, target.gdriveFolderId)
      if (target.retention.mode === 'count') {
        const keep = target.retention.keepCount || 7
        for (const f of files.slice(keep)) {
          await this.gdrive.deleteFile(accountId, f.id)
          removed.push(f.name)
        }
      } else if (target.retention.mode === 'days') {
        const cutoff = Date.now() - (target.retention.keepDays || 30) * 86400_000
        for (const f of files) {
          if (new Date(f.createdTime).getTime() < cutoff) {
            await this.gdrive.deleteFile(accountId, f.id)
            removed.push(f.name)
          }
        }
      }
    } catch (err) {
      log.warn(`Retention cleanup failed for ${target.name}:`, (err as Error).message)
    }
    return removed
  }

  async run(targetId: string, triggeredBy: 'cron' | 'manual') {
    const target = await this.targets.findById(targetId)
    if (!target) throw new NotFoundError(`Target ${targetId} not found`)

    if (target.machineId) {
      const current = getMachineId()
      if (target.machineId !== current) {
        const now = new Date()
        const msg =
          `Refused: target is bound to machine "${target.machineId}", ` +
          `but this server's machine-id is "${current}". ` +
          `Open the target in the edit page and click "Rebind to this server" if intended.`
        log.warn(`[${target.name}] ${msg}`)
        const job = await this.jobs.create({
          targetId: target._id,
          targetName: target.name,
          status: 'failed',
          triggeredBy,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          archiveFilename: '',
          log: msg,
          error: 'Machine-id binding mismatch',
        })
        await this.targets.patchStatus(String(target._id), now, 'failed')
        return job
      }
    }

    const baseName = `${safeName(target.name)}__${ts()}`
    const tmpRoot = this.ensureTmp()

    const job = await this.jobs.create({
      targetId: target._id,
      targetName: target.name,
      status: 'running',
      triggeredBy,
      startedAt: new Date(),
      archiveFilename: `${baseName}.archive.gz`, // overwritten below for bundle mode
    })

    await this.targets.patchStatus(String(target._id), new Date(), 'running')

    const logLines: string[] = []
    const append = (line: string) => {
      logLines.push(line)
      log.info(`[${target.name}] ${line}`)
    }

    let outputPath = ''
    let outputFilename = ''
    let workDir = ''
    const cleanup = () => {
      try { if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch { /* best-effort */ }
      try { if (workDir && fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }

    try {
      append(`Backup starting (job ${job._id})`)
      if (!target.googleAuthId) {
        throw new Error('Target has no Google account selected. Pick one in the target settings.')
      }
      const accountId = String(target.googleAuthId)
      const mongoUri = decryptString(target.mongoUriEncrypted)

      append('Planning dump...')
      const plan = await this.planDump(target, mongoUri)

      if (plan.kind === 'single') {
        outputFilename = `${baseName}.archive.gz`
        outputPath = path.join(tmpRoot, outputFilename)
        append('Running mongodump (single archive)...')
        const r = await this.dumpSingleArchive({
          mongoUri,
          archivePath: outputPath,
          includeDbs: plan.includeDbs,
          excludeDbs: plan.excludeDbs,
        })
        if (r.stderr) append(`mongodump stderr:\n${r.stderr.trim()}`)
      } else {
        workDir = path.join(tmpRoot, baseName)
        fs.mkdirSync(workDir, { recursive: true })
        if (plan.excludeDumps.length === 0 && plan.includeDumps.length === 0) {
          throw new Error('Collection filter produced an empty backup plan')
        }
        for (const p of plan.excludeDumps) {
          const filename = `${safeName(p.db)}.archive.gz`
          const archivePath = path.join(workDir, filename)
          append(`mongodump db=${p.db}${p.excludeCollections.length ? ` excludes=${p.excludeCollections.join(',')}` : ''}${p.excludePrefixes.length ? ` excludePrefixes=${p.excludePrefixes.join(',')}` : ''}`)
          const r = await this.dumpDbWithExcludes({
            mongoUri,
            archivePath,
            db: p.db,
            excludeCollections: p.excludeCollections,
            excludePrefixes: p.excludePrefixes,
          })
          if (r.stderr) append(`  stderr: ${r.stderr.trim()}`)
        }
        for (const p of plan.includeDumps) {
          const filename = `${safeName(p.db)}__${safeName(p.collection)}.archive.gz`
          const archivePath = path.join(workDir, filename)
          append(`mongodump db=${p.db} collection=${p.collection}`)
          const r = await this.dumpCollection({
            mongoUri,
            archivePath,
            db: p.db,
            collection: p.collection,
          })
          if (r.stderr) append(`  stderr: ${r.stderr.trim()}`)
        }
        outputFilename = `${baseName}.tar`
        outputPath = path.join(tmpRoot, outputFilename)
        append(`Bundling ${fs.readdirSync(workDir).length} archive(s) into ${outputFilename}`)
        await this.tarBundle(workDir, outputPath)
        await this.jobs.update(String(job._id), { archiveFilename: outputFilename })
      }

      const stat = fs.statSync(outputPath)
      append(`Archive created: ${outputFilename} (${formatBytes(stat.size)})`)

      append('Uploading to Google Drive...')
      const upload = await this.gdrive.uploadFile({
        accountId,
        filePath: outputPath,
        filename: outputFilename,
        folderId: target.gdriveFolderId || undefined,
        mimeType: outputFilename.endsWith('.tar') ? 'application/x-tar' : 'application/gzip',
      })
      append(`Uploaded to Drive: ${upload.id}`)

      const removed = await this.applyRetention(target, accountId)
      if (removed.length) append(`Retention removed ${removed.length} old file(s): ${removed.join(', ')}`)

      cleanup()

      const finishedAt = new Date()
      const updated = await this.jobs.update(String(job._id), {
        status: 'success',
        finishedAt,
        durationMs: finishedAt.getTime() - job.startedAt!.getTime(),
        archiveSizeBytes: upload.size,
        archiveFilename: outputFilename,
        gdriveFileId: upload.id,
        gdriveWebViewLink: upload.webViewLink,
        log: logLines.join('\n'),
      })
      await this.targets.patchStatus(String(target._id), finishedAt, 'success')
      return updated!
    } catch (err) {
      const message = (err as Error).message
      append(`FAILED: ${message}`)
      cleanup()

      const finishedAt = new Date()
      const updated = await this.jobs.update(String(job._id), {
        status: 'failed',
        finishedAt,
        durationMs: finishedAt.getTime() - job.startedAt!.getTime(),
        log: logLines.join('\n'),
        error: message,
      })
      await this.targets.patchStatus(String(target._id), finishedAt, 'failed')
      return updated!
    }
  }
}
