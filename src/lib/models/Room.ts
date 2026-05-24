import mongoose, { Schema, Document } from 'mongoose'
import type { ConversationStatus } from '@/types'

export type ChannelType = 'whatsapp' | 'messenger' | 'instagram'

export interface RoomDoc extends Document {
  waId: string
  channel: ChannelType
  name: string
  phone: string
  petName: string
  petType: string
  petAge: string
  petWeight: string
  pet2Name: string
  pet2Type: string
  pet2Age: string
  pet2Weight: string
  pet3Name: string
  pet3Type: string
  pet3Age: string
  pet3Weight: string
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
  leadStatusId?: string
  leadStatusName?: string
  leadStatusColor?: string
  // Meta Ads / Click-to-WhatsApp attribution
  adSource?: string
  adId?: string
  adTitle?: string
  adBody?: string
  ctwaClid?: string
  sourceUrl?: string
}

const RoomSchema = new Schema<RoomDoc>(
  {
    waId: { type: String, required: true, unique: true },
    channel: { type: String, enum: ['whatsapp', 'messenger', 'instagram'], default: 'whatsapp' },
    name: { type: String, default: 'Desconocido' },
    phone: { type: String, required: true },
    petName: { type: String, default: '' },
    petType: { type: String, default: '' },
    petAge: { type: String, default: '' },
    petWeight: { type: String, default: '' },
    pet2Name: { type: String, default: '' },
    pet2Type: { type: String, default: '' },
    pet2Age: { type: String, default: '' },
    pet2Weight: { type: String, default: '' },
    pet3Name: { type: String, default: '' },
    pet3Type: { type: String, default: '' },
    pet3Age: { type: String, default: '' },
    pet3Weight: { type: String, default: '' },
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
    leadStatusId: { type: String },
    leadStatusName: { type: String },
    leadStatusColor: { type: String },
    adSource: { type: String },
    adId: { type: String },
    adTitle: { type: String },
    adBody: { type: String },
    ctwaClid: { type: String },
    sourceUrl: { type: String },
  },
  { timestamps: true }
)

export const Room =
  mongoose.models.Room ||
  mongoose.model<RoomDoc>('Room', RoomSchema)
