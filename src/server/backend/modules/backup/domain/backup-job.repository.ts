import { Injectable } from 'truxie'
import { BackupJob, type IBackupJob } from './backup-job.model'

@Injectable()
export class BackupJobRepository {
  list(opts: { targetId?: string; limit?: number } = {}) {
    const q: Record<string, unknown> = {}
    if (opts.targetId) q.targetId = opts.targetId
    return BackupJob.find(q).sort({ createdAt: -1 }).limit(opts.limit ?? 100).lean()
  }

  findById(id: string) {
    return BackupJob.findById(id).lean()
  }

  create(input: Partial<IBackupJob>) {
    return BackupJob.create(input)
  }

  update(id: string, patch: Partial<IBackupJob>) {
    return BackupJob.findByIdAndUpdate(id, patch, { new: true })
  }

  recent(limit = 20) {
    return BackupJob.find().sort({ createdAt: -1 }).limit(limit).lean()
  }

  stats() {
    return BackupJob.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
  }
}
