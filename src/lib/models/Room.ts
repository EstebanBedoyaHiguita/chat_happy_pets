import mongoose, { Schema, Document } from 'mongoose'
import type { ConversationStatus } from '@/types'

export interface RoomDoc extends Document {
  waId: string
  name: string
  phone: string
  petName: string
  address: string
  status: ConversationStatus
  assignedTo?: string
  lastMessage: string
  lastMessageAt: Date
  windowExpiresAt: Date | null
  closeReasonId?: string
  closeReasonName?: string
  closedBy?: string
  unreadCount: number
  contextSummary: string
}

const RoomSchema = new Schema<RoomDoc>(
  {
    waId: { type: String, required: true, unique: true },
    name: { type: String, default: 'Desconocido' },
    phone: { type: String, required: true },
    petName: { type: String, default: '' },
    address: { type: String, default: '' },
    status: {
      type: String,
      enum: ['bot', 'human', 'closed'],
      default: 'bot',
    },
    assignedTo: { type: String },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    windowExpiresAt: { type: Date, default: null },
    closeReasonId: { type: String },
    closeReasonName: { type: String },
    closedBy: { type: String },
    unreadCount: { type: Number, default: 0 },
    contextSummary: { type: String, default: '' },
  },
  { timestamps: true }
)

export const Room =
  mongoose.models.Room ||
  mongoose.model<RoomDoc>('Room', RoomSchema)
