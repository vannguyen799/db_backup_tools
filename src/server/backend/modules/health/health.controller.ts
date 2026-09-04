import { Controller, Get, NoGuard } from 'truxie'
import { McpExpose } from '@truxie/mcp'
import { isDBConnected } from '~/server/utils/database/connect'
import { sendSuccess } from '~/server/utils/response'

@Controller('health')
export class HealthController {
  @Get('/')
  @NoGuard()
  @McpExpose({
    summary: 'Liveness of the backup service itself: database connection, uptime and version.',
    description: 'Check this first when another endpoint fails — `db: "disconnected"` explains every other failure.',
    tags: ['health'],
  })
  ping() {
    return sendSuccess({
      ok: true,
      db: isDBConnected() ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.1.0',
    })
  }
}
