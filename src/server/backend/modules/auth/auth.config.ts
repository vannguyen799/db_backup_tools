export interface AuthModuleConfig {
  jwtSecret: string
  jwtExpire: string
  seedAdmin: {
    email: string
    password: string
    name: string
  }
}

export const AUTH_MODULE_OPTIONS = Symbol('AUTH_MODULE_OPTIONS')
