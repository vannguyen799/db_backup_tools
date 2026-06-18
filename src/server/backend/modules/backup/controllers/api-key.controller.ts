import { Inject, Controller, Get, Post, Delete, RouteGuards, Body, Param } from 'truxie'
import { AuthGuard, Auth, type AuthPayload } from '$/guards/auth.guard'
import { ApiKeyService, type CreateApiKeyInput } from '../services/api-key.service'
import { sendSuccess } from '~/server/utils/response'

@Inject(ApiKeyService)
@Controller('api-keys')
@RouteGuards(AuthGuard)
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get('/')
  async list() {
    return sendSuccess(await this.keys.list())
  }

  @Post('/')
  async create(@Body() body: CreateApiKeyInput, @Auth() auth: AuthPayload) {
    return sendSuccess(
      await this.keys.create(body, auth.id),
      'API key created — copy it now, it will not be shown again',
    )
  }

  @Delete('/:id')
  async revoke(@Param('id') id: string) {
    return sendSuccess(await this.keys.revoke(id), 'API key revoked')
  }
}
