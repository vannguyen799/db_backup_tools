import { Module } from 'truxie'
import { AUTH_MODULE_OPTIONS, type AuthModuleConfig } from './auth.config'
import { UserRepository } from './domain/user.repository'
import { AuthService } from './services/auth.service'
import { AdminSeedService } from './services/admin-seed.service'
import { AuthController } from './controllers/auth.controller'

export { AUTH_MODULE_OPTIONS }
export type { AuthModuleConfig }

@Module({})
export class AuthModule {
  static forRoot(config: AuthModuleConfig) {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_MODULE_OPTIONS, useValue: config },
        UserRepository,
        AuthService,
        AdminSeedService,
      ],
      exports: [UserRepository, AuthService],
    }
  }
}
