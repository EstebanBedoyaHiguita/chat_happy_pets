import mongoose, { Schema, Document } from 'mongoose'

export interface CloseReasonDoc extends Document {
  name: string
  active: boolean
}

const CloseReasonSchema = new Schema<CloseReasonDoc>(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const CloseReason =
  mongoose.models.CloseReason ||
  mongoose.model<CloseReasonDoc>('CloseReason', CloseReasonSchema)
