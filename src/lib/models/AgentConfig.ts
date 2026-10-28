import mongoose, { Schema } from 'mongoose'
import type { ITransferRule } from '@/types'
import { DEFAULT_KNOWLEDGE_BASE } from '@/lib/knowledge-base'

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
      default: DEFAULT_KNOWLEDGE_BASE,
    },
    aiModel: { type: String, default: 'gpt-4o-mini' },
    temperature: { type: Number, default: 0.7 },
    transferRules: { type: [TransferRuleSchema], default: [] },
  },
  { timestamps: true }
)

export const AgentConfig =
  mongoose.models.AgentConfig ||
  mongoose.model<AgentConfigDoc>('AgentConfig', AgentConfigSchema)
