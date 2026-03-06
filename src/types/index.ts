export type ConversationStatus = 'bot' | 'human' | 'closed'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageSender = 'user' | 'bot' | 'human'
export type TransferRuleType = 'keyword' | 'intent'

export interface IConversation {
  _id: string
  waId: string
  name: string
  phone: string
  status: ConversationStatus
  assignedTo?: string
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
  createdAt: string
  updatedAt: string
}

export interface IMessage {
  _id: string
  conversationId: string
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
