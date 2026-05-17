import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const retentionSchema = new Schema(
  {
    mode: { type: String, enum: ['count', 'days', 'none'], default: 'count' },
    keepCount: { type: Number, default: 7 },
    keepDays: { type: Number, default: 30 },
  },
  { _id: false },
)

const collectionRefSchema = new Schema(
  {
    db: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
)

const collectionFilterSchema = new Schema(
  {
    mode: { type: String, enum: ['exclude', 'include'], default: 'exclude' },
    collections: { type: [collectionRefSchema], default: [] },
    patterns: { type: [String], default: [] },
  },
  { _id: false },
)

const backupTargetSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    mongoUriEncrypted: { type: String, required: true },

    includeDbs: { type: [String], default: [] },
    excludeDbs: { type: [String], default: [] },

    collectionFilter: { type: collectionFilterSchema, default: () => ({}) },

    cronExpression: { type: String, default: '0 3 * * *' },

    googleAuthId: { type: Schema.Types.ObjectId, ref: 'GoogleAuth', default: null },
    gdriveFolderId: { type: String, default: '' },
    gdriveFolderName: { type: String, default: '' },

    retention: { type: retentionSchema, default: () => ({}) },

    enabled: { type: Boolean, default: true },

    machineId: { type: String, default: '' },

    lastJobAt: { type: Date },
    lastJobStatus: { type: String, enum: ['success', 'failed', 'running', null], default: null },
  },
  { timestamps: true },
)

backupTargetSchema.index({ enabled: 1 })

export type IBackupTarget = InferSchemaType<typeof backupTargetSchema> & {
  _id: mongoose.Types.ObjectId
}

export const BackupTarget =
  (mongoose.models.BackupTarget as mongoose.Model<IBackupTarget>) ||
  mongoose.model<IBackupTarget>('BackupTarget', backupTargetSchema)
