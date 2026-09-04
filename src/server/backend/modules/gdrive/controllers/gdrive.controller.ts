import crypto from 'node:crypto'
import { Inject, Controller, Get, Post, Patch, Delete, RouteGuards, NoGuard, Body, Param, Query, redirect } from 'truxie'
import { McpExpose } from '@truxie/mcp'
import { AuthGuard } from '$/guards/auth.guard'
import { GoogleDriveService } from '../services/gdrive.service'
import { sendSuccess } from '~/server/utils/response'

interface ConnectState {
  expiresAt: number
  label?: string
}

const ONE_TIME_STATES = new Map<string, ConnectState>()
const STATE_TTL_MS = 10 * 60 * 1000

function pruneStates() {
  const now = Date.now()
  for (const [k, v] of ONE_TIME_STATES) {
    if (v.expiresAt < now) ONE_TIME_STATES.delete(k)
  }
}

@Inject(GoogleDriveService)
@Controller('gdrive')
@RouteGuards(AuthGuard)
export class GoogleDriveController {
  constructor(private readonly gdrive: GoogleDriveService) {}

  @Get('/status')
  @McpExpose({
    summary: 'Google Drive connection status: the connected accounts and how credentials are supplied.',
    description: 'A target cannot upload without a connected account — check here when a backup fails at the upload step.',
    tags: ['gdrive'],
    related: ['GET /api/gdrive/accounts'],
  })
  async status() {
    const accounts = await this.gdrive.listAccounts()
    return sendSuccess({
      accounts,
      hasEnvCreds: this.gdrive.hasEnvCreds(),
      redirectUri: this.gdrive.getRedirectUri(),
    })
  }

  @Get('/accounts')
  @McpExpose({
    summary: 'The connected Google accounts, with the id a target references as googleAuthId.',
    tags: ['gdrive'],
    related: ['POST /api/targets'],
  })
  async listAccounts() {
    return sendSuccess(await this.gdrive.listAccounts())
  }

  @Post('/connect')
  async startConnect(@Body() body: { label?: string } = {}) {
    pruneStates()
    const state = crypto.randomBytes(16).toString('hex')
    ONE_TIME_STATES.set(state, { expiresAt: Date.now() + STATE_TTL_MS, label: body?.label })
    const url = await this.gdrive.getAuthUrl(state)
    return sendSuccess({ url, state })
  }

  @Post('/accounts/manual')
  async connectManual(@Body() body: { clientId: string; clientSecret: string; refreshToken: string; label?: string }) {
    const result = await this.gdrive.connectManual({
      clientId: (body.clientId || '').trim(),
      clientSecret: (body.clientSecret || '').trim(),
      refreshToken: (body.refreshToken || '').trim(),
      label: (body.label || '').trim(),
    })
    return sendSuccess(result, 'Google account connected')
  }

  @Patch('/accounts/:id')
  async patchAccount(@Param('id') id: string, @Body() body: { label?: string }) {
    const result = await this.gdrive.updateLabel(id, body?.label || '')
    return sendSuccess(result, 'Account updated')
  }

  @Delete('/accounts/:id')
  async removeAccount(@Param('id') id: string) {
    await this.gdrive.disconnect(id)
    return sendSuccess({ id }, 'Account disconnected')
  }

  @Get('/callback')
  @NoGuard()
  async callback(@Query() query: { code?: string; state?: string; error?: string }) {
    const back = (params: Record<string, string>) =>
      redirect('/settings?' + new URLSearchParams(params).toString())

    if (query.error) return back({ gdrive: 'error', message: query.error })

    pruneStates()
    const stateEntry = query.state ? ONE_TIME_STATES.get(query.state) : null
    if (!stateEntry) {
      return back({ gdrive: 'error', message: 'Invalid or expired state' })
    }
    ONE_TIME_STATES.delete(query.state!)
    if (!query.code) return back({ gdrive: 'error', message: 'Missing authorization code' })

    try {
      const result = await this.gdrive.exchangeCode(query.code, stateEntry.label)
      return back({ gdrive: 'connected', email: result.email || '' })
    } catch (err) {
      return back({ gdrive: 'error', message: (err as Error).message })
    }
  }

  @Get('/folders')
  async folders(@Query() query: { accountId: string; parentId?: string }) {
    if (!query.accountId) return sendSuccess([])
    const list = await this.gdrive.listFolders(query.accountId, query.parentId)
    return sendSuccess(list)
  }

  @Post('/folders')
  async createFolder(@Body() body: { accountId: string; name: string; parentId?: string }) {
    const folder = await this.gdrive.ensureFolder(body.accountId, body.name, body.parentId)
    return sendSuccess(folder, 'Folder ready')
  }
}
