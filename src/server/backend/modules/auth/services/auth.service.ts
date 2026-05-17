import bcrypt from 'bcryptjs'
import { Injectable, Inject, UnauthorizedError } from 'truxie'
import { AUTH_MODULE_OPTIONS, type AuthModuleConfig } from '../auth.config'
import { UserRepository } from '../domain/user.repository'
import { signToken, type AuthPayload } from '~/server/utils/jwt'

const SALT_ROUNDS = 12

@Injectable()
@Inject(AUTH_MODULE_OPTIONS, UserRepository)
export class AuthService {
  constructor(
    private readonly config: AuthModuleConfig,
    private readonly userRepo: UserRepository,
  ) {}

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS)
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash)
  }

  async login(input: { email: string; password: string }): Promise<{
    token: string
    user: { id: string; email: string; name: string; role: string }
  }> {
    if (!input.email || !input.password) {
      throw new UnauthorizedError('Email and password are required')
    }
    const user = await this.userRepo.findByEmail(input.email)
    if (!user) throw new UnauthorizedError('Invalid credentials')
    const ok = await this.verifyPassword(input.password, user.password)
    if (!ok) throw new UnauthorizedError('Invalid credentials')

    await this.userRepo.updateLastLogin(String(user._id))

    const payload: AuthPayload = {
      id: String(user._id),
      email: user.email,
      role: user.role as 'admin',
    }
    return {
      token: signToken(payload),
      user: { id: String(user._id), email: user.email, name: user.name, role: user.role as string },
    }
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findById(userId)
    if (!user) throw new UnauthorizedError('User not found')
    return {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      lastLoginAt: user.lastLoginAt,
    }
  }
}
