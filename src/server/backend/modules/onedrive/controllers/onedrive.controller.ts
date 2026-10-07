import crypto from 'node:crypto'
import { Inject, Controller, Get, Post, Patch, Delete, RouteGuards, NoGuard, Body, Param, Query, redirect } from 'truxie'
import { McpExpose } from '@truxie/mcp'
import { AuthGuard } from '$/guards/auth.guard'
import { OneDriveService } from '../services/onedrive.service'
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

@Inject(OneDriveService)
@Controller('onedrive')
@RouteGuards(AuthGuard)
export class OneDriveController {
  constructor(private readonly onedrive: OneDriveService) {}

  @Get('/status')
  @McpExpose({
    summary: 'OneDrive connection status: the connected Microsoft accounts and how credentials are supplied.',
    description: 'A OneDrive target cannot upload without a connected account — check here when a backup fails at the upload step.',
    tags: ['onedrive'],
    related: ['GET /api/onedrive/accounts'],
  })
  async status() {
    return sendSuccess({
      accounts: await this.onedrive.listAccounts(),
      hasEnvCreds: this.onedrive.hasEnvCreds(),
      redirectUri: this.onedrive.getRedirectUri(),
    })
  }

  @Get('/accounts')
  @McpExpose({
    summary: 'The connected Microsoft accounts, with the id a target references as onedriveAuthId.',
    tags: ['onedrive'],
    related: ['POST /api/targets'],
  })
  async listAccounts() {
    return sendSuccess(await this.onedrive.listAccounts())
  }

  @Post('/connect')
  async startConnect(@Body() body: { label?: string } = {}) {
    pruneStates()
    const state = crypto.randomBytes(16).toString('hex')
    ONE_TIME_STATES.set(state, { expiresAt: Date.now() + STATE_TTL_MS, label: body?.label })
    return sendSuccess({ url: this.onedrive.getAuthUrl(state), state })
  }

  @Post('/accounts/manual')
  async connectManual(
    @Body() body: { clientId: string; clientSecret?: string; refreshToken: string; tenant?: string; label?: string },
  ) {
    const result = await this.onedrive.connectManual({
      clientId: (body.clientId || '').trim(),
      clientSecret: (body.clientSecret || '').trim(),
      refreshToken: (body.refreshToken || '').trim(),
      tenant: (body.tenant || '').trim(),
      label: (body.label || '').trim(),
    })
    return sendSuccess(result, 'Microsoft account connected')
  }

  @Patch('/accounts/:id')
  async patchAccount(@Param('id') id: string, @Body() body: { label?: string }) {
    return sendSuccess(await this.onedrive.updateLabel(id, body?.label || ''), 'Account updated')
  }

  @Delete('/accounts/:id')
  async removeAccount(@Param('id') id: string) {
    await this.onedrive.disconnect(id)
    return sendSuccess({ id }, 'Account disconnected')
  }

  @Get('/callback')
  @NoGuard()
  async callback(@Query() query: { code?: string; state?: string; error?: string; error_description?: string }) {
    const back = (params: Record<string, string>) =>
      redirect('/settings?' + new URLSearchParams(params).toString())

    if (query.error) return back({ onedrive: 'error', message: query.error_description || query.error })

    pruneStates()
    const stateEntry = query.state ? ONE_TIME_STATES.get(query.state) : null
    if (!stateEntry) {
      return back({ onedrive: 'error', message: 'Invalid or expired state' })
    }
    ONE_TIME_STATES.delete(query.state!)
    if (!query.code) return back({ onedrive: 'error', message: 'Missing authorization code' })

    try {
      const result = await this.onedrive.exchangeCode(query.code, stateEntry.label)
      return back({ onedrive: 'connected', email: result.email || '' })
    } catch (err) {
      return back({ onedrive: 'error', message: (err as Error).message })
    }
  }

  @Get('/folders')
  async folders(@Query() query: { accountId: string; parentId?: string }) {
    if (!query.accountId) return sendSuccess([])
    return sendSuccess(await this.onedrive.listFolders(query.accountId, query.parentId))
  }

  @Post('/folders')
  async createFolder(@Body() body: { accountId: string; name: string; parentId?: string }) {
    return sendSuccess(await this.onedrive.ensureFolder(body.accountId, body.name, body.parentId), 'Folder ready')
  }
}
