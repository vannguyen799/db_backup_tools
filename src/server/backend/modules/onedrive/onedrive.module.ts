import { Module } from 'truxie'
import { ONEDRIVE_MODULE_OPTIONS, type OneDriveModuleConfig } from './onedrive.config'
import { MicrosoftAuthRepository } from './domain/microsoft-auth.repository'
import { OneDriveService } from './services/onedrive.service'
import { OneDriveController } from './controllers/onedrive.controller'

export { ONEDRIVE_MODULE_OPTIONS }
export type { OneDriveModuleConfig }

@Module({})
export class OneDriveModule {
  static forRoot(config: OneDriveModuleConfig) {
    return {
      module: OneDriveModule,
      controllers: [OneDriveController],
      providers: [
        { provide: ONEDRIVE_MODULE_OPTIONS, useValue: config },
        MicrosoftAuthRepository,
        OneDriveService,
      ],
      exports: [OneDriveService],
    }
  }
}
