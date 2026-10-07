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

  heartbeat(id: string) {
    return BackupJob.updateOne({ _id: id }, { lastHeartbeatAt: new Date() })
  }

  /** Newest `running` job for a target, used to decide whether one is still in flight. */
  findRunningByTarget(targetId: string) {
    return BackupJob.findOne({ targetId, status: 'running' }).sort({ createdAt: -1 }).lean()
  }

  /**
   * Jobs for a target that still own an uploaded archive (Google Drive or OneDrive),
   * newest first. Retention works off these records rather than off remote filenames.
   */
  listUploaded(targetId: string) {
    return BackupJob.find({
      targetId,
      $or: [{ gdriveFileId: { $nin: [null, ''] } }, { onedriveItemId: { $nin: [null, ''] } }],
    })
      .sort({ createdAt: -1 })
      .select('_id startedAt gdriveFileId onedriveItemId archiveFilename')
      .lean()
  }

  /** Forget the Drive archive after retention deleted it — the file is really gone. */
  clearGdriveFile(id: string) {
    return BackupJob.updateOne({ _id: id }, { gdriveFileId: '', gdriveWebViewLink: '' })
  }

  /** Forget the OneDrive archive after retention deleted it. */
  clearOnedriveFile(id: string) {
    return BackupJob.updateOne({ _id: id }, { onedriveItemId: '', onedriveWebUrl: '' })
  }

  /** Jobs for a target that still own an archive on local disk, newest first. */
  listLocal(targetId: string) {
    return BackupJob.find({ targetId, localPath: { $nin: [null, ''] } })
      .sort({ createdAt: -1 })
      .select('_id localPath')
      .lean()
  }

  /** Forget the local archive after local retention deleted it. */
  clearLocalFile(id: string) {
    return BackupJob.updateOne({ _id: id }, { localPath: '' })
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
