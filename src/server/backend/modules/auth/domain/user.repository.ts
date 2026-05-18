import { Injectable } from 'truxie'
import { User, type IUser } from './user.model'

@Injectable()
export class UserRepository {
  async findByEmail(email: string): Promise<IUser | null> {
    return User.findOne({ email: email.toLowerCase() })
  }

  async findById(id: string): Promise<IUser | null> {
    return User.findById(id)
  }

  async create(input: { email: string; name: string; password: string; role?: 'admin' }): Promise<IUser> {
    return User.create({
      email: input.email.toLowerCase(),
      name: input.name,
      password: input.password,
      role: input.role || 'admin',
    })
  }

  async updateLastLogin(id: string): Promise<void> {
    await User.updateOne({ _id: id }, { lastLoginAt: new Date() })
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await User.updateOne({ _id: id }, { password: hashedPassword })
  }

  async existsByEmail(email: string): Promise<boolean> {
    return !!(await User.exists({ email: email.toLowerCase() }))
  }
}
