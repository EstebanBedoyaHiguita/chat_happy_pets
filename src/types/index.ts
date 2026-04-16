export type ConversationStatus = 'bot' | 'human' | 'closed'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageSender = 'user' | 'bot' | 'human'
export type TransferRuleType = 'keyword' | 'intent'

export interface IRoom {
  _id: string
  waId: string
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
  lastMessageAt: string
  windowExpiresAt: string | null
  closeReasonId?: string
  closeReasonName?: string
  closedBy?: string
  unreadCount: number
  contextSummary: string
  createdAt: string
  updatedAt: string
}

/** @deprecated Use IRoom instead */
export type IConversation = IRoom

export interface IMessage {
  _id: string
  roomId: string
  direction: MessageDirection
  sender: MessageSender
  content: string
  waMessageId?: string
  timestamp: string
  createdAt: string
}

export interface ITransferRule {
  id: string
  name: string
  type: TransferRuleType
  keywords?: string[]
  intent?: string
  active: boolean
}

export interface IAgentConfig {
  systemPrompt: string
  model: string
  temperature: number
  transferRules: ITransferRule[]
}

export interface ICloseReason {
  _id: string
  name: string
  active: boolean
  createdAt: string
}

export interface HappyPetsProduct {
  _id: string
  name: string
  description: string
  price: number
  sku: string
  stock: number
  available: boolean
  featured: boolean
  category: { _id: string; name: string }
  images: string[]
}

export interface HappyPetsCategory {
  _id: string
  name: string
  slug: string
  description?: string
}
