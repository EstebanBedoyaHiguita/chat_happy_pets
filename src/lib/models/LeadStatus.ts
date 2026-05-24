import mongoose, { Schema, Document } from 'mongoose'

export interface ILeadStatus extends Document {
  name: string
  color: string
  active: boolean
  order: number
}

const LeadStatusSchema = new Schema<ILeadStatus>(
  {
    name: { type: String, required: true },
    color: { type: String, default: '#6b7280' },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const LeadStatus =
  mongoose.models.LeadStatus || mongoose.model<ILeadStatus>('LeadStatus', LeadStatusSchema)
