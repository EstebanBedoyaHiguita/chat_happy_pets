import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { AgentConfig } from '@/lib/models/AgentConfig'
import { DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'
import { randomUUID } from 'crypto'

export async function GET() {
  await connectDB()
  let config = await AgentConfig.findOne()
  if (!config) {
    config = await AgentConfig.create({ transferRules: DEFAULT_TRANSFER_RULES })
  }
  return NextResponse.json(config.transferRules)
}

export async function POST(req: NextRequest) {
  await connectDB()
  const rule = await req.json()
  rule.id = randomUUID()

  const config = await AgentConfig.findOneAndUpdate(
    {},
    { $push: { transferRules: rule } },
    { new: true, upsert: true }
  )

  return NextResponse.json(config.transferRules)
}

export async function PUT(req: NextRequest) {
  await connectDB()
  const { id, ...updates } = await req.json()

  const config = await AgentConfig.findOne()
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

  const ruleIndex = config.transferRules.findIndex((r: { id: string }) => r.id === id)
  if (ruleIndex === -1) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  Object.assign(config.transferRules[ruleIndex], updates)
  await config.save()

  return NextResponse.json(config.transferRules)
}

export async function DELETE(req: NextRequest) {
  await connectDB()
  const { id } = await req.json()

  const config = await AgentConfig.findOneAndUpdate(
    {},
    { $pull: { transferRules: { id } } },
    { new: true }
  )

  return NextResponse.json(config?.transferRules ?? [])
}
