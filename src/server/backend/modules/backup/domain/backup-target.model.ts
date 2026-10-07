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

    databaseType: { type: String, enum: ['mongodb', 'postgresql'], default: 'mongodb' },

    // Stores the encrypted connection URI for whichever databaseType is selected
    // (kept under the original field name to avoid migrating existing documents).
    mongoUriEncrypted: { type: String, required: true },

    includeDbs: { type: [String], default: [] },
    excludeDbs: { type: [String], default: [] },

    collectionFilter: { type: collectionFilterSchema, default: () => ({}) },

    cronExpression: { type: String, default: '0 3 * * *' },

    // Where archives are uploaded. Only the selected provider's fields below are used.
    storageProvider: { type: String, enum: ['gdrive', 'onedrive'], default: 'gdrive' },

    googleAuthId: { type: Schema.Types.ObjectId, ref: 'GoogleAuth', default: null },
    gdriveFolderId: { type: String, default: '' },
    gdriveFolderName: { type: String, default: '' },

    onedriveAuthId: { type: Schema.Types.ObjectId, ref: 'MicrosoftAuth', default: null },
    onedriveFolderId: { type: String, default: '' },
    onedriveFolderName: { type: String, default: '' },

    retention: { type: retentionSchema, default: () => ({}) },

    // How many of this target's newest archives also stay on the server's disk, as a
    // fallback for when the Drive upload fails or Drive is unreachable. 0 disables it.
    localKeepCount: { type: Number, default: 1, min: 0 },

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
