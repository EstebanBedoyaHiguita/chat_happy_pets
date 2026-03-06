import mongoose, { Schema } from 'mongoose'
import type { ITransferRule } from '@/types'

export interface AgentConfigDoc {
  _id: mongoose.Types.ObjectId
  systemPrompt: string
  aiModel: string
  temperature: number
  transferRules: ITransferRule[]
}

const TransferRuleSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['keyword', 'intent'], required: true },
    keywords: [{ type: String }],
    intent: { type: String },
    active: { type: Boolean, default: true },
  },
  { _id: false }
)

const AgentConfigSchema = new Schema<AgentConfigDoc>(
  {
    systemPrompt: {
      type: String,
      default: `Eres un asistente virtual de Happy Pets, una tienda de productos para mascotas.
Tu objetivo es ayudar a los clientes con información sobre productos, precios, disponibilidad y pedidos.

Responde siempre en español, de manera amable y profesional.
Si el cliente quiere hacer un pedido o necesita ayuda más personalizada, indícalo.`,
    },
    aiModel: { type: String, default: 'gpt-4o' },
    temperature: { type: Number, default: 0.7 },
    transferRules: { type: [TransferRuleSchema], default: [] },
  },
  { timestamps: true }
)

export const AgentConfig =
  mongoose.models.AgentConfig ||
  mongoose.model<AgentConfigDoc>('AgentConfig', AgentConfigSchema)
