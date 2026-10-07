import { Injectable } from 'truxie'
import { MicrosoftAuth, type IMicrosoftAuth } from './microsoft-auth.model'

@Injectable()
export class MicrosoftAuthRepository {
  list(): Promise<IMicrosoftAuth[]> {
    return MicrosoftAuth.find().sort({ createdAt: 1 }).lean()
  }

  findById(id: string): Promise<IMicrosoftAuth | null> {
    return MicrosoftAuth.findById(id).lean()
  }

  findByEmail(email: string): Promise<IMicrosoftAuth | null> {
    return MicrosoftAuth.findOne({ email }).lean()
  }

  create(input: Partial<IMicrosoftAuth>): Promise<IMicrosoftAuth> {
    return MicrosoftAuth.create(input) as unknown as Promise<IMicrosoftAuth>
  }

  updateById(id: string, patch: Partial<IMicrosoftAuth>): Promise<IMicrosoftAuth | null> {
    return MicrosoftAuth.findByIdAndUpdate(id, patch, { new: true }).lean()
  }

  async patchById(id: string, patch: Partial<IMicrosoftAuth>): Promise<void> {
    await MicrosoftAuth.updateOne({ _id: id }, patch)
  }

  async deleteById(id: string): Promise<boolean> {
    const r = await MicrosoftAuth.deleteOne({ _id: id })
    return r.deletedCount > 0
  }
}
