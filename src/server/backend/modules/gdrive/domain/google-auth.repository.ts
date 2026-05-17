import { Injectable } from 'truxie'
import { GoogleAuth, type IGoogleAuth } from './google-auth.model'

@Injectable()
export class GoogleAuthRepository {
  list(): Promise<IGoogleAuth[]> {
    return GoogleAuth.find().sort({ createdAt: 1 }).lean()
  }

  findById(id: string): Promise<IGoogleAuth | null> {
    return GoogleAuth.findById(id)
  }

  findByIdLean(id: string): Promise<IGoogleAuth | null> {
    return GoogleAuth.findById(id).lean()
  }

  findByEmail(email: string): Promise<IGoogleAuth | null> {
    return GoogleAuth.findOne({ email })
  }

  create(input: Partial<IGoogleAuth>): Promise<IGoogleAuth> {
    return GoogleAuth.create(input) as unknown as Promise<IGoogleAuth>
  }

  async updateById(id: string, patch: Partial<IGoogleAuth>): Promise<IGoogleAuth | null> {
    return GoogleAuth.findByIdAndUpdate(id, patch, { new: true })
  }

  async patchById(id: string, patch: Partial<IGoogleAuth>): Promise<void> {
    await GoogleAuth.updateOne({ _id: id }, patch)
  }

  async deleteById(id: string): Promise<boolean> {
    const r = await GoogleAuth.deleteOne({ _id: id })
    return r.deletedCount > 0
  }

  /**
   * One-time cleanup: drop the legacy `singletonId` unique index from the
   * pre-multi-account schema. Safe to call repeatedly — ignores "index not
   * found" errors.
   */
  async dropLegacySingletonIndex(): Promise<void> {
    try {
      const indexes = await GoogleAuth.collection.indexes()
      for (const idx of indexes) {
        if (idx.name && /singletonId/i.test(idx.name)) {
          await GoogleAuth.collection.dropIndex(idx.name)
        }
      }
    } catch {
      // collection or index may not exist yet — fine
    }
  }
}
