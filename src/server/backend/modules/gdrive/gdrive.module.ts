import { Module } from 'truxie'
import { GDRIVE_MODULE_OPTIONS, type GoogleDriveModuleConfig } from './gdrive.config'
import { GoogleAuthRepository } from './domain/google-auth.repository'
import { GoogleDriveService } from './services/gdrive.service'
import { GoogleDriveController } from './controllers/gdrive.controller'

export { GDRIVE_MODULE_OPTIONS }
export type { GoogleDriveModuleConfig }

@Module({})
export class GoogleDriveModule {
  static forRoot(config: GoogleDriveModuleConfig) {
    return {
      module: GoogleDriveModule,
      controllers: [GoogleDriveController],
      providers: [
        { provide: GDRIVE_MODULE_OPTIONS, useValue: config },
        GoogleAuthRepository,
        GoogleDriveService,
      ],
      exports: [GoogleDriveService],
    }
  }
}
