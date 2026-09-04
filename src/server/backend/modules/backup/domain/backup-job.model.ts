import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const backupJobSchema = new Schema(
  {
    targetId: { type: Schema.Types.ObjectId, ref: 'BackupTarget', required: true, index: true },
    targetName: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'running', 'success', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    triggeredBy: { type: String, enum: ['cron', 'manual', 'api'], default: 'manual' },
    // Free-text "why this backup ran" — e.g. "pre-deploy app.ZynAlgo.com@a1b2c3d".
    // Set by the API trigger (sync) and given sensible defaults for cron/manual.
    reason: { type: String },

    startedAt: { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number },

    // Refreshed periodically while the dump is in flight. A `running` job whose
    // heartbeat has gone stale belongs to a process that died mid-backup, which is
    // how a restart-orphaned job is told apart from one that is genuinely running.
    lastHeartbeatAt: { type: Date },

    archiveFilename: { type: String },
    archiveSizeBytes: { type: Number },

    gdriveFileId: { type: String },
    gdriveWebViewLink: { type: String },

    log: { type: String, default: '' },
    error: { type: String },
  },
  { timestamps: true },
)

backupJobSchema.index({ createdAt: -1 })

export type IBackupJob = InferSchemaType<typeof backupJobSchema> & {
  _id: mongoose.Types.ObjectId
}

export const BackupJob =
  (mongoose.models.BackupJob as mongoose.Model<IBackupJob>) ||
  mongoose.model<IBackupJob>('BackupJob', backupJobSchema)
