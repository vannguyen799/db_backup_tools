import { Injectable } from 'truxie'
import { ApiKey, type IApiKey } from './api-key.model'
import { hashApiKey } from '~/server/utils/api-key.util'

@Injectable()
export class ApiKeyRepository {
  // Never leak keyHash to the management API; it is only used internally for auth.
  list() {
    return ApiKey.find().select('-keyHash').sort({ createdAt: -1 }).lean()
  }

  findByHash(keyHash: string) {
    return ApiKey.findOne({ keyHash })
  }

  /** Look a key up by the plaintext the caller presented; only the hash is stored. */
  findByPlaintext(plaintext: string) {
    return this.findByHash(hashApiKey(plaintext))
  }

  create(input: Partial<IApiKey>) {
    return ApiKey.create(input)
  }

  delete(id: string) {
    return ApiKey.findByIdAndDelete(id)
  }

  touch(id: string, ip: string) {
    return ApiKey.updateOne({ _id: id }, { lastUsedAt: new Date(), lastUsedIp: ip })
  }
}
