import { Injectable, Inject, type OnApplicationBootstrap } from 'truxie'
import { AUTH_MODULE_OPTIONS, type AuthModuleConfig } from '../auth.config'
import { UserRepository } from '../domain/user.repository'
import { AuthService } from './auth.service'
import { isDBConnected } from '~/server/utils/database/connect'
import { logger } from '~/server/utils/logger'

const log = logger.getContext('AdminSeed')

@Injectable()
@Inject(AUTH_MODULE_OPTIONS, UserRepository, AuthService)
export class AdminSeedService implements OnApplicationBootstrap {
  constructor(
    private readonly config: AuthModuleConfig,
    private readonly userRepo: UserRepository,
    private readonly authService: AuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { email, password, name } = this.config.seedAdmin
    if (!email || !password) {
      log.warn('Admin seed skipped (ADMIN_EMAIL or ADMIN_PASSWORD missing)')
      return
    }

    for (let i = 0; i < 10 && !isDBConnected(); i++) {
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!isDBConnected()) {
      log.warn('DB not connected — admin seed deferred')
      return
    }

    if (await this.userRepo.existsByEmail(email)) {
      log.info(`Admin user already exists: ${email}`)
      return
    }
    const hash = await this.authService.hashPassword(password)
    await this.userRepo.create({ email, name, password: hash, role: 'admin' })
    log.info(`Seeded admin user: ${email}`)
  }
}
