import fs from 'node:fs'
import type { Readable } from 'node:stream'
import { Injectable, Inject, AppError, NotFoundError, type OnApplicationBootstrap } from 'truxie'
import { google, type drive_v3 } from 'googleapis'
import type { OAuth2Client, Credentials } from 'google-auth-library'
import { GDRIVE_MODULE_OPTIONS, type GoogleDriveModuleConfig } from '../gdrive.config'
import { GoogleAuthRepository } from '../domain/google-auth.repository'
import { type IGoogleAuth } from '../domain/google-auth.model'
import { decryptString, encryptString } from '~/server/utils/crypto'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('GDrive')

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export interface UploadResult {
  id: string
  name: string
  size: number
  webViewLink: string
}

export interface DriveFile {
  id: string
  name: string
  size: number
  createdTime: string
  webViewLink: string
}

export interface AccountSummary {
  id: string
  label: string
  email: string
  name: string
  picture: string
  connectedAt?: Date
  source: 'oauth' | 'manual'
}

@Injectable()
@Inject(GDRIVE_MODULE_OPTIONS, GoogleAuthRepository)
export class GoogleDriveService implements OnApplicationBootstrap {
  constructor(
    private readonly config: GoogleDriveModuleConfig,
    private readonly authRepo: GoogleAuthRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.authRepo.dropLegacySingletonIndex()
  }

  /**
   * Resolve OAuth app credentials for OAuth (consent-screen) flow.
   * Manual-paste accounts carry their own client_id/secret on the record.
   */
  private resolveEnvAppCredentials(): { clientId: string; clientSecret: string } {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new AppError(
        'OAuth consent flow requires GOOGLE_CLIENT_ID/SECRET in env. Use the manual paste form instead.',
        400,
      )
    }
    return { clientId: this.config.clientId, clientSecret: this.config.clientSecret }
  }

  async getAuthUrl(state: string): Promise<string> {
    const { clientId, clientSecret } = this.resolveEnvAppCredentials()
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, this.config.redirectUri)
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
      include_granted_scopes: true,
    })
  }

  async exchangeCode(code: string, label?: string): Promise<AccountSummary> {
    const { clientId, clientSecret } = this.resolveEnvAppCredentials()
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, this.config.redirectUri)
    const { tokens } = await oauth2.getToken(code)
    if (!tokens.refresh_token) {
      throw new AppError(
        'Google did not return a refresh_token. Revoke this app in your Google account and try again.',
        400,
      )
    }
    oauth2.setCredentials(tokens)
    const userinfo = await google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get()
    const email = userinfo.data.email || ''

    const existing = email ? await this.authRepo.findByEmail(email) : null
    const payload: Partial<IGoogleAuth> = {
      label: (label || '').trim(),
      email,
      name: userinfo.data.name || '',
      picture: userinfo.data.picture || '',
      clientIdEncrypted: '',
      clientSecretEncrypted: '',
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
      accessToken: tokens.access_token || '',
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3500_000),
      scope: tokens.scope || SCOPES.join(' '),
      source: 'oauth',
      connectedAt: new Date(),
    }

    const doc = existing
      ? await this.authRepo.updateById(String(existing._id), payload)
      : await this.authRepo.create(payload)

    log.info(`Connected Google account (oauth): ${email}`)
    return this.toSummary(doc!)
  }

  /**
   * Connect by pasting credentials manually. The refresh_token must have been
   * issued by the same client_id/client_secret pair — Google rejects mismatched
   * pairs with `invalid_grant`. We verify by forcing a userinfo call which
   * triggers an access-token refresh under the hood.
   */
  async connectManual(input: {
    clientId: string
    clientSecret: string
    refreshToken: string
    label?: string
  }): Promise<AccountSummary> {
    const { clientId, clientSecret, refreshToken } = input
    if (!clientId || !clientSecret || !refreshToken) {
      throw new AppError('clientId, clientSecret and refreshToken are required', 400)
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, this.config.redirectUri)
    oauth2.setCredentials({ refresh_token: refreshToken })

    let about
    try {
      about = await google.drive({ version: 'v3', auth: oauth2 }).about.get({
        fields: 'user(emailAddress,displayName,photoLink)',
      })
    } catch (err) {
      const msg = (err as Error).message
      throw new AppError(
        `Could not verify credentials with Google: ${msg}. ` +
          'Check that the refresh token was issued by the same client_id/secret and is not revoked.',
        400,
      )
    }

    const creds = oauth2.credentials
    const email = about.data.user?.emailAddress || ''

    const existing = email ? await this.authRepo.findByEmail(email) : null
    const payload: Partial<IGoogleAuth> = {
      label: (input.label || '').trim(),
      email,
      name: about.data.user?.displayName || '',
      picture: about.data.user?.photoLink || '',
      clientIdEncrypted: encryptString(clientId),
      clientSecretEncrypted: encryptString(clientSecret),
      refreshTokenEncrypted: encryptString(refreshToken),
      accessToken: creds.access_token || '',
      accessTokenExpiresAt: creds.expiry_date ? new Date(creds.expiry_date) : new Date(Date.now() + 3500_000),
      scope: creds.scope || SCOPES.join(' '),
      source: 'manual',
      connectedAt: new Date(),
    }

    const doc = existing
      ? await this.authRepo.updateById(String(existing._id), payload)
      : await this.authRepo.create(payload)

    log.info(`Connected Google account (manual): ${email}`)
    return this.toSummary(doc!)
  }

  async updateLabel(id: string, label: string): Promise<AccountSummary> {
    const doc = await this.authRepo.updateById(id, { label: label.trim() })
    if (!doc) throw new NotFoundError('Google account not found')
    return this.toSummary(doc)
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const docs = await this.authRepo.list()
    return docs.map((d) => this.toSummary(d))
  }

  hasEnvCreds(): boolean {
    return !!(this.config.clientId && this.config.clientSecret)
  }

  getRedirectUri(): string {
    return this.config.redirectUri
  }

  async disconnect(id: string): Promise<void> {
    const ok = await this.authRepo.deleteById(id)
    if (!ok) throw new NotFoundError('Google account not found')
  }

  private toSummary(d: IGoogleAuth): AccountSummary {
    return {
      id: String(d._id),
      label: d.label || '',
      email: d.email || '',
      name: d.name || '',
      picture: d.picture || '',
      connectedAt: d.connectedAt || undefined,
      source: (d.source as 'oauth' | 'manual') || 'oauth',
    }
  }

  private async getAuthorizedClient(accountId: string): Promise<OAuth2Client> {
    const doc = await this.authRepo.findById(accountId)
    if (!doc || !doc.refreshTokenEncrypted) {
      throw new AppError('Google account not connected or refresh token missing.', 400)
    }
    const clientId = doc.clientIdEncrypted ? decryptString(doc.clientIdEncrypted) : this.config.clientId
    const clientSecret = doc.clientSecretEncrypted ? decryptString(doc.clientSecretEncrypted) : this.config.clientSecret
    if (!clientId || !clientSecret) {
      throw new AppError('Google OAuth credentials missing for stored token.', 500)
    }
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, this.config.redirectUri)
    oauth2.setCredentials({
      refresh_token: decryptString(doc.refreshTokenEncrypted),
      access_token: doc.accessToken || undefined,
      expiry_date: doc.accessTokenExpiresAt ? doc.accessTokenExpiresAt.getTime() : undefined,
    })

    oauth2.on('tokens', async (tokens: Credentials) => {
      try {
        const patch: Record<string, unknown> = {}
        if (tokens.access_token) patch.accessToken = tokens.access_token
        if (tokens.expiry_date) patch.accessTokenExpiresAt = new Date(tokens.expiry_date)
        if (tokens.refresh_token) patch.refreshTokenEncrypted = encryptString(tokens.refresh_token)
        if (Object.keys(patch).length) await this.authRepo.patchById(accountId, patch)
      } catch (err) {
        log.warn('Failed to persist refreshed token:', (err as Error).message)
      }
    })
    return oauth2
  }

  private async drive(accountId: string): Promise<drive_v3.Drive> {
    return google.drive({ version: 'v3', auth: await this.getAuthorizedClient(accountId) })
  }

  async uploadFile(opts: {
    accountId: string
    filePath: string
    filename: string
    folderId?: string
    mimeType?: string
  }): Promise<UploadResult> {
    const d = await this.drive(opts.accountId)
    const stat = fs.statSync(opts.filePath)
    const res = await d.files.create({
      requestBody: {
        name: opts.filename,
        parents: opts.folderId ? [opts.folderId] : undefined,
      },
      media: { mimeType: opts.mimeType || 'application/gzip', body: fs.createReadStream(opts.filePath) },
      fields: 'id, name, size, webViewLink',
      supportsAllDrives: true,
    })
    return {
      id: res.data.id!,
      name: res.data.name!,
      size: Number(res.data.size || stat.size),
      webViewLink: res.data.webViewLink || '',
    }
  }

  async listFilesInFolder(accountId: string, folderId: string): Promise<DriveFile[]> {
    const d = await this.drive(accountId)
    const out: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const res = await d.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, size, createdTime, webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files || []) {
        out.push({
          id: f.id!,
          name: f.name!,
          size: Number(f.size || 0),
          createdTime: f.createdTime!,
          webViewLink: f.webViewLink || '',
        })
      }
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)
    return out
  }

  async deleteFile(accountId: string, fileId: string): Promise<void> {
    const d = await this.drive(accountId)
    await d.files.delete({ fileId, supportsAllDrives: true })
  }

  async getFileMeta(accountId: string, fileId: string): Promise<{ id: string; name: string; size: number; mimeType: string }> {
    const d = await this.drive(accountId)
    const res = await d.files.get({
      fileId,
      fields: 'id, name, size, mimeType',
      supportsAllDrives: true,
    })
    return {
      id: res.data.id || fileId,
      name: res.data.name || '',
      size: Number(res.data.size || 0),
      mimeType: res.data.mimeType || 'application/octet-stream',
    }
  }

  async openFileStream(accountId: string, fileId: string): Promise<Readable> {
    const d = await this.drive(accountId)
    const res = await d.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    )
    return res.data as unknown as Readable
  }

  async listFolders(accountId: string, parentId?: string): Promise<{ id: string; name: string }[]> {
    const d = await this.drive(accountId)
    const q = [
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      parentId ? `'${parentId}' in parents` : "'root' in parents",
    ].join(' and ')
    const res = await d.files.list({
      q,
      fields: 'files(id, name)',
      orderBy: 'name',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    return (res.data.files || []).map((f) => ({ id: f.id!, name: f.name! }))
  }

  async ensureFolder(accountId: string, name: string, parentId?: string): Promise<{ id: string; name: string }> {
    const d = await this.drive(accountId)
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      parentId ? `'${parentId}' in parents` : "'root' in parents",
    ].join(' and ')
    const found = await d.files.list({
      q,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    const matched = found.data.files?.[0]
    if (matched && matched.id) {
      return { id: matched.id, name: matched.name || name }
    }
    const created = await d.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      fields: 'id, name',
      supportsAllDrives: true,
    })
    return { id: created.data.id!, name: created.data.name! }
  }
}
