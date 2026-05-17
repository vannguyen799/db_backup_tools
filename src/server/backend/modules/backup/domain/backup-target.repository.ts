import { Injectable } from 'truxie'
import { BackupTarget, type IBackupTarget } from './backup-target.model'

@Injectable()
export class BackupTargetRepository {
  list() {
    return BackupTarget.find().select('-mongoUriEncrypted').sort({ createdAt: -1 }).lean()
  }

  findEnabled() {
    return BackupTarget.find({ enabled: true })
  }

  findById(id: string) {
    return BackupTarget.findById(id)
  }

  findByIdSafe(id: string) {
    return BackupTarget.findById(id).select('-mongoUriEncrypted').lean()
  }

  create(input: Partial<IBackupTarget>) {
    return BackupTarget.create(input)
  }

  update(id: string, patch: Partial<IBackupTarget>) {
    return BackupTarget.findByIdAndUpdate(id, patch, { new: true })
      .select('-mongoUriEncrypted')
      .lean()
  }

  delete(id: string) {
    return BackupTarget.findByIdAndDelete(id)
  }

  patchStatus(id: string, lastJobAt: Date, lastJobStatus: 'success' | 'failed' | 'running') {
    return BackupTarget.updateOne({ _id: id }, { lastJobAt, lastJobStatus })
  }
}
