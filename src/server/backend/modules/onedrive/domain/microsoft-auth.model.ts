import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const microsoftAuthSchema = new Schema(
  {
    label: { type: String, default: '', trim: true },

    email: { type: String, default: '', index: true },
    name: { type: String, default: '' },

    // Tenant the refresh token was issued under; tokens must be refreshed against it.
    tenant: { type: String, default: 'common' },

    clientIdEncrypted: { type: String, default: '' },
    clientSecretEncrypted: { type: String, default: '' },

    refreshTokenEncrypted: { type: String, default: '' },
    accessTokenEncrypted: { type: String, default: '' },
    accessTokenExpiresAt: { type: Date },
    scope: { type: String, default: '' },

    source: { type: String, enum: ['oauth', 'manual'], default: 'oauth' },
    connectedAt: { type: Date },
  },
  { timestamps: true },
)

export type IMicrosoftAuth = InferSchemaType<typeof microsoftAuthSchema> & {
  _id: mongoose.Types.ObjectId
}

export const MicrosoftAuth =
  (mongoose.models.MicrosoftAuth as mongoose.Model<IMicrosoftAuth>) ||
  mongoose.model<IMicrosoftAuth>('MicrosoftAuth', microsoftAuthSchema)
