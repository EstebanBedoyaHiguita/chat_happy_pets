import mongoose, { Schema, Document } from 'mongoose'
import type { ConversationStatus } from '@/types'

export interface ConversationDoc extends Document {
  waId: string
  name: string
  phone: string
  status: ConversationStatus
  assignedTo?: string
  lastMessage: string
  lastMessageAt: Date
  unreadCount: number
}

const ConversationSchema = new Schema<ConversationDoc>(
  {
    waId: { type: String, required: true, unique: true },
    name: { type: String, default: 'Desconocido' },
    phone: { type: String, required: true },
    status: {
      type: String,
      enum: ['bot', 'human', 'closed'],
      default: 'bot',
    },
    assignedTo: { type: String },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    unreadCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model<ConversationDoc>('Conversation', ConversationSchema)
