import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const apiKeySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },

    // sha256(plaintext) hex — the value we look up by. The plaintext key is never stored.
    keyHash: { type: String, required: true, unique: true },
    // Non-secret prefix for display in the UI list, e.g. "bk_live_a1b2c3d4".
    prefix: { type: String, required: true },

    // A key is hard-locked to exactly one target: it may only trigger that target.
    targetId: { type: Schema.Types.ObjectId, ref: 'BackupTarget', required: true, index: true },

    scopes: { type: [String], default: ['sync:run'] },

    enabled: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },

    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

apiKeySchema.index({ keyHash: 1 }, { unique: true })

export type IApiKey = InferSchemaType<typeof apiKeySchema> & {
  _id: mongoose.Types.ObjectId
}

export const ApiKey =
  (mongoose.models.ApiKey as mongoose.Model<IApiKey>) ||
  mongoose.model<IApiKey>('ApiKey', apiKeySchema)
