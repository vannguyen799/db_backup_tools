import { Injectable } from 'truxie'
import { ApiKey, type IApiKey } from './api-key.model'

@Injectable()
export class ApiKeyRepository {
  // Never leak keyHash to the management API; it is only used internally for auth.
  list() {
    return ApiKey.find().select('-keyHash').sort({ createdAt: -1 }).lean()
  }

  findByHash(keyHash: string) {
    return ApiKey.findOne({ keyHash })
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
