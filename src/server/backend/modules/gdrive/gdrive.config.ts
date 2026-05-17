export interface GoogleDriveModuleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export const GDRIVE_MODULE_OPTIONS = Symbol('GDRIVE_MODULE_OPTIONS')
