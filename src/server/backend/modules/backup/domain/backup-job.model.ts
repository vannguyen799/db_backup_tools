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
    triggeredBy: { type: String, enum: ['cron', 'manual'], default: 'manual' },

    startedAt: { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number },

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
