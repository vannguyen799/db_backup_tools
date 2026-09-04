import { Injectable, Inject, type OnApplicationBootstrap, type OnApplicationShutdown } from 'truxie'
import { AUTH_MODULE_OPTIONS, type AuthModuleConfig } from '../auth.config'
import { UserRepository } from '../domain/user.repository'
import { AuthService } from './auth.service'
import { isDBConnected, onDBConnected } from '~/server/utils/database/connect'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('AdminSeed')

@Injectable()
@Inject(AUTH_MODULE_OPTIONS, UserRepository, AuthService)
export class AdminSeedService implements OnApplicationBootstrap, OnApplicationShutdown {
  private unsubscribe?: () => void

  constructor(
    private readonly config: AuthModuleConfig,
    private readonly userRepo: UserRepository,
    private readonly authService: AuthService,
  ) {}

  onApplicationBootstrap(): void {
    const { email, password } = this.config.seedAdmin
    if (!email || !password) {
      log.warn('Admin seed skipped (ADMIN_EMAIL or ADMIN_PASSWORD missing)')
      return
    }

    // Subscribe; never poll. app.ts creates the truxie app with a TOP-LEVEL
    // await, and the Nitro plugin that imports it is evaluated before
    // 01.mongodb.ts runs — so when this hook fires, connectDB has not been
    // called yet and no amount of waiting here can change that. The previous
    // bounded poll therefore lost on every single boot and returned after
    // logging "deferred", which read like a retry but was a give-up: a fresh
    // deployment came up with no admin account at all, and every login
    // answered "Invalid credentials" against an empty database.
    this.unsubscribe = onDBConnected(() => {
      this.seed().catch((err) => log.error('Admin seed failed:', (err as Error).message))
    })
    if (!isDBConnected()) log.info('Waiting for DB connection to seed the admin…')
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.()
  }

  private async seed(): Promise<void> {
    const { email, password, name } = this.config.seedAdmin

    if (await this.userRepo.existsByEmail(email)) {
      log.info(`Admin user already exists: ${email}`)
      // Idempotent either way, but onDBConnected fires again on every
      // reconnect and there is no reason to re-query for the life of the
      // process once the account is known to exist.
      this.unsubscribe?.()
      return
    }

    const hash = await this.authService.hashPassword(password)
    await this.userRepo.create({ email, name, password: hash, role: 'admin' })
    log.info(`Seeded admin user: ${email}`)
    this.unsubscribe?.()
  }
}
