import mongoose, { Schema, Document } from 'mongoose'

/**
 * Valores que cambian en caliente y no pueden vivir en variables de entorno,
 * porque el propio sistema los reescribe (ej: el token de Instagram, que se
 * renueva cada 60 días y en Vercel exigiría un redeploy para actualizarse).
 */
export interface AppSettingDoc extends Document {
  key: string
  value: string
  expiresAt?: Date
}

const AppSettingSchema = new Schema<AppSettingDoc>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
    expiresAt: { type: Date },
  },
  { timestamps: true }
)

export const AppSetting =
  mongoose.models.AppSetting ||
  mongoose.model<AppSettingDoc>('AppSetting', AppSettingSchema)

export const INSTAGRAM_TOKEN_KEY = 'instagram_access_token'
