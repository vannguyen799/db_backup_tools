export interface OneDriveModuleConfig {
  clientId: string
  clientSecret: string
  /** Azure AD tenant: `common` (personal + work accounts), `consumers`, `organizations` or a tenant id. */
  tenant: string
  redirectUri: string
}

export const ONEDRIVE_MODULE_OPTIONS = Symbol('ONEDRIVE_MODULE_OPTIONS')
