import { Controller, Get, NoGuard } from 'truxie'
import { isDBConnected } from '~/server/utils/database/connect'
import { sendSuccess } from '~/server/utils/response'

@Controller('health')
export class HealthController {
  @Get('/')
  @NoGuard()
  ping() {
    return sendSuccess({
      ok: true,
      db: isDBConnected() ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.1.0',
    })
  }
}
