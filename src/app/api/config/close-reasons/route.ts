import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { CloseReason } from '@/lib/models/CloseReason'

export async function GET() {
  await connectDB()
  const reasons = await CloseReason.find().sort({ createdAt: 1 }).lean()
  return NextResponse.json(reasons)
}

export async function POST(req: NextRequest) {
  await connectDB()
  const { name } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  // Seed default if collection is empty
  const reason = await CloseReason.create({ name: name.trim() })
  return NextResponse.json(reason, { status: 201 })
}
