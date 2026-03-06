import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'

export async function GET() {
  await connectDB()
  let config = await AgentConfig.findOne().lean()
  if (!config) {
    config = (
      await AgentConfig.create({ transferRules: DEFAULT_TRANSFER_RULES })
    ).toObject()
  }
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest) {
  await connectDB()
  const { systemPrompt, aiModel, temperature } = await req.json()

  const config = await AgentConfig.findOneAndUpdate(
    {},
    { systemPrompt, aiModel, temperature },
    { new: true, upsert: true }
  ).lean()

  return NextResponse.json(config)
}
