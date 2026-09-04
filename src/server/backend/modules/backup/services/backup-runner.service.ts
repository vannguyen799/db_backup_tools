import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
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
import { isObjectId } from '~/server/utils/object-id'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('BackupRunner')

const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 2000

// How often a running job refreshes its heartbeat, and how long a heartbeat may go
// unrefreshed before the job is considered orphaned by a dead process.
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_STALE_AFTER_MS = 5 * 60_000

// A job log is one Mongo document; mongodump prints a progress line per collection,
// so a wide bundle run can otherwise walk into the 16MB document limit.
const MAX_LOG_CHARS = 200_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(label: string, fn: () => Promise<T>, onAttempt?: (msg: string) => void): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < RETRY_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
        onAttempt?.(`${label} attempt ${attempt}/${RETRY_ATTEMPTS} failed: ${(err as Error).message}. Retrying in ${delay}ms...`)
        await sleep(delay)
      }
    }
  }
  throw lastErr
}

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

function capLog(lines: string[]): string {
  const text = lines.join('\n')
  if (text.length <= MAX_LOG_CHARS) return text
  const trimmed = text.length - MAX_LOG_CHARS
  return `… ${trimmed} earlier character(s) trimmed …\n${text.slice(-MAX_LOG_CHARS)}`
}

/**
 * Split the password out of a Postgres URI. Everything on a process command line is
 * readable by any local user through `ps` / /proc/<pid>/cmdline for as long as the
 * dump runs, so the password travels in PGPASSWORD and only the non-secret
 * host/database part stays in argv. An unparseable URI is passed through untouched.
 */
function splitPgSecret(uri: string): { dsn: string; password?: string } {
  try {
    const u = new URL(uri)
    if (!u.password) return { dsn: uri }
    const password = decodeURIComponent(u.password)
    u.password = ''
    return { dsn: u.toString(), password }
  } catch {
    return { dsn: uri }
  }
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

interface PgDumpPlan {
  includeTables: string[]
  excludeTables: string[]
}

export type TriggeredBy = 'cron' | 'manual' | 'api'

interface PreparedRun {
  target: IBackupTarget
  job: Awaited<ReturnType<BackupJobRepository['create']>>
  baseName: string
  tmpRoot: string
}

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

  // Spawn a process and stream its stdout through gzip into outPath (used for pg_dump | gzip).
  private runGzipProcess(
    bin: string,
    args: string[],
    outPath: string,
    extraEnv?: Record<string, string>,
  ): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      })
      let stderr = ''
      let settled = false
      let childExited = false
      let exitCode: number | null = null
      let exitSignal: NodeJS.Signals | null = null
      let fileClosed = false

      const gzip = zlib.createGzip()
      const out = fs.createWriteStream(outPath)

      const fail = (err: Error) => {
        if (settled) return
        settled = true
        // Tear down a still-running dump and its pipeline so we don't leak the child
        // process, its server-side DB connection, or the open file handle, and drop
        // the partial/corrupt archive before withRetry spawns the next attempt.
        if (!child.killed) child.kill('SIGKILL')
        gzip.destroy()
        out.destroy()
        fs.unlink(outPath, () => {})
        reject(err)
      }
      const maybeSettle = () => {
        // Require BOTH the child to have exited and the gzip output to be flushed/closed.
        // Track exit with a dedicated flag — a signal kill reports code === null, which
        // must be treated as failure, not as "not exited yet".
        if (settled || !childExited || !fileClosed) return
        if (exitCode === 0) {
          settled = true
          resolve({ stderr })
        } else {
          const how = exitSignal ? `signal ${exitSignal}` : `code ${exitCode}`
          fail(new Error(`${bin} exited with ${how}\n${stderr}`))
        }
      }

      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('error', fail)

      gzip.on('error', fail)
      out.on('error', fail)
      out.on('close', () => { fileClosed = true; maybeSettle() })
      child.on('close', (code, signal) => {
        childExited = true
        exitCode = code
        exitSignal = signal
        maybeSettle()
      })

      child.stdout.pipe(gzip).pipe(out)
    })
  }

  private planPgDump(target: IBackupTarget): PgDumpPlan {
    const filter = target.collectionFilter
    const names = (filter?.collections || []).map((c) => c.name).filter(Boolean)
    const patterns = (filter?.patterns || []).filter(Boolean)
    const tables = Array.from(new Set([...names, ...patterns]))
    if (!tables.length) {
      // "Include nothing" must NOT fall through to a whole-database dump: pg_dump with
      // no --table flags dumps everything, which is the opposite of the user's intent.
      // Fail loudly instead, mirroring the Mongo path's empty-plan rejection.
      if (filter?.mode === 'include') {
        throw new Error('Include filter selected no tables — refusing to dump the whole database')
      }
      return { includeTables: [], excludeTables: [] }
    }
    if (filter?.mode === 'include') return { includeTables: tables, excludeTables: [] }
    return { includeTables: [], excludeTables: tables }
  }

  private dumpPostgres(opts: { uri: string; outPath: string; plan: PgDumpPlan }) {
    const bin = this.config.pgDumpBin || 'pg_dump'
    const { dsn, password } = splitPgSecret(opts.uri)
    const args = [`--dbname=${dsn}`, '--no-owner', '--no-privileges']
    for (const t of opts.plan.includeTables) if (t) args.push(`--table=${t}`)
    for (const t of opts.plan.excludeTables) if (t) args.push(`--exclude-table=${t}`)
    return this.runGzipProcess(bin, args, opts.outPath, password ? { PGPASSWORD: password } : undefined)
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
    if (!target.retention || target.retention.mode === 'none') return []
    const removed: string[] = []
    try {
      // Retention works off THIS target's own job records, never off Drive filenames.
      // Names cannot carry the ownership: renaming a target orphans every archive
      // written under the old name (they would then live forever), and two names that
      // collide once safeName() has sanitised them would delete each other's backups.
      // A job row names exactly one file this target uploaded.
      const uploaded = await this.jobs.listUploaded(String(target._id))

      let doomed = [] as typeof uploaded
      if (target.retention.mode === 'count') {
        const keep = Math.max(target.retention.keepCount || 7, 1)
        doomed = uploaded.slice(keep)
      } else if (target.retention.mode === 'days') {
        const cutoff = Date.now() - (target.retention.keepDays || 30) * 86400_000
        doomed = uploaded.filter((j) => j.startedAt != null && new Date(j.startedAt).getTime() < cutoff)
      }

      for (const job of doomed) {
        if (!job.gdriveFileId) continue
        try {
          await this.gdrive.deleteFile(accountId, job.gdriveFileId)
        } catch (err) {
          // Already gone from Drive (someone deleted it by hand): still drop our
          // pointer so the job stops advertising a download that cannot work.
          const msg = (err as Error).message
          if (!/not found|404/i.test(msg)) throw err
          log.warn(`Retention: ${job.gdriveFileId} already absent from Drive (${msg})`)
        }
        await this.jobs.clearGdriveFile(String(job._id))
        removed.push(job.archiveFilename || job.gdriveFileId)
      }
    } catch (err) {
      log.warn(`Retention cleanup failed for ${target.name}:`, (err as Error).message)
    }
    return removed
  }

  /**
   * The job currently running for a target, or null when none is. A `running` job
   * whose heartbeat has gone stale belongs to a process that died mid-dump, so it is
   * retired here: without that, one crash leaves the target wedged as "running" and
   * every later API trigger becomes a silent no-op.
   */
  async findActiveJob(targetId: string) {
    const running = await this.jobs.findRunningByTarget(targetId)
    if (!running) return null

    const beat = running.lastHeartbeatAt ?? running.startedAt
    if (beat && Date.now() - new Date(beat).getTime() < HEARTBEAT_STALE_AFTER_MS) return running

    const finishedAt = new Date()
    await this.jobs.update(String(running._id), {
      status: 'failed',
      finishedAt,
      error: 'Interrupted — the server stopped while this backup was running',
    })
    await this.targets.patchStatus(targetId, finishedAt, 'failed')
    log.warn(`[${running.targetName}] retired orphaned job ${running._id} (no heartbeat)`)
    return null
  }

  /** Run a backup to completion and return the final job (used by cron + manual UI trigger). */
  async run(targetId: string, triggeredBy: TriggeredBy, reason?: string) {
    const prep = await this.prepare(targetId, triggeredBy, reason)
    if ('failedJob' in prep) return prep.failedJob
    return this.execute(prep)
  }

  /**
   * Create the BackupJob synchronously and return it immediately while the dump
   * and upload run in the background. Used by the API trigger so callers get a
   * jobId to poll without waiting for the whole backup to finish.
   */
  async start(targetId: string, triggeredBy: TriggeredBy, reason?: string) {
    const prep = await this.prepare(targetId, triggeredBy, reason)
    if ('failedJob' in prep) return prep.failedJob
    this.execute(prep).catch((err) => {
      log.error(`[${prep.target.name}] backup crashed: ${(err as Error).message}`)
    })
    return prep.job
  }

  /** Validate the target + machine binding and create the running job record. */
  private async prepare(
    targetId: string,
    triggeredBy: TriggeredBy,
    reason?: string,
  ): Promise<{ failedJob: PreparedRun['job'] } | PreparedRun> {
    if (!isObjectId(targetId)) throw new NotFoundError(`Target ${targetId} not found`)
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
        const failedJob = await this.jobs.create({
          targetId: target._id,
          targetName: target.name,
          status: 'failed',
          triggeredBy,
          reason: reason?.trim() || undefined,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          archiveFilename: '',
          log: msg,
          error: 'Machine-id binding mismatch',
        })
        await this.targets.patchStatus(String(target._id), now, 'failed')
        return { failedJob }
      }
    }

    const baseName = `${safeName(target.name)}__${ts()}`
    const tmpRoot = this.ensureTmp()

    const job = await this.jobs.create({
      targetId: target._id,
      targetName: target.name,
      status: 'running',
      triggeredBy,
      reason: reason?.trim() || undefined,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      archiveFilename: `${baseName}.archive.gz`, // overwritten below for bundle mode
    })

    await this.targets.patchStatus(String(target._id), new Date(), 'running')

    return { target: target as unknown as IBackupTarget, job, baseName, tmpRoot }
  }

  /** Perform the actual dump, upload, retention and final status update. */
  private async execute(prep: PreparedRun) {
    const { target, job, baseName, tmpRoot } = prep

    const logLines: string[] = []
    const append = (line: string) => {
      logLines.push(line)
      log.info(`[${target.name}] ${line}`)
    }

    // Keep the job's heartbeat fresh so a caller can tell a live backup from one
    // orphaned by a process that died mid-dump. `unref` so it never holds the
    // event loop open on shutdown.
    const heartbeat = setInterval(() => {
      this.jobs.heartbeat(String(job._id)).catch(() => {})
    }, HEARTBEAT_INTERVAL_MS)
    heartbeat.unref?.()

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
      const connectionUri = decryptString(target.mongoUriEncrypted)
      const isPostgres = target.databaseType === 'postgresql'

      if (isPostgres) {
        outputFilename = `${baseName}.sql.gz`
        outputPath = path.join(tmpRoot, outputFilename)
        const plan = this.planPgDump(target)
        const scope = plan.includeTables.length
          ? `including ${plan.includeTables.join(', ')}`
          : plan.excludeTables.length
            ? `excluding ${plan.excludeTables.join(', ')}`
            : 'whole database'
        append(`Running pg_dump (${scope})...`)
        const r = await withRetry('pg_dump', () => this.dumpPostgres({
          uri: connectionUri,
          outPath: outputPath,
          plan,
        }), append)
        if (r.stderr) append(`pg_dump stderr:\n${r.stderr.trim()}`)
        await this.jobs.update(String(job._id), { archiveFilename: outputFilename })
      } else {
      append('Planning dump...')
      const plan = await this.planDump(target, connectionUri)

      if (plan.kind === 'single') {
        outputFilename = `${baseName}.archive.gz`
        outputPath = path.join(tmpRoot, outputFilename)
        append('Running mongodump (single archive)...')
        const r = await withRetry('mongodump', () => this.dumpSingleArchive({
          mongoUri: connectionUri,
          archivePath: outputPath,
          includeDbs: plan.includeDbs,
          excludeDbs: plan.excludeDbs,
        }), append)
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
          const r = await withRetry(`mongodump db=${p.db}`, () => this.dumpDbWithExcludes({
            mongoUri: connectionUri,
            archivePath,
            db: p.db,
            excludeCollections: p.excludeCollections,
            excludePrefixes: p.excludePrefixes,
          }), append)
          if (r.stderr) append(`  stderr: ${r.stderr.trim()}`)
        }
        for (const p of plan.includeDumps) {
          const filename = `${safeName(p.db)}__${safeName(p.collection)}.archive.gz`
          const archivePath = path.join(workDir, filename)
          append(`mongodump db=${p.db} collection=${p.collection}`)
          const r = await withRetry(`mongodump db=${p.db} collection=${p.collection}`, () => this.dumpCollection({
            mongoUri: connectionUri,
            archivePath,
            db: p.db,
            collection: p.collection,
          }), append)
          if (r.stderr) append(`  stderr: ${r.stderr.trim()}`)
        }
        outputFilename = `${baseName}.tar`
        outputPath = path.join(tmpRoot, outputFilename)
        append(`Bundling ${fs.readdirSync(workDir).length} archive(s) into ${outputFilename}`)
        await this.tarBundle(workDir, outputPath)
        await this.jobs.update(String(job._id), { archiveFilename: outputFilename })
      }
      }

      const stat = fs.statSync(outputPath)
      append(`Archive created: ${outputFilename} (${formatBytes(stat.size)})`)

      append('Uploading to Google Drive...')
      const upload = await withRetry('gdrive upload', () => this.gdrive.uploadFile({
        accountId,
        filePath: outputPath,
        filename: outputFilename,
        folderId: target.gdriveFolderId || undefined,
        mimeType: outputFilename.endsWith('.tar') ? 'application/x-tar' : 'application/gzip',
      }), append)
      append(`Uploaded to Drive: ${upload.id}`)

      // Record the archive BEFORE retention runs: retention counts this target's job
      // records, so the run that just uploaded has to be inside the keep-window like
      // every other. It also means the Drive file is never orphaned if the process
      // dies between the upload and the final status write.
      await this.jobs.update(String(job._id), {
        archiveFilename: outputFilename,
        archiveSizeBytes: upload.size,
        gdriveFileId: upload.id,
        gdriveWebViewLink: upload.webViewLink,
      })

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
        log: capLog(logLines),
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
        log: capLog(logLines),
        error: message,
      })
      await this.targets.patchStatus(String(target._id), finishedAt, 'failed')
      return updated!
    } finally {
      clearInterval(heartbeat)
    }
  }
}
