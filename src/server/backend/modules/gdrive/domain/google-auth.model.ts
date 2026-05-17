import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const googleAuthSchema = new Schema(
  {
    label: { type: String, default: '', trim: true },

    email: { type: String, default: '', index: true },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },

    clientIdEncrypted: { type: String, default: '' },
    clientSecretEncrypted: { type: String, default: '' },

    refreshTokenEncrypted: { type: String, default: '' },
    accessToken: { type: String, default: '' },
    accessTokenExpiresAt: { type: Date },
    scope: { type: String, default: '' },

    source: { type: String, enum: ['oauth', 'manual'], default: 'oauth' },
    connectedAt: { type: Date },
  },
  { timestamps: true },
)

export type IGoogleAuth = InferSchemaType<typeof googleAuthSchema> & {
  _id: mongoose.Types.ObjectId
}

export const GoogleAuth =
  (mongoose.models.GoogleAuth as mongoose.Model<IGoogleAuth>) ||
  mongoose.model<IGoogleAuth>('GoogleAuth', googleAuthSchema)
