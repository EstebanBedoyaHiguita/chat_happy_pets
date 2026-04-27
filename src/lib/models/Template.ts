import mongoose, { Schema, Document } from 'mongoose'

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
export type TemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED'

export interface ITemplate extends Document {
  name: string
  displayName: string
  category: TemplateCategory
  language: string
  bodyText: string
  variables: string[]
  metaStatus: TemplateStatus
  metaId: string
  createdAt: Date
}

const TemplateSchema = new Schema<ITemplate>(
  {
    name: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    category: { type: String, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'], default: 'UTILITY' },
    language: { type: String, default: 'es' },
    bodyText: { type: String, required: true },
    variables: { type: [String], default: [] },
    metaStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'], default: 'PENDING' },
    metaId: { type: String, default: '' },
  },
  { timestamps: true }
)

export const Template = mongoose.models.Template || mongoose.model<ITemplate>('Template', TemplateSchema)
