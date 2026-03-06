import mongoose, { Schema, Document, Types } from 'mongoose'
import type { MessageDirection, MessageSender } from '@/types'

export interface MessageDoc extends Document {
  conversationId: Types.ObjectId
  direction: MessageDirection
  sender: MessageSender
  content: string
  waMessageId?: string
  timestamp: Date
}

const MessageSchema = new Schema<MessageDoc>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true,
    },
    sender: {
      type: String,
      enum: ['user', 'bot', 'human'],
      required: true,
    },
    content: { type: String, required: true },
    waMessageId: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

export const Message =
  mongoose.models.Message ||
  mongoose.model<MessageDoc>('Message', MessageSchema)
