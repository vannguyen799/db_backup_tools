import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { Injectable, Inject, AppError, NotFoundError } from 'truxie'
import { ONEDRIVE_MODULE_OPTIONS, type OneDriveModuleConfig } from '../onedrive.config'
import { MicrosoftAuthRepository } from '../domain/microsoft-auth.repository'
import { type IMicrosoftAuth } from '../domain/microsoft-auth.model'
import { decryptString, encryptString } from '~/server/utils/crypto'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('OneDrive')

const GRAPH = 'https://graph.microsoft.com/v1.0'
const LOGIN = 'https://login.microsoftonline.com'

// offline_access is what makes the token endpoint hand back a refresh token.
const SCOPES = ['offline_access', 'User.Read', 'Files.ReadWrite']

// Files up to this size go up in a single PUT; Graph caps simple upload at 250MB
// but recommends upload sessions well before that.
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024
// Upload-session chunks must be a multiple of 320 KiB (and at most 60 MiB).
const CHUNK_SIZE = 320 * 1024 * 32 // 10 MiB
const CHUNK_ATTEMPTS = 4
const CHUNK_TIMEOUT_MS = 5 * 60_000
// Refresh slightly before expiry so a token never dies mid-request.
const TOKEN_SKEW_MS = 2 * 60_000

export interface UploadResult {
  id: string
  name: string
  size: number
  webUrl: string
}

export interface AccountSummary {
  id: string
  label: string
  email: string
  name: string
  tenant: string
  connectedAt?: Date
  source: 'oauth' | 'manual'
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

interface DriveItem {
  id: string
  name: string
  size?: number
  webUrl?: string
  folder?: unknown
  file?: { mimeType?: string }
  '@microsoft.graph.downloadUrl'?: string
}

interface GraphUser {
  displayName?: string
  mail?: string | null
  userPrincipalName?: string
}

interface DeviceFlow {
  deviceCode: string
  clientId: string
  tenant: string
  label?: string
  expiresAt: number
}

const DEVICE_FLOWS = new Map<string, DeviceFlow>()

function pruneDeviceFlows() {
  const now = Date.now()
  for (const [k, v] of DEVICE_FLOWS) if (v.expiresAt < now) DEVICE_FLOWS.delete(k)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Graph/identity errors carry `{error:{code,message}}` or `{error, error_description}`. */
async function graphError(res: Response, what: string): Promise<AppError> {
  let detail = res.statusText
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } | string; error_description?: string }
    if (typeof body.error === 'string') detail = `${body.error}: ${body.error_description || ''}`.trim()
    else if (body.error) detail = `${body.error.code || ''}: ${body.error.message || ''}`.trim()
  } catch { /* non-JSON body */ }
  // Keep the status in the message: retention matches on "404" to tell an
  // already-deleted file from a real failure.
  const status = res.status >= 400 && res.status < 500 ? 400 : 502
  return new AppError(`${what} failed (${res.status} ${detail})`, res.status === 404 ? 404 : status)
}

@Injectable()
@Inject(ONEDRIVE_MODULE_OPTIONS, MicrosoftAuthRepository)
export class OneDriveService {
  // One in-flight refresh per account: Microsoft rotates refresh tokens, so two
  // concurrent refreshes would race to persist different tokens.
  private readonly refreshing = new Map<string, Promise<string>>()

  constructor(
    private readonly config: OneDriveModuleConfig,
    private readonly authRepo: MicrosoftAuthRepository,
  ) {}

  private defaultTenant(): string {
    return this.config.tenant || 'common'
  }

  private resolveEnvAppCredentials(): { clientId: string; clientSecret: string } {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new AppError(
        'OAuth consent flow requires MICROSOFT_CLIENT_ID/SECRET in env. Use the manual paste form instead.',
        400,
      )
    }
    return { clientId: this.config.clientId, clientSecret: this.config.clientSecret }
  }

  hasEnvCreds(): boolean {
    return !!(this.config.clientId && this.config.clientSecret)
  }

  getRedirectUri(): string {
    return this.config.redirectUri
  }

  getAuthUrl(state: string): string {
    const { clientId } = this.resolveEnvAppCredentials()
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state,
      prompt: 'select_account',
    })
    return `${LOGIN}/${encodeURIComponent(this.defaultTenant())}/oauth2/v2.0/authorize?${params}`
  }

  private async requestToken(tenant: string, form: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ scope: SCOPES.join(' '), ...form }),
    })
    if (!res.ok) throw await graphError(res, 'Microsoft token request')
    return (await res.json()) as TokenResponse
  }

  private async fetchUser(accessToken: string): Promise<GraphUser> {
    const res = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw await graphError(res, 'Reading the Microsoft account profile')
    return (await res.json()) as GraphUser
  }

  private async saveAccount(
    tokens: TokenResponse,
    user: GraphUser,
    extra: Pick<IMicrosoftAuth, 'tenant' | 'clientIdEncrypted' | 'clientSecretEncrypted' | 'source'> & {
      label?: string
      refreshToken: string
    },
  ): Promise<AccountSummary> {
    const email = user.mail || user.userPrincipalName || ''
    const existing = email ? await this.authRepo.findByEmail(email) : null
    const payload: Partial<IMicrosoftAuth> = {
      label: (extra.label || '').trim(),
      email,
      name: user.displayName || '',
      tenant: extra.tenant,
      clientIdEncrypted: extra.clientIdEncrypted,
      clientSecretEncrypted: extra.clientSecretEncrypted,
      refreshTokenEncrypted: encryptString(tokens.refresh_token || extra.refreshToken),
      accessTokenEncrypted: encryptString(tokens.access_token),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope || SCOPES.join(' '),
      source: extra.source,
      connectedAt: new Date(),
    }
    const doc = existing
      ? await this.authRepo.updateById(String(existing._id), payload)
      : await this.authRepo.create(payload)
    log.info(`Connected Microsoft account (${extra.source}): ${email}`)
    return this.toSummary(doc!)
  }

  async exchangeCode(code: string, label?: string): Promise<AccountSummary> {
    const { clientId, clientSecret } = this.resolveEnvAppCredentials()
    const tokens = await this.requestToken(this.defaultTenant(), {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    })
    if (!tokens.refresh_token) {
      throw new AppError('Microsoft did not return a refresh_token — the offline_access scope was not granted.', 400)
    }
    const user = await this.fetchUser(tokens.access_token)
    return this.saveAccount(tokens, user, {
      label,
      refreshToken: tokens.refresh_token,
      tenant: this.defaultTenant(),
      clientIdEncrypted: '',
      clientSecretEncrypted: '',
      source: 'oauth',
    })
  }

  /**
   * Connect by pasting an app registration's client id (+ secret for a confidential
   * "Web" app; omit it for a public client) and a refresh token it issued. Verified
   * by redeeming the refresh token right away.
   */
  async connectManual(input: {
    clientId: string
    clientSecret?: string
    refreshToken: string
    tenant?: string
    label?: string
  }): Promise<AccountSummary> {
    const { clientId, clientSecret, refreshToken } = input
    if (!clientId || !refreshToken) {
      throw new AppError('clientId and refreshToken are required', 400)
    }
    const tenant = input.tenant || this.defaultTenant()

    let tokens: TokenResponse
    let user: GraphUser
    try {
      tokens = await this.requestToken(tenant, {
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
      user = await this.fetchUser(tokens.access_token)
    } catch (err) {
      throw new AppError(
        `Could not verify credentials with Microsoft: ${(err as Error).message}. ` +
          'Check that the refresh token was issued by the same client id (and tenant) and is not revoked.',
        400,
      )
    }

    return this.saveAccount(tokens, user, {
      label: input.label,
      refreshToken,
      tenant,
      clientIdEncrypted: encryptString(clientId),
      clientSecretEncrypted: clientSecret ? encryptString(clientSecret) : '',
      source: 'manual',
    })
  }

  /**
   * Device code flow: no redirect URI or client secret. The user enters a short code at
   * microsoft.com/link while we poll the token endpoint. Needs a client id with
   * "Allow public client flows" enabled (own app registration or env MICROSOFT_CLIENT_ID).
   */
  async startDeviceCode(input: { clientId?: string; tenant?: string; label?: string }) {
    const clientId = (input.clientId || this.config.clientId || '').trim()
    if (!clientId) throw new AppError('clientId is required (or set MICROSOFT_CLIENT_ID)', 400)
    const tenant = (input.tenant || '').trim() || 'consumers'
    const res = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPES.join(' ') }),
    })
    if (!res.ok) throw await graphError(res, 'Microsoft device code request')
    const body = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval?: number
    }
    pruneDeviceFlows()
    const id = crypto.randomBytes(16).toString('hex')
    DEVICE_FLOWS.set(id, {
      deviceCode: body.device_code,
      clientId,
      tenant,
      label: input.label,
      expiresAt: Date.now() + body.expires_in * 1000,
    })
    return {
      id,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresIn: body.expires_in,
      interval: body.interval || 5,
    }
  }

  async pollDeviceCode(id: string): Promise<{ status: 'pending' } | { status: 'connected'; account: AccountSummary }> {
    pruneDeviceFlows()
    const flow = DEVICE_FLOWS.get(id)
    if (!flow) throw new AppError('Device code expired or unknown — start again', 400)
    const res = await fetch(`${LOGIN}/${encodeURIComponent(flow.tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: flow.clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: flow.deviceCode,
      }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
      if (err.error === 'authorization_pending' || err.error === 'slow_down') return { status: 'pending' }
      DEVICE_FLOWS.delete(id)
      throw new AppError(`Microsoft sign-in failed: ${err.error || res.status} ${err.error_description || ''}`.trim(), 400)
    }
    const tokens = (await res.json()) as TokenResponse
    DEVICE_FLOWS.delete(id)
    if (!tokens.refresh_token) {
      throw new AppError('Microsoft did not return a refresh_token — the offline_access scope was not granted.', 400)
    }
    const user = await this.fetchUser(tokens.access_token)
    const account = await this.saveAccount(tokens, user, {
      label: flow.label,
      refreshToken: tokens.refresh_token,
      tenant: flow.tenant,
      clientIdEncrypted: encryptString(flow.clientId),
      clientSecretEncrypted: '',
      source: 'manual',
    })
    return { status: 'connected', account }
  }

  async updateLabel(id: string, label: string): Promise<AccountSummary> {
    const doc = await this.authRepo.updateById(id, { label: label.trim() })
    if (!doc) throw new NotFoundError('Microsoft account not found')
    return this.toSummary(doc)
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const docs = await this.authRepo.list()
    return docs.map((d) => this.toSummary(d))
  }

  async disconnect(id: string): Promise<void> {
    const ok = await this.authRepo.deleteById(id)
    if (!ok) throw new NotFoundError('Microsoft account not found')
  }

  private toSummary(d: IMicrosoftAuth): AccountSummary {
    return {
      id: String(d._id),
      label: d.label || '',
      email: d.email || '',
      name: d.name || '',
      tenant: d.tenant || 'common',
      connectedAt: d.connectedAt || undefined,
      source: (d.source as 'oauth' | 'manual') || 'oauth',
    }
  }

  private async getAccessToken(accountId: string): Promise<string> {
    const doc = await this.authRepo.findById(accountId)
    if (!doc || !doc.refreshTokenEncrypted) {
      throw new AppError('Microsoft account not connected or refresh token missing.', 400)
    }
    const expiresAt = doc.accessTokenExpiresAt ? new Date(doc.accessTokenExpiresAt).getTime() : 0
    if (doc.accessTokenEncrypted && expiresAt - TOKEN_SKEW_MS > Date.now()) {
      return decryptString(doc.accessTokenEncrypted)
    }

    const pending = this.refreshing.get(accountId)
    if (pending) return pending
    const p = this.refreshAccessToken(accountId, doc).finally(() => this.refreshing.delete(accountId))
    this.refreshing.set(accountId, p)
    return p
  }

  private async refreshAccessToken(accountId: string, doc: IMicrosoftAuth): Promise<string> {
    const clientId = doc.clientIdEncrypted ? decryptString(doc.clientIdEncrypted) : this.config.clientId
    const clientSecret = doc.clientIdEncrypted
      ? decryptString(doc.clientSecretEncrypted || '')
      : this.config.clientSecret
    if (!clientId) throw new AppError('Microsoft OAuth credentials missing for stored token.', 500)

    const tokens = await this.requestToken(doc.tenant || this.defaultTenant(), {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      grant_type: 'refresh_token',
      refresh_token: decryptString(doc.refreshTokenEncrypted),
    })
    const patch: Partial<IMicrosoftAuth> = {
      accessTokenEncrypted: encryptString(tokens.access_token),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    }
    if (tokens.refresh_token) patch.refreshTokenEncrypted = encryptString(tokens.refresh_token)
    try {
      await this.authRepo.patchById(accountId, patch)
    } catch (err) {
      log.warn('Failed to persist refreshed token:', (err as Error).message)
    }
    return tokens.access_token
  }

  /** Call Graph as the account. `path` is relative to /v1.0, or an absolute @odata.nextLink. */
  private async graph<T>(accountId: string, method: string, path: string, body?: unknown, what = 'OneDrive request'): Promise<T> {
    const token = await this.getAccessToken(accountId)
    const res = await fetch(path.startsWith('https://') ? path : `${GRAPH}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw await graphError(res, what)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  private parentPath(folderId?: string): string {
    return folderId ? `/me/drive/items/${encodeURIComponent(folderId)}` : '/me/drive/root'
  }

  async uploadFile(opts: { accountId: string; filePath: string; filename: string; folderId?: string }): Promise<UploadResult> {
    const size = fs.statSync(opts.filePath).size
    const target = `${this.parentPath(opts.folderId)}:/${encodeURIComponent(opts.filename)}:`

    let item: DriveItem
    if (size <= SIMPLE_UPLOAD_MAX) {
      const token = await this.getAccessToken(opts.accountId)
      const res = await fetch(`${GRAPH}${target}/content?@microsoft.graph.conflictBehavior=rename`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: fs.readFileSync(opts.filePath),
      })
      if (!res.ok) throw await graphError(res, 'OneDrive upload')
      item = (await res.json()) as DriveItem
    } else {
      item = await this.uploadInSession(opts.accountId, target, opts.filePath, size)
    }
    return { id: item.id, name: item.name, size: Number(item.size ?? size), webUrl: item.webUrl || '' }
  }

  /**
   * Resumable upload: the file goes up in CHUNK_SIZE slices, and after any failed
   * slice the session is asked which bytes it still expects, so a dropped
   * connection resumes instead of restarting a multi-GB upload.
   */
  private async uploadInSession(accountId: string, target: string, filePath: string, size: number): Promise<DriveItem> {
    const session = await this.graph<{ uploadUrl: string }>(
      accountId,
      'POST',
      `${target}/createUploadSession`,
      { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
      'Creating the OneDrive upload session',
    )
    // The upload URL is pre-authenticated: sending a bearer token to it is rejected.
    const uploadUrl = session.uploadUrl
    const fh = await fs.promises.open(filePath, 'r')
    try {
      let offset = 0
      let failures = 0
      while (offset < size) {
        const len = Math.min(CHUNK_SIZE, size - offset)
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, offset)
        try {
          const res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'content-range': `bytes ${offset}-${offset + len - 1}/${size}` },
            body: buf,
            signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
          })
          if (res.status === 200 || res.status === 201) return (await res.json()) as DriveItem
          if (res.status === 202) {
            const body = (await res.json()) as { nextExpectedRanges?: string[] }
            offset = nextOffset(body.nextExpectedRanges, offset + len)
            failures = 0
            continue
          }
          throw await graphError(res, 'OneDrive chunk upload')
        } catch (err) {
          if (++failures >= CHUNK_ATTEMPTS) throw err
          log.warn(`Chunk at ${offset} failed (${(err as Error).message}); resuming...`)
          await sleep(1000 * 2 ** failures)
          const status = await fetch(uploadUrl).catch(() => null)
          if (status?.ok) {
            const body = (await status.json()) as { nextExpectedRanges?: string[] }
            offset = nextOffset(body.nextExpectedRanges, offset)
          }
        }
      }
      throw new AppError('OneDrive upload session ended without returning the file', 502)
    } catch (err) {
      await fetch(uploadUrl, { method: 'DELETE' }).catch(() => {})
      throw err
    } finally {
      await fh.close()
    }
  }

  async deleteFile(accountId: string, itemId: string): Promise<void> {
    await this.graph(accountId, 'DELETE', `/me/drive/items/${encodeURIComponent(itemId)}`, undefined, 'OneDrive delete')
  }

  async getFileMeta(accountId: string, itemId: string): Promise<{ id: string; name: string; size: number; mimeType: string }> {
    const item = await this.graph<DriveItem>(
      accountId,
      'GET',
      `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,size,file`,
      undefined,
      'Reading OneDrive file',
    )
    return {
      id: item.id || itemId,
      name: item.name || '',
      size: Number(item.size || 0),
      mimeType: item.file?.mimeType || 'application/octet-stream',
    }
  }

  async openFileStream(accountId: string, itemId: string): Promise<Readable> {
    // The item carries a short-lived pre-authenticated download URL; fetching it
    // directly avoids forwarding the bearer token across the /content redirect.
    const item = await this.graph<DriveItem>(
      accountId,
      'GET',
      `/me/drive/items/${encodeURIComponent(itemId)}`,
      undefined,
      'Reading OneDrive file',
    )
    const url = item['@microsoft.graph.downloadUrl']
    if (!url) throw new AppError('OneDrive did not return a download URL for this file', 502)
    const res = await fetch(url)
    if (!res.ok || !res.body) throw await graphError(res, 'OneDrive download')
    return Readable.fromWeb(res.body as unknown as WebReadableStream)
  }

  private async listChildFolders(accountId: string, parentId?: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = []
    let next: string | undefined = `${this.parentPath(parentId)}/children?$select=id,name,folder&$top=200`
    while (next) {
      const page: { value: DriveItem[]; '@odata.nextLink'?: string } = await this.graph(
        accountId,
        'GET',
        next,
        undefined,
        'Listing OneDrive folders',
      )
      for (const it of page.value || []) if (it.folder) out.push({ id: it.id, name: it.name })
      next = page['@odata.nextLink']
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  listFolders(accountId: string, parentId?: string): Promise<{ id: string; name: string }[]> {
    return this.listChildFolders(accountId, parentId)
  }

  async ensureFolder(accountId: string, name: string, parentId?: string): Promise<{ id: string; name: string }> {
    const clean = name.trim()
    if (!clean) throw new AppError('Folder name is required', 400)
    // OneDrive names are case-insensitive, so match the way the service would.
    const find = async () =>
      (await this.listChildFolders(accountId, parentId)).find((f) => f.name.toLowerCase() === clean.toLowerCase())
    const found = await find()
    if (found) return found
    try {
      const created = await this.graph<DriveItem>(
        accountId,
        'POST',
        `${this.parentPath(parentId)}/children`,
        { name: clean, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
        'Creating OneDrive folder',
      )
      return { id: created.id, name: created.name }
    } catch (err) {
      // Lost a race with a concurrent create: the folder exists now.
      const again = await find()
      if (again) return again
      throw err
    }
  }
}

/** First byte the session still wants, from ranges like ["10485760-"] or ["0-1023", "2048-"]. */
function nextOffset(ranges: string[] | undefined, fallback: number): number {
  const first = ranges?.[0]
  if (!first) return fallback
  const start = Number.parseInt(first.split('-')[0] || '', 10)
  return Number.isFinite(start) ? start : fallback
}
